-- 030_shorthand_seed.sql
--
-- English-locale seed for the shorthand vocabulary table created in 029.
-- ~95 freight terms covering the categories we hit most: container types,
-- Incoterms 2020, modes, ports (UK / EU / NA / FE / LATAM), document
-- types, status codes, and major carriers.
--
-- Idempotent. Re-running the migration upserts (refreshes) descriptions
-- and aliases without creating duplicates.
--
-- Add new terms by:
--   1. Editing this file and re-running the migration (preferred for
--      stable additions that should be in version control), or
--   2. Calling POST /api/shorthand/terms (preferred for one-off / org-
--      specific terms added through the admin UI).

-- ============================================================
-- Helper: upsert a term + its English translation in one call
-- ============================================================

CREATE OR REPLACE FUNCTION shorthand.upsert_term(
    p_term            TEXT,
    p_category        TEXT,
    p_canonical_name  TEXT,
    p_description     TEXT DEFAULT NULL,
    p_aliases         TEXT[] DEFAULT '{}',
    p_metadata        JSONB DEFAULT '{}'::jsonb,
    p_locale          TEXT DEFAULT 'en'
) RETURNS UUID AS $$
DECLARE
    v_term_id UUID;
BEGIN
    INSERT INTO shorthand.terms (term, category, metadata, created_by)
    VALUES (p_term, p_category, p_metadata, 'seed')
    ON CONFLICT (term, category)
        DO UPDATE SET metadata = shorthand.terms.metadata || EXCLUDED.metadata
    RETURNING term_id INTO v_term_id;

    INSERT INTO shorthand.translations (term_id, locale, canonical_name, description, aliases)
    VALUES (v_term_id, p_locale, p_canonical_name, p_description, p_aliases)
    ON CONFLICT (term_id, locale)
        DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            description    = EXCLUDED.description,
            aliases        = EXCLUDED.aliases;

    RETURN v_term_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION shorthand.upsert_term(TEXT, TEXT, TEXT, TEXT, TEXT[], JSONB, TEXT) TO service_role;


-- ============================================================
-- Container types
-- ============================================================

SELECT shorthand.upsert_term('20GP', 'container', '20-foot General Purpose container',
    'Standard 20ft dry-box. 1 TEU.',
    ARRAY['20-foot', '20ft', '20 standard', '20DV'],
    '{"teu":1,"length_ft":20,"height_ft":8.5}'::jsonb);

SELECT shorthand.upsert_term('40GP', 'container', '40-foot General Purpose container',
    'Standard 40ft dry-box. 2 TEU.',
    ARRAY['40-foot', '40ft', '40 standard', '40DV'],
    '{"teu":2,"length_ft":40,"height_ft":8.5}'::jsonb);

SELECT shorthand.upsert_term('40HC', 'container', '40-foot High Cube container',
    'Taller variant of 40ft (9ft 6in vs 8ft 6in). 2 TEU.',
    ARRAY['40HQ', '40-foot high cube', '40ft hc', '40HQC'],
    '{"teu":2,"length_ft":40,"height_ft":9.5}'::jsonb);

SELECT shorthand.upsert_term('45HC', 'container', '45-foot High Cube container',
    'Pallet-wide 45ft equipment. 2.25 TEU equivalent.',
    ARRAY['45HQ', '45-foot high cube'],
    '{"teu":2.25,"length_ft":45,"height_ft":9.5}'::jsonb);

SELECT shorthand.upsert_term('20REEF', 'container', '20-foot Refrigerated container',
    '20ft reefer for temperature-controlled cargo.',
    ARRAY['20RF', '20-foot reefer'],
    '{"teu":1,"length_ft":20,"reefer":true}'::jsonb);

SELECT shorthand.upsert_term('40REEF', 'container', '40-foot Refrigerated container',
    '40ft reefer; the workhorse for chilled and frozen ocean freight.',
    ARRAY['40RF', '40-foot reefer', '40HRF'],
    '{"teu":2,"length_ft":40,"reefer":true}'::jsonb);

SELECT shorthand.upsert_term('20OT', 'container', '20-foot Open Top container',
    'Open-top 20ft, used for over-height cargo loaded by crane.',
    ARRAY['20-foot open top', '20OPT'],
    '{"teu":1,"length_ft":20,"open_top":true}'::jsonb);

