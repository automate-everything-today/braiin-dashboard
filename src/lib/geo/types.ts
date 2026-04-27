/**
 * Shared types for geo lookups (UN/LOCODE + country reference).
 */

export interface GeoLocation {
  unlocode: string;
  countryCode: string;
  locationCode: string;
  name: string;
  nameNoDiacritics: string | null;
  subdivision: string | null;
  functions: {
    port: boolean;
    rail: boolean;
    road: boolean;
    airport: boolean;
    postal: boolean;
    icd: boolean;
    fixed: boolean;
    border: boolean;
  };
  status: string | null;
  iataCode: string | null;
  latitude: number | null;
  longitude: number | null;
  sourceRelease: string | null;
}

export interface GeoCountry {
  code: string;
  codeA3: string | null;
  codeNum: string | null;
  name: string;
  officialName: string | null;
  region: string | null;
  subregion: string | null;
}

export type LocationFunction =
  | "port"
  | "rail"
  | "road"
  | "airport"
  | "postal"
  | "icd"
  | "fixed"
  | "border";

export interface SearchOptions {
  country?: string;
  function?: LocationFunction;
  limit?: number;
}
