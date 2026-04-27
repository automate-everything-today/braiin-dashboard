-- 029_shorthand_vocabulary.sql
--
-- Domain shorthand vocabulary (engiine adoption RFC section 3.4).
--
-- Freight is dense with shorthand: port codes (FXT, RTM, SIN), Incoterms
-- (DDP, FOB, EXW), modes (FCL, LCL, AIR), document types (BL, AWB, CMR,
-- EUR1), status codes (POL, POD, ETA), container codes (20GP, 40HC, REEF),
-- carriers (MSC, MAERSK, ONE). LLM prompts that mention these without
-- expansion get worse classifications. Search queries with "RTM Felix"
-- miss "Rotterdam Felixstowe". Rate cards arrive as "FELIX-RTM 40HC"
-- and need normalising.
--
-- Solution: a queryable, extensible, multilingual-ready vocabulary table.
-- Code reads it via `src/lib/shorthand/`. Admins add new terms via
-- `POST /api/shorthand/terms`. LLM prompts can call `expandShorthand()`
-- to inline canonical names. Search/normalisation reads aliases.
--
-- Two tables:
--   shorthand.terms        - one row per concept (term + category)
--   shorthand.translations - per-locale name/description/aliases
--
-- The split is for multilingual: term codes ("FCL", "DDP") are language
-- agnostic; what changes per locale is the canonical_name and description
-- (and aliases - "Rotterdam" in EN, "Roterdam" in PL, etc).
--
-- Service-role grants baked in (lesson from 024/025). Schema must be
-- added manually to Supabase Dashboard > Settings > API > Exposed
-- schemas after running this migration.

-- ============================================================
-- Schema
-- ============================================================

CREATE SCHEMA IF NOT EXISTS shorthand;

GRANT USAGE ON SCHEMA shorthand TO service_role;


-- ============================================================
-- shorthand.terms - one row per shorthand concept
-- ============================================================
-- The canonical key is (term, category). Same code in different
-- categories is a different row (e.g. 'FCL' is a mode AND a
-- container-load type in some carriers' usage).

CREATE TABLE IF NOT EXISTS shorthand.terms (
    term_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- The shorthand itself (case-insensitive matching is the caller's job;
    -- we store as-canonically-written, e.g. 'FCL', 'DDP', 'FELIX').
    term           TEXT NOT NULL,

    -- Category to disambiguate and to drive lookups
    -- ('port', 'incoterm', 'mode', 'document', 'status', 'container',
    --  'carrier', 'unit', 'misc'). TEXT not enum so categories can be
    -- added without a migration.
    category       TEXT NOT NULL,

    -- Free-form metadata, category-specific:
    -- - port:      { country, region, unlocode, lat, lon }
    -- - carrier:   { iata_code, scac, parent }
    -- - container: { teu, length_ft, height_ft }
    -- - incoterm:  { revision, transport_mode }
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Audit
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by     TEXT,                                  -- email or 'seed' for migration-loaded rows

    UNIQUE (term, category)
);

CREATE INDEX IF NOT EXISTS idx_shorthand_terms_category
    ON shorthand.terms (category, term);

-- Case-insensitive lookup index. Lets `WHERE LOWER(term) = LOWER($1)`
-- use an index without forcing callers to lowercase the column.
CREATE INDEX IF NOT EXISTS idx_shorthand_terms_term_lower
    ON shorthand.terms (LOWER(term));

COMMENT ON TABLE shorthand.terms IS
    'Freight shorthand vocabulary (engiine RFC 3.4). One row per concept; translations live in shorthand.translations.';


-- ============================================================
-- shorthand.translations - per-locale text for each term
-- ============================================================
-- Locale codes are BCP 47 short tags ('en', 'es', 'zh', 'pt-BR').
-- English ('en') is required for every term and is what the seed
-- migration loads. Other locales added later as needed.

CREATE TABLE IF NOT EXISTS shorthand.translations (
    translation_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    term_id         UUID NOT NULL REFERENCES shorthand.terms(term_id) ON DELETE CASCADE,

    -- BCP 47 locale tag
    locale          TEXT NOT NULL,

    -- The full name in this locale ('Full Container Load', 'Rotterdam',
    -- 'Delivered Duty Paid')
    canonical_name  TEXT NOT NULL,

    -- Optional longer description
    description     TEXT,

    -- Other ways this term might appear in this locale. Used by search
    -- expansion and by extractors when matching free text. Stored as
    -- text array for direct array-contains queries.
    -- e.g. for term 'RTM' in 'en': ['Rotterdam', 'Port of Rotterdam']
    aliases         TEXT[] NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (term_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_shorthand_translations_locale
    ON shorthand.translations (locale);

-- GIN on aliases supports `WHERE aliases && ARRAY['Rotterdam']` style
-- queries used by search expansion.
CREATE INDEX IF NOT EXISTS idx_shorthand_translations_aliases
    ON shorthand.translations USING GIN (aliases);

COMMENT ON TABLE shorthand.translations IS
    'Per-locale name / description / aliases for shorthand.terms rows. English required; other locales optional.';


-- ============================================================
-- Updated-at triggers (keeps updated_at honest)
-- ============================================================

CREATE OR REPLACE FUNCTION shorthand.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shorthand_terms_touch ON shorthand.terms;
CREATE TRIGGER trg_shorthand_terms_touch
    BEFORE UPDATE ON shorthand.terms
    FOR EACH ROW EXECUTE FUNCTION shorthand.touch_updated_at();

DROP TRIGGER IF EXISTS trg_shorthand_translations_touch ON shorthand.translations;
CREATE TRIGGER trg_shorthand_translations_touch
    BEFORE UPDATE ON shorthand.translations
    FOR EACH ROW EXECUTE FUNCTION shorthand.touch_updated_at();


-- ============================================================
-- Lockdown - REVOKE PUBLIC then GRANT service_role
-- ============================================================

REVOKE ALL ON shorthand.terms FROM PUBLIC;
REVOKE ALL ON shorthand.translations FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON shorthand.terms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON shorthand.translations TO service_role;