SELECT shorthand.upsert_term('40OT', 'container', '40-foot Open Top container',
    'Open-top 40ft, used for over-height cargo loaded by crane.',
    ARRAY['40-foot open top', '40OPT'],
    '{"teu":2,"length_ft":40,"open_top":true}'::jsonb);

SELECT shorthand.upsert_term('20FR', 'container', '20-foot Flat Rack container',
    'Collapsible flat rack 20ft for out-of-gauge cargo.',
    ARRAY['20-foot flat rack'],
    '{"teu":1,"length_ft":20,"flat_rack":true}'::jsonb);

SELECT shorthand.upsert_term('40FR', 'container', '40-foot Flat Rack container',
    'Collapsible flat rack 40ft for out-of-gauge cargo.',
    ARRAY['40-foot flat rack'],
    '{"teu":2,"length_ft":40,"flat_rack":true}'::jsonb);


-- ============================================================
-- Incoterms 2020
-- ============================================================

SELECT shorthand.upsert_term('EXW', 'incoterm', 'Ex Works',
    'Seller delivers when goods are placed at buyers disposal at sellers premises. Buyer bears all risk and cost from there.',
    ARRAY['ex-works'],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);

SELECT shorthand.upsert_term('FCA', 'incoterm', 'Free Carrier',
    'Seller delivers cleared for export to a carrier nominated by the buyer at the named place.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);

SELECT shorthand.upsert_term('FAS', 'incoterm', 'Free Alongside Ship',
    'Seller delivers when goods are placed alongside the vessel at the named port. Sea/inland-waterway only.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"sea"}'::jsonb);

SELECT shorthand.upsert_term('FOB', 'incoterm', 'Free On Board',
    'Seller delivers on board the vessel nominated by the buyer at the named port. Sea/inland-waterway only.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"sea"}'::jsonb);

SELECT shorthand.upsert_term('CFR', 'incoterm', 'Cost and Freight',
    'Seller pays cost and freight to the named destination port. Risk transfers when goods are on board at origin. Sea/inland-waterway only.',
    ARRAY['C&F'],
    '{"revision":"2020","transport_mode":"sea"}'::jsonb);

SELECT shorthand.upsert_term('CIF', 'incoterm', 'Cost, Insurance and Freight',
    'CFR plus seller-purchased minimum insurance. Sea/inland-waterway only.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"sea"}'::jsonb);

SELECT shorthand.upsert_term('CPT', 'incoterm', 'Carriage Paid To',
    'Seller pays carriage to the named destination. Risk transfers at first carrier.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);

SELECT shorthand.upsert_term('CIP', 'incoterm', 'Carriage and Insurance Paid To',
    'CPT plus seller-purchased all-risks insurance.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);

SELECT shorthand.upsert_term('DAP', 'incoterm', 'Delivered at Place',
    'Seller delivers when goods are placed at the buyers disposal on the arriving means of transport, ready for unloading.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);

SELECT shorthand.upsert_term('DPU', 'incoterm', 'Delivered at Place Unloaded',
    'Seller delivers when goods, once unloaded, are placed at the buyers disposal at the named place. Replaces DAT from 2010.',
    ARRAY['DAT'],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);

SELECT shorthand.upsert_term('DDP', 'incoterm', 'Delivered Duty Paid',
    'Seller bears all costs and risks to deliver goods to the named destination, cleared for import.',
    ARRAY[]::TEXT[],
    '{"revision":"2020","transport_mode":"any"}'::jsonb);


-- ============================================================
-- Modes
-- ============================================================

SELECT shorthand.upsert_term('FCL', 'mode', 'Full Container Load',
    'Whole-container ocean shipment.',
    ARRAY['full container load']);

SELECT shorthand.upsert_term('LCL', 'mode', 'Less than Container Load',
    'Consolidated / groupage ocean shipment sharing a container.',
    ARRAY['groupage', 'less than container load']);

SELECT shorthand.upsert_term('AIR', 'mode', 'Air freight',
    'Goods moved by aircraft.',
    ARRAY['airfreight']);

SELECT shorthand.upsert_term('ROAD', 'mode', 'Road freight',
    'Goods moved by truck / trailer.',
    ARRAY['truck', 'trucking']);

SELECT shorthand.upsert_term('RAIL', 'mode', 'Rail freight',
    'Goods moved by rail.',
    ARRAY[]::TEXT[]);

SELECT shorthand.upsert_term('COURIER', 'mode', 'Courier / express parcel',
    'Express parcel via integrators (DHL, FedEx, UPS).',
    ARRAY['express']);

SELECT shorthand.upsert_term('BREAKBULK', 'mode', 'Breakbulk',
    'Non-containerised general cargo loaded individually.',
    ARRAY['break-bulk']);

SELECT shorthand.upsert_term('RORO', 'mode', 'Roll-on / Roll-off',
    'Wheeled cargo driven on and off vessel.',
    ARRAY['ro-ro', 'ro/ro']);


-- ============================================================
-- Ports - United Kingdom
-- ============================================================

SELECT shorthand.upsert_term('FXT', 'port', 'Felixstowe',
    'UKs largest container port; on the Suffolk coast.',
    ARRAY['Felixstowe', 'Felix', 'Port of Felixstowe'],
    '{"country":"GB","region":"UK","unlocode":"GBFXT"}'::jsonb);

SELECT shorthand.upsert_term('SOU', 'port', 'Southampton',
    'Major UK container and cruise port on the south coast.',
    ARRAY['Southampton', 'Port of Southampton'],
    '{"country":"GB","region":"UK","unlocode":"GBSOU"}'::jsonb);

SELECT shorthand.upsert_term('LGP', 'port', 'London Gateway',
    'Deep-sea container port on the Thames.',
    ARRAY['London Gateway', 'DPW London Gateway'],
    '{"country":"GB","region":"UK","unlocode":"GBLGP"}'::jsonb);

SELECT shorthand.upsert_term('LIV', 'port', 'Liverpool',
    'Port of Liverpool on the Mersey; Liverpool2 deep-sea terminal.',
    ARRAY['Liverpool', 'Port of Liverpool', 'Liverpool2'],
    '{"country":"GB","region":"UK","unlocode":"GBLIV"}'::jsonb);

SELECT shorthand.upsert_term('TIL', 'port', 'Tilbury',
    'Port of Tilbury on the Thames estuary.',
    ARRAY['Tilbury', 'Port of Tilbury'],
    '{"country":"GB","region":"UK","unlocode":"GBTIL"}'::jsonb);

SELECT shorthand.upsert_term('IMM', 'port', 'Immingham',
    'Port of Immingham on the Humber; UKs largest by tonnage.',
    ARRAY['Immingham'],
    '{"country":"GB","region":"UK","unlocode":"GBIMM"}'::jsonb);

SELECT shorthand.upsert_term('TEE', 'port', 'Teesport',
    'Teesport on the north-east coast.',
    ARRAY['Teesport', 'Tees'],
    '{"country":"GB","region":"UK","unlocode":"GBTEE"}'::jsonb);

SELECT shorthand.upsert_term('GRG', 'port', 'Grangemouth',
    'Grangemouth on the Firth of Forth; Scotlands main container port.',
    ARRAY['Grangemouth'],
    '{"country":"GB","region":"UK","unlocode":"GBGRG"}'::jsonb);


-- ============================================================
-- Ports - North-west Europe
-- ============================================================

SELECT shorthand.upsert_term('RTM', 'port', 'Rotterdam',
    'Europes largest seaport.',
    ARRAY['Rotterdam', 'Port of Rotterdam'],
    '{"country":"NL","region":"EU","unlocode":"NLRTM"}'::jsonb);

SELECT shorthand.upsert_term('ANR', 'port', 'Antwerp',
    'Port of Antwerp-Bruges; Europes second-largest.',
    ARRAY['Antwerp', 'Antwerpen', 'Port of Antwerp'],
    '{"country":"BE","region":"EU","unlocode":"BEANR"}'::jsonb);

SELECT shorthand.upsert_term('HAM', 'port', 'Hamburg',
    'Largest German seaport.',
    ARRAY['Hamburg', 'Port of Hamburg'],
    '{"country":"DE","region":"EU","unlocode":"DEHAM"}'::jsonb);

SELECT shorthand.upsert_term('BRV', 'port', 'Bremerhaven',
    'Major North Sea container port.',
    ARRAY['Bremerhaven'],
    '{"country":"DE","region":"EU","unlocode":"DEBRV"}'::jsonb);

SELECT shorthand.upsert_term('LEH', 'port', 'Le Havre',
    'Frances second-largest port.',
    ARRAY['Le Havre', 'Havre'],
    '{"country":"FR","region":"EU","unlocode":"FRLEH"}'::jsonb);

SELECT shorthand.upsert_term('ZEE', 'port', 'Zeebrugge',
    'Belgian North Sea port; ro-ro and LNG hub.',
    ARRAY['Zeebrugge'],
    '{"country":"BE","region":"EU","unlocode":"BEZEE"}'::jsonb);

SELECT shorthand.upsert_term('VLC', 'port', 'Valencia',
    'Spains largest container port (Mediterranean).',
    ARRAY['Valencia'],
    '{"country":"ES","region":"EU","unlocode":"ESVLC"}'::jsonb);

SELECT shorthand.upsert_term('GOA', 'port', 'Genoa',
    'Italys largest port.',
    ARRAY['Genoa', 'Genova'],
    '{"country":"IT","region":"EU","unlocode":"ITGOA"}'::jsonb);

SELECT shorthand.upsert_term('PIR', 'port', 'Piraeus',
    'Greeces main port; major Med transhipment hub.',
    ARRAY['Piraeus'],
    '{"country":"GR","region":"EU","unlocode":"GRPIR"}'::jsonb);

SELECT shorthand.upsert_term('GDN', 'port', 'Gdansk',
    'Baltic deep-sea port.',
    ARRAY['Gdansk', 'Gdańsk', 'Danzig'],
    '{"country":"PL","region":"EU","unlocode":"PLGDN"}'::jsonb);


-- ============================================================
-- Ports - North America
-- ============================================================

SELECT shorthand.upsert_term('NYC', 'port', 'New York / New Jersey',
    'Largest US east-coast container port.',
    ARRAY['New York', 'NY/NJ', 'PNYNJ'],
    '{"country":"US","region":"NA","unlocode":"USNYC"}'::jsonb);

SELECT shorthand.upsert_term('LAX', 'port', 'Los Angeles',
    'Largest US west-coast container port.',
    ARRAY['Los Angeles', 'POLA'],
    '{"country":"US","region":"NA","unlocode":"USLAX"}'::jsonb);

SELECT shorthand.upsert_term('LGB', 'port', 'Long Beach',
    'San Pedro Bay neighbour to LAX.',
    ARRAY['Long Beach', 'POLB'],
    '{"country":"US","region":"NA","unlocode":"USLGB"}'::jsonb);

SELECT shorthand.upsert_term('SAV', 'port', 'Savannah',
    'Fastest-growing US east-coast container port.',
    ARRAY['Savannah'],
    '{"country":"US","region":"NA","unlocode":"USSAV"}'::jsonb);

SELECT shorthand.upsert_term('HOU', 'port', 'Houston',
    'Largest US Gulf-coast port.',
    ARRAY['Houston', 'Port Houston'],
    '{"country":"US","region":"NA","unlocode":"USHOU"}'::jsonb);

SELECT shorthand.upsert_term('MTR', 'port', 'Montreal',
    'Largest port in eastern Canada.',
    ARRAY['Montreal', 'Port of Montreal'],
    '{"country":"CA","region":"NA","unlocode":"CAMTR"}'::jsonb);

SELECT shorthand.upsert_term('VAN', 'port', 'Vancouver',
    'Canadas largest port (Pacific).',
    ARRAY['Vancouver', 'Port of Vancouver'],
    '{"country":"CA","region":"NA","unlocode":"CAVAN"}'::jsonb);


-- ============================================================
-- Ports - Far East / Asia-Pacific
-- ============================================================

SELECT shorthand.upsert_term('SHA', 'port', 'Shanghai',
    'Worlds largest container port.',
    ARRAY['Shanghai', 'Port of Shanghai'],
    '{"country":"CN","region":"FE","unlocode":"CNSHA"}'::jsonb);

SELECT shorthand.upsert_term('NGB', 'port', 'Ningbo-Zhoushan',
    'Worlds largest port by cargo tonnage.',
    ARRAY['Ningbo', 'Ningbo-Zhoushan'],
    '{"country":"CN","region":"FE","unlocode":"CNNGB"}'::jsonb);

SELECT shorthand.upsert_term('SIN', 'port', 'Singapore',
    'Major Asia transhipment hub.',
    ARRAY['Singapore', 'Port of Singapore'],
    '{"country":"SG","region":"FE","unlocode":"SGSIN"}'::jsonb);

SELECT shorthand.upsert_term('HKG', 'port', 'Hong Kong',
    'Container port in Kwai Tsing.',
    ARRAY['Hong Kong'],
    '{"country":"HK","region":"FE","unlocode":"HKHKG"}'::jsonb);

SELECT shorthand.upsert_term('BUS', 'port', 'Busan',
    'South Koreas main port; major NE-Asia hub.',
    ARRAY['Busan', 'Pusan'],
    '{"country":"KR","region":"FE","unlocode":"KRPUS"}'::jsonb);

SELECT shorthand.upsert_term('TYO', 'port', 'Tokyo',
    'Japan east-coast container port.',
    ARRAY['Tokyo', 'Port of Tokyo'],
    '{"country":"JP","region":"FE","unlocode":"JPTYO"}'::jsonb);

SELECT shorthand.upsert_term('YOK', 'port', 'Yokohama',
    'Major port serving Greater Tokyo.',
    ARRAY['Yokohama'],
    '{"country":"JP","region":"FE","unlocode":"JPYOK"}'::jsonb);

SELECT shorthand.upsert_term('KAO', 'port', 'Kaohsiung',
    'Taiwans largest port.',
    ARRAY['Kaohsiung'],
    '{"country":"TW","region":"FE","unlocode":"TWKHH"}'::jsonb);

SELECT shorthand.upsert_term('CMB', 'port', 'Colombo',
    'Sri Lankas main port; Indian Ocean transhipment hub.',
    ARRAY['Colombo'],
    '{"country":"LK","region":"FE","unlocode":"LKCMB"}'::jsonb);

SELECT shorthand.upsert_term('NSA', 'port', 'Nhava Sheva',
    'Jawaharlal Nehru Port; Indias largest container port.',
    ARRAY['Nhava Sheva', 'JNPT', 'Mumbai'],
    '{"country":"IN","region":"FE","unlocode":"INNSA"}'::jsonb);


-- ============================================================
-- Ports - LATAM
-- ============================================================

SELECT shorthand.upsert_term('SSZ', 'port', 'Santos',
    'Brazils and LATAMs largest container port.',
    ARRAY['Santos', 'Port of Santos'],
    '{"country":"BR","region":"LATAM","unlocode":"BRSSZ"}'::jsonb);

SELECT shorthand.upsert_term('BUE', 'port', 'Buenos Aires',
    'Argentinas main port.',
    ARRAY['Buenos Aires'],
    '{"country":"AR","region":"LATAM","unlocode":"ARBUE"}'::jsonb);

SELECT shorthand.upsert_term('VAP', 'port', 'Valparaiso',
    'Chiles main central-coast port.',
    ARRAY['Valparaiso', 'Valparaíso'],
    '{"country":"CL","region":"LATAM","unlocode":"CLVAP"}'::jsonb);

SELECT shorthand.upsert_term('CLL', 'port', 'Callao',
    'Perus principal port; serves Lima.',
    ARRAY['Callao'],
    '{"country":"PE","region":"LATAM","unlocode":"PECLL"}'::jsonb);

SELECT shorthand.upsert_term('CTG', 'port', 'Cartagena',
    'Colombias main Caribbean port.',
    ARRAY['Cartagena'],
    '{"country":"CO","region":"LATAM","unlocode":"COCTG"}'::jsonb);


-- ============================================================
-- Document types
-- ============================================================

SELECT shorthand.upsert_term('BL', 'document', 'Bill of Lading',
    'Title document for ocean cargo issued by the carrier.',
    ARRAY['B/L', 'Bill of Lading']);

SELECT shorthand.upsert_term('MBL', 'document', 'Master Bill of Lading',
    'Carrier-issued master B/L; covers all goods on a vessel for an NVOCC / forwarder.',
    ARRAY['Master B/L']);

SELECT shorthand.upsert_term('HBL', 'document', 'House Bill of Lading',
    'Forwarder-issued B/L to the actual shipper / consignee.',
    ARRAY['House B/L']);

SELECT shorthand.upsert_term('SWB', 'document', 'Sea Waybill',
    'Non-negotiable receipt; release does not require surrender of original.',
    ARRAY['Sea Waybill', 'Express B/L']);

SELECT shorthand.upsert_term('AWB', 'document', 'Air Waybill',
    'Air-cargo equivalent of a B/L; non-negotiable.',
    ARRAY['Air Waybill']);

SELECT shorthand.upsert_term('MAWB', 'document', 'Master Air Waybill',
    'Issued by airline to forwarder.',
    ARRAY['Master AWB']);

SELECT shorthand.upsert_term('HAWB', 'document', 'House Air Waybill',
    'Forwarder-issued AWB to the actual shipper / consignee.',
    ARRAY['House AWB']);

SELECT shorthand.upsert_term('CMR', 'document', 'CMR Consignment Note',
    'International road consignment note governed by the CMR Convention.',
    ARRAY['CMR Note']);

SELECT shorthand.upsert_term('COO', 'document', 'Certificate of Origin',
    'Certifies the country in which goods were produced.',
    ARRAY['Cert of Origin']);

SELECT shorthand.upsert_term('EUR1', 'document', 'EUR.1 Movement Certificate',
    'Preferential origin certificate used under EU trade agreements.',
    ARRAY['EUR.1', 'EUR 1']);

SELECT shorthand.upsert_term('T1', 'document', 'T1 Transit Document',
    'Customs transit document for non-EU goods moving under EU transit.',
    ARRAY['T1 Transit']);

SELECT shorthand.upsert_term('T2', 'document', 'T2 Transit Document',
    'Customs transit document for EU goods retaining customs status.',
    ARRAY['T2 Transit']);

SELECT shorthand.upsert_term('SAD', 'document', 'Single Administrative Document',
    'EU customs declaration form (C88 in the UK).',
    ARRAY['C88', 'SAD form']);

SELECT shorthand.upsert_term('ATR', 'document', 'A.TR Movement Certificate',
    'Free-circulation certificate for EU-Turkey customs union.',
    ARRAY['A.TR', 'ATR1']);

SELECT shorthand.upsert_term('PL', 'document', 'Packing List',
    'Itemised list of contents per package / carton.',
    ARRAY['Packing List']);

SELECT shorthand.upsert_term('CI', 'document', 'Commercial Invoice',
    'Sellers invoice used as the basis for customs valuation.',
    ARRAY['Commercial Invoice']);


-- ============================================================
-- Status codes / shipment milestones
-- ============================================================

SELECT shorthand.upsert_term('POL', 'status', 'Port of Loading',
    'Origin port where cargo is loaded onto the vessel.',
    ARRAY['Port of Loading', 'load port']);

SELECT shorthand.upsert_term('POD', 'status', 'Port of Discharge',
    'Destination port where cargo is discharged from the vessel.',
    ARRAY['Port of Discharge', 'discharge port', 'Port of Delivery']);

SELECT shorthand.upsert_term('ETA', 'status', 'Estimated Time of Arrival',
    'Forecast arrival at named location.',
    ARRAY['Estimated Time of Arrival']);

SELECT shorthand.upsert_term('ETD', 'status', 'Estimated Time of Departure',
    'Forecast departure from named location.',
    ARRAY['Estimated Time of Departure']);

SELECT shorthand.upsert_term('ATA', 'status', 'Actual Time of Arrival',
    'Confirmed arrival at named location.',
    ARRAY['Actual Time of Arrival']);

SELECT shorthand.upsert_term('ATD', 'status', 'Actual Time of Departure',
    'Confirmed departure from named location.',
    ARRAY['Actual Time of Departure']);

SELECT shorthand.upsert_term('SOB', 'status', 'Shipped On Board',
    'Bill-of-lading endorsement confirming cargo loaded on vessel.',
    ARRAY['Shipped On Board']);

SELECT shorthand.upsert_term('ROB', 'status', 'Remaining On Board',
    'Cargo still on the vessel at a port call.',
    ARRAY['Remaining On Board']);

SELECT shorthand.upsert_term('CFS', 'status', 'Container Freight Station',
    'Facility where LCL cargo is consolidated / deconsolidated.',
    ARRAY['Container Freight Station']);

SELECT shorthand.upsert_term('CY', 'status', 'Container Yard',
    'Yard where containers are received / dispatched at a port.',
    ARRAY['Container Yard']);

SELECT shorthand.upsert_term('VGM', 'status', 'Verified Gross Mass',
    'SOLAS-mandated verified weight declaration before loading.',
    ARRAY['Verified Gross Mass', 'SOLAS VGM']);

SELECT shorthand.upsert_term('OBL', 'status', 'Original Bill of Lading',
    'Physical original B/L required for cargo release.',
    ARRAY['Original B/L']);


-- ============================================================
-- Carriers - top container lines
-- ============================================================

SELECT shorthand.upsert_term('MSC', 'carrier', 'Mediterranean Shipping Company',
    'Worlds largest container line.',
    ARRAY['MSC'],
    '{"scac":"MSCU"}'::jsonb);

SELECT shorthand.upsert_term('MAERSK', 'carrier', 'Maersk Line',
    'Danish container line; second-largest globally.',
    ARRAY['Maersk', 'MSK', 'A.P. Moller'],
    '{"scac":"MAEU"}'::jsonb);

SELECT shorthand.upsert_term('CMA', 'carrier', 'CMA CGM',
    'French container line; third-largest globally.',
    ARRAY['CMA CGM', 'CMACGM'],
    '{"scac":"CMDU"}'::jsonb);

SELECT shorthand.upsert_term('ONE', 'carrier', 'Ocean Network Express',
    'Japanese container line (NYK + MOL + K-Line merger).',
    ARRAY['Ocean Network Express'],
    '{"scac":"ONEY"}'::jsonb);

SELECT shorthand.upsert_term('HLC', 'carrier', 'Hapag-Lloyd',
    'German container line.',
    ARRAY['Hapag', 'Hapag-Lloyd', 'Hapag Lloyd'],
    '{"scac":"HLCU"}'::jsonb);

SELECT shorthand.upsert_term('EMC', 'carrier', 'Evergreen Marine',
    'Taiwanese container line.',
    ARRAY['Evergreen', 'Evergreen Line'],
    '{"scac":"EGLV"}'::jsonb);

SELECT shorthand.upsert_term('COSCO', 'carrier', 'COSCO Shipping Lines',
    'Chinese state-owned container line.',
    ARRAY['COSCO'],
    '{"scac":"COSU"}'::jsonb);

SELECT shorthand.upsert_term('OOCL', 'carrier', 'Orient Overseas Container Line',
    'Hong Kong-based container line; part of COSCO group.',
    ARRAY['OOCL'],
    '{"scac":"OOLU"}'::jsonb);

SELECT shorthand.upsert_term('YML', 'carrier', 'Yang Ming Marine',
    'Taiwanese container line.',
    ARRAY['Yang Ming'],
    '{"scac":"YMLU"}'::jsonb);

SELECT shorthand.upsert_term('HMM', 'carrier', 'HMM',
    'South Korean container line (formerly Hyundai Merchant Marine).',
    ARRAY['HMM', 'Hyundai Merchant Marine'],
    '{"scac":"HDMU"}'::jsonb);

SELECT shorthand.upsert_term('ZIM', 'carrier', 'ZIM Integrated Shipping',
    'Israeli container line; niche east-west operator.',
    ARRAY['ZIM'],
    '{"scac":"ZIMU"}'::jsonb);


-- ============================================================
-- Units of measure
-- ============================================================

SELECT shorthand.upsert_term('TEU', 'unit', 'Twenty-foot Equivalent Unit',
    'Standard container capacity unit; one 20ft container = 1 TEU.',
    ARRAY['Twenty-foot Equivalent Unit']);

SELECT shorthand.upsert_term('FEU', 'unit', 'Forty-foot Equivalent Unit',
    'Capacity unit; one 40ft container = 1 FEU = 2 TEU.',
    ARRAY['Forty-foot Equivalent Unit']);

SELECT shorthand.upsert_term('CBM', 'unit', 'Cubic Metre',
    'Volume unit for cargo (m^3).',
    ARRAY['cubic metre', 'cubic meter', 'm3']);

SELECT shorthand.upsert_term('KG', 'unit', 'Kilogram',
    'Mass unit.',
    ARRAY['kilogram', 'kilo']);

SELECT shorthand.upsert_term('LBS', 'unit', 'Pounds',
    'Imperial mass unit.',
    ARRAY['lb', 'pound', 'pounds']);

SELECT shorthand.upsert_term('CW', 'unit', 'Chargeable Weight',
    'Greater of actual or volumetric weight; basis for freight charges.',
    ARRAY['Chargeable Weight']);

SELECT shorthand.upsert_term('GW', 'unit', 'Gross Weight',
    'Total weight including packaging.',
    ARRAY['Gross Weight']);

SELECT shorthand.upsert_term('NW', 'unit', 'Net Weight',
    'Weight of goods only (excluding packaging).',
    ARRAY['Net Weight']);
