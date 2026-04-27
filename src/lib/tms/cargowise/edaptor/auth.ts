/**
 * eAdaptor HTTP+XML basic-auth.
 *
 * eAdaptor uses HTTP Basic with the credentials from the CargoWise
 * registry under `eServices > eAdaptor > Inbound > Basic Authentication`.
 * SOAP and HTTP+XML share the same credentials.
 *
 * Endpoint: `https://<enterprise-code>services.wisegrid.net/eAdaptor`
 * (same host as the SOAP endpoint, with the trailing path replaced).
 */

import { TmsAuthError } from "../../adapter";

export interface EdaptorSecrets {
  url: string;
  username: string;
  password: string;
  enterpriseId?: string;
  serverId?: string;
  companyCode?: string;
}

export function resolveEdaptorSecrets(
  secretsRef: Record<string, string>,
  config: Record<string, unknown>,
): EdaptorSecrets {
  const urlEnv = secretsRef.url_env || "CARGOWISE_EDAPTOR_URL";
  const userEnv = secretsRef.username_env || "CARGOWISE_EDAPTOR_USERNAME";
  const passEnv = secretsRef.password_env || "CARGOWISE_EDAPTOR_PASSWORD";

  const url = (process.env[urlEnv] || (config.url as string | undefined) || "").trim();
  const username = (process.env[userEnv] || "").trim();
  const password = (process.env[passEnv] || "").trim();

  if (!url) throw new TmsAuthError("cargowise", `Missing env var: ${urlEnv}`);
  if (!username) throw new TmsAuthError("cargowise", `Missing env var: ${userEnv}`);
  if (!password) throw new TmsAuthError("cargowise", `Missing env var: ${passEnv}`);

  return {
    url: url.replace(/\/+$/, ""),
    username,
    password,
    enterpriseId:
      (config.enterprise_id as string | undefined) ||
      process.env.CARGOWISE_EDAPTOR_ENTERPRISE_ID ||
      undefined,
    serverId:
      (config.server_id as string | undefined) ||
      process.env.CARGOWISE_EDAPTOR_SERVER_ID ||
      undefined,
    companyCode:
      (config.company_code as string | undefined) ||
      process.env.CARGOWISE_EDAPTOR_COMPANY_CODE ||
      undefined,
  };
}

export function buildBasicAuthHeader(secrets: EdaptorSecrets): string {
  const token = Buffer.from(`${secrets.username}:${secrets.password}`).toString("base64");
  return `Basic ${token}`;
}
