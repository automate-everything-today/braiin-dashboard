/**
 * Cargo Visibility S2S Trust authentication.
 *
 * Flow (per WiseTech CargoVisibility API Tech Guide section "JWT Token
 * Generation"):
 *   1. We hold clientId + private key + WTG-signed certificate
 *   2. Build a self-signed JWT (RS256) with x5t header derived from the cert
 *   3. POST it to the IdP as private_key_jwt client assertion
 *   4. Receive a short-lived bearer token, use on Cargo Visibility API
 *
 * Tokens are cached per clientId in process memory until ~1 minute
 * before expiry. The cache is intentionally small (one entry per
 * clientId) - Cargo Visibility tokens are short-lived (5-30 min) and
 * each connection has its own clientId.
 */

import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { TmsAuthError } from "../../adapter";

const TOKEN_ENDPOINT = "https://identity.wisetechglobal.com/login/connect/token";
const RESOURCE = "https://cargo.wisegrid.net";
const SCOPE = "cargovisibility.api.all";
const ASSERTION_TTL_SECONDS = 300; // 5 min - per the doc's example
const TOKEN_REFRESH_SAFETY_MS = 60_000; // refresh 60s before expiry

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

interface AuthSecrets {
  clientId: string;
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Compute the x5t (JWT header) value from a PEM certificate. RFC 7515:
 * the SHA-1 hash of the DER cert encoded as base64url.
 */
function computeX5t(certificatePem: string): string {
  const cert = new X509Certificate(certificatePem);
  const sha1 = createHash("sha1").update(cert.raw).digest();
  return sha1.toString("base64url");
}

/**
 * Sign the client_assertion JWT used in the token POST.
 */
async function signClientAssertion(secrets: AuthSecrets): Promise<string> {
  let privateKey;
  try {
    privateKey = await importPKCS8(secrets.privateKeyPem, "RS256");
  } catch (err) {
    throw new TmsAuthError(
      "cargowise",
      `Failed to load private key (must be PEM PKCS#8): ${err instanceof Error ? err.message : err}`,
    );
  }

  let x5t: string;
  try {
    x5t = computeX5t(secrets.certificatePem);
  } catch (err) {
    throw new TmsAuthError(
      "cargowise",
      `Failed to read certificate (must be PEM): ${err instanceof Error ? err.message : err}`,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT", x5t, kid: x5t })
    .setJti(randomUUID())
    .setSubject(secrets.clientId)
    .setIssuer(secrets.clientId)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ASSERTION_TTL_SECONDS)
    .sign(privateKey);
}

/**
 * Get a Cargo Visibility access token, using the in-process cache when
 * possible. Refreshes ~1 minute before expiry.
 */
export async function getCargoVisibilityToken(secrets: AuthSecrets): Promise<string> {
  const cached = tokenCache.get(secrets.clientId);
  if (cached && cached.expiresAt - TOKEN_REFRESH_SAFETY_MS > Date.now()) {
    return cached.token;
  }

  const assertion = await signClientAssertion(secrets);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: secrets.clientId,
    scope: SCOPE,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    resource: RESOURCE,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TmsAuthError(
      "cargowise",
      `IdP token request failed: HTTP ${res.status} ${res.statusText} - ${text.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!json.access_token) {
    throw new TmsAuthError("cargowise", "IdP response did not include access_token");
  }

  const ttlMs = (json.expires_in ?? 1800) * 1000;
  tokenCache.set(secrets.clientId, {
    token: json.access_token,
    expiresAt: Date.now() + ttlMs,
  });

  return json.access_token;
}

/**
 * Resolve secrets from a connection's secrets_ref env-var pointers.
 * Throws if any env var is missing or empty.
 */
export function resolveAuthSecrets(secretsRef: Record<string, string>): AuthSecrets {
  const clientIdEnv = secretsRef.client_id_env || "CARGOWISE_CV_CLIENT_ID";
  const privateKeyEnv = secretsRef.private_key_env || "CARGOWISE_CV_PRIVATE_KEY";
  const certEnv = secretsRef.certificate_env || "CARGOWISE_CV_CERTIFICATE";

  const clientId = process.env[clientIdEnv];
  const privateKeyPem = process.env[privateKeyEnv];
  const certificatePem = process.env[certEnv];

  if (!clientId) throw new TmsAuthError("cargowise", `Missing env var: ${clientIdEnv}`);
  if (!privateKeyPem) throw new TmsAuthError("cargowise", `Missing env var: ${privateKeyEnv}`);
  if (!certificatePem) throw new TmsAuthError("cargowise", `Missing env var: ${certEnv}`);

  // Env vars frequently arrive with literal '\n' instead of real newlines
  // (Vercel's web UI is the usual culprit). Restore them so PEM parsing works.
  const restoreNewlines = (s: string): string => s.replace(/\\n/g, "\n");

  return {
    clientId,
    privateKeyPem: restoreNewlines(privateKeyPem),
    certificatePem: restoreNewlines(certificatePem),
  };
}

/** Test hook - clear the in-process token cache. */
export function clearTokenCache(): void {
  tokenCache.clear();
}
