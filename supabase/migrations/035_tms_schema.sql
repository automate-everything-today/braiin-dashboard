-- 035_tms_schema.sql
--
-- TMS abstraction layer.
--
-- Cargowise is the first concrete adapter; Magaya (and others) follow.
-- The schema is provider-agnostic so adapters share the same identity-
-- map / event ingest / document storage plumbing - per-TMS adapters
-- only differ in the protocol + parser side.
--
-- Six tables:
--   tms.providers        - reference (cargowise, magaya, ...)
--   tms.connections      - per-(org, provider) auth + endpoints + config
--   tms.identity_map     - foreign-key bridge from TMS refs to Braiin entity uuids
--   tms.events           - inbound TMS events (raw payload + parsed + correlation)
--   tms.documents        - documents fetched from TMSes (BLs, invoices, eDocs, ...)
--   tms.subscriptions    - active subscriptions (Cargo Visibility, future webhooks)
--
-- service_role grants baked in. Schema must be exposed via
-- Supabase Settings > API > Exposed schemas after running.

CREATE SCHEMA IF NOT EXISTS tms;
GRANT USAGE ON SCHEMA tms TO service_role;


-- ============================================================
-- tms.providers - reference
-- ============================================================

CREATE TABLE IF NOT EXISTS tms.providers (
    provider_id     TEXT PRIMARY KEY,                       -- 'cargowise', 'magaya', 'descartes'
    name            TEXT NOT NULL,                          -- 'CargoWise (WiseTech Global)'
    description     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tms.providers (provider_id, name, description) VALUES
    ('cargowise', 'CargoWise (WiseTech Global)', 'Universal Interchange / eAdaptor / Cargo Visibility API'),
    ('magaya',    'Magaya',                       'Magaya REST API + webhooks')
ON CONFLICT (provider_id) DO NOTHING;


-- ============================================================
-- tms.connections - per-org TMS connection config
-- ============================================================
-- One row per (org, provider) pair. Holds endpoint URLs, auth method,
-- and any provider-specific config in `config` JSONB. Secrets live in
-- env vars - this table only stores references / non-sensitive bits.

CREATE TABLE IF NOT EXISTS tms.connections (
    connection_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    provider_id     TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,

    -- Friendly label per connection (a forwarder might have multiple
    -- Cargowise servers, e.g. UK + AU).
    name            TEXT NOT NULL,

    -- Auth method used by the adapter:
    -- 'cv_s2s_jwt'    - Cargo Visibility S2S Trust JWT + signed cert
    -- 'edaptor_soap'  - eAdaptor SOAP with username/password
    -- 'edaptor_http'  - eAdaptor HTTP+XML with HMAC
    -- 'magaya_apikey' - Magaya REST API key
    auth_method     TEXT NOT NULL,

    -- Where the secrets live (env-var names, NOT the secrets themselves).
    -- e.g. { "client_id_env": "CARGOWISE_CV_CLIENT_ID",
    --         "private_key_env": "CARGOWISE_CV_PRIVATE_KEY",
    --         "certificate_env": "CARGOWISE_CV_CERTIFICATE" }
    secrets_ref     JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Provider-specific config (endpoint URLs, IdP, IP allowlist hints,
    -- etc). e.g. { "base_url": "https://cargo.wisegrid.net",
    --              "idp_url": "https://identity.wisetechglobal.com/login/connect/token",
    --              "callback_path": "/api/inbound/cargowise-events" }
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,

    enabled         BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, provider_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tms_connections_org
    ON tms.connections (org_id, enabled);


-- ============================================================
-- tms.identity_map - foreign-key bridge
-- ============================================================
-- Maps an external TMS reference to a Braiin entity. The same TMS job
-- can map to multiple Braiin entity types (e.g. shipment + booking),
-- so entity_type is part of the key. soft FK to the Braiin side
-- (entity_id is just a UUID; resolution depends on entity_type).

CREATE TABLE IF NOT EXISTS tms.identity_map (
    map_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    provider_id     TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,

    -- The TMS-side reference (e.g. Cargowise job number 'AS123456',
    -- Cargowise MBOL '224278608', Magaya warehouse-receipt number).
    tms_ref         TEXT NOT NULL,
    tms_ref_type    TEXT NOT NULL,                          -- 'job', 'mbol', 'consol', 'invoice', 'document', 'consignment', ...

    -- The Braiin-side entity
    entity_type     TEXT NOT NULL,                          -- 'shipment', 'booking', 'rate_card', 'document', ...
    entity_id       UUID NOT NULL,

    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, provider_id, tms_ref_type, tms_ref, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_tms_identity_provider_ref
    ON tms.identity_map (provider_id, tms_ref_type, tms_ref);

CREATE INDEX IF NOT EXISTS idx_tms_identity_entity
    ON tms.identity_map (entity_type, entity_id);


-- ============================================================
-- tms.events - inbound TMS events
-- ============================================================
-- Every inbound event (Cargo Visibility tracking event, eAdaptor
-- Universal Event, Magaya webhook payload) lands here first. Raw
-- payload is preserved for re-parsing on schema changes; parsed
-- canonical form goes in `parsed`.

CREATE TABLE IF NOT EXISTS tms.events (
    event_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    connection_id       UUID REFERENCES tms.connections(connection_id) ON DELETE SET NULL,
    provider_id         TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,

    -- TMS-side event metadata
    event_type          TEXT NOT NULL,                      -- 'ARV', 'DEP', 'GIN', 'GOU', 'IRA', 'IRJ', 'document', ...
    event_time          TIMESTAMPTZ,                        -- when the event occurred per the TMS
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- when we received it

    -- Correlation
    client_reference    TEXT,                               -- our subscription ClientReference (round-trip identifier)
    tms_ref             TEXT,                               -- primary TMS reference (MBOL, job number, AWB, etc)
    tms_ref_type        TEXT,                               -- matches identity_map.tms_ref_type

    -- Payload
    payload_format      TEXT NOT NULL,                      -- 'xml', 'json', 'edi'
    payload_raw         TEXT NOT NULL,                      -- raw payload as received
    parsed              JSONB,                              -- parsed canonical form

    -- Processing
    status              TEXT NOT NULL DEFAULT 'received',   -- 'received', 'parsed', 'correlated', 'processed', 'failed'
    error_message       TEXT,
    correlated_entity_id UUID,                              -- entity from identity_map resolution
    correlated_entity_type TEXT,

    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tms_events_org_received
    ON tms.events (org_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_events_provider_type
    ON tms.events (provider_id, event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_events_client_ref
    ON tms.events (client_reference)
    WHERE client_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_events_tms_ref
    ON tms.events (provider_id, tms_ref_type, tms_ref)
    WHERE tms_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_events_failures
    ON tms.events (org_id, received_at DESC)
    WHERE status = 'failed';


-- ============================================================
-- tms.documents - documents fetched from a TMS
-- ============================================================

CREATE TABLE IF NOT EXISTS tms.documents (
    document_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    provider_id     TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,
    connection_id   UUID REFERENCES tms.connections(connection_id) ON DELETE SET NULL,

    -- TMS-side identity
    tms_ref         TEXT NOT NULL,                          -- e.g. job number the doc belongs to
    tms_ref_type    TEXT NOT NULL,
    tms_doc_id      TEXT,                                   -- TMS-side document ID
    doc_type        TEXT,                                   -- 'BL', 'AWB', 'invoice', 'customs_declaration', 'eDoc', ...

    -- Storage
    storage_url     TEXT,                                   -- where the bytes live (Supabase storage / S3 / local)
    content_type    TEXT,
    bytes           INTEGER,

    -- Metadata extracted at fetch time (extracted text, key fields, ...)
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_event_id UUID REFERENCES tms.events(event_id) ON DELETE SET NULL,

    UNIQUE (provider_id, tms_doc_id)
);

CREATE INDEX IF NOT EXISTS idx_tms_documents_org
    ON tms.documents (org_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_documents_tms_ref
    ON tms.documents (provider_id, tms_ref_type, tms_ref);


-- ============================================================
-- tms.subscriptions - active TMS subscriptions
-- ============================================================
-- Tracks what we've asked a TMS to push to us (Cargo Visibility
-- subscriptions, future Magaya webhooks etc). Status updates as
-- IRA/IRJ acks arrive.

CREATE TABLE IF NOT EXISTS tms.subscriptions (
    subscription_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    connection_id       UUID NOT NULL REFERENCES tms.connections(connection_id) ON DELETE CASCADE,
    provider_id         TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,

    -- The reference we're subscribing to track
    tms_ref             TEXT NOT NULL,                      -- MBOL number / AWB / consignment ref
    tms_ref_type        TEXT NOT NULL,                      -- 'mbol', 'awb', 'consignment'

    -- Carrier context (Cargo Visibility uses CarrierCode + Carrier)
    carrier_code        TEXT,                               -- SCAC for ocean, IATA for air ('MAEU', 'BA')
    transport_mode      TEXT,                               -- 'SEA', 'AIR'
    container_mode      TEXT,                               -- 'FCL', 'LCL'

    -- Round-trip correlation - we put this in the SBR ClientReference
    -- and the TMS echoes it back on every event.
    client_reference    TEXT NOT NULL UNIQUE,

    -- The full subscription request payload we sent (for replay / audit)
    request_payload     TEXT,
    request_format      TEXT,                               -- 'xml' for Cargo Visibility

    -- Status
    status              TEXT NOT NULL DEFAULT 'pending',    -- 'pending', 'acknowledged', 'rejected', 'cancelled'
    acknowledged_at     TIMESTAMPTZ,
    rejected_at         TIMESTAMPTZ,
    rejection_reason    TEXT,

    -- Audit
    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tms_subs_org_status
    ON tms.subscriptions (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_subs_connection
    ON tms.subscriptions (connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_subs_tms_ref
    ON tms.subscriptions (provider_id, tms_ref_type, tms_ref);


-- ============================================================
-- updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION tms.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tms_connections_touch ON tms.connections;
CREATE TRIGGER trg_tms_connections_touch
    BEFORE UPDATE ON tms.connections
    FOR EACH ROW EXECUTE FUNCTION tms.touch_updated_at();

DROP TRIGGER IF EXISTS trg_tms_subs_touch ON tms.subscriptions;
CREATE TRIGGER trg_tms_subs_touch
    BEFORE UPDATE ON tms.subscriptions
    FOR EACH ROW EXECUTE FUNCTION tms.touch_updated_at();


-- ============================================================
-- Lockdown
-- ============================================================

REVOKE ALL ON tms.providers       FROM PUBLIC;
REVOKE ALL ON tms.connections     FROM PUBLIC;
REVOKE ALL ON tms.identity_map    FROM PUBLIC;
REVOKE ALL ON tms.events          FROM PUBLIC;
REVOKE ALL ON tms.documents       FROM PUBLIC;
REVOKE ALL ON tms.subscriptions   FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON tms.providers     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.connections   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.identity_map  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.events        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.documents     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.subscriptions TO service_role;
