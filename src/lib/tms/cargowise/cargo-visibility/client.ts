/**
 * Cargo Visibility HTTP client.
 *
 * Calls https://cargo.wisegrid.net/ endpoints with bearer-token auth.
 * Token rotation is handled by getCargoVisibilityToken().
 */

import { TmsAdapterError } from "../../adapter";
import { resolveAuthSecrets, getCargoVisibilityToken } from "./auth";
import type { TmsConnection } from "../../types";

interface CvClientOptions {
  baseUrl?: string;
}

/**
 * POST a UniversalInterchange XML payload to a Cargo Visibility
 * endpoint and return the response body. Caller handles parsing /
 * status checking the IRA/IRJ that comes back.
 */
export async function postUniversalXml(
  connection: TmsConnection,
  endpointPath: string,
  xmlBody: string,
  opts: CvClientOptions = {},
): Promise<{ status: number; body: string }> {
  const baseUrl =
    opts.baseUrl ?? (connection.config?.base_url as string | undefined) ?? "https://cargo.wisegrid.net";
  const url = baseUrl.replace(/\/+$/, "") + endpointPath;

  const secrets = resolveAuthSecrets(connection.secretsRef);
  const token = await getCargoVisibilityToken(secrets);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/xml",
      Accept: "application/xml",
    },
    body: xmlBody,
  });

  const body = await res.text();
  if (!res.ok) {
    throw new TmsAdapterError(
      "cargowise",
      "cargo-visibility-post",
      `HTTP ${res.status} ${res.statusText} - ${body.slice(0, 500)}`,
    );
  }

  return { status: res.status, body };
}

/**
 * GET helper for endpoints like subscription view / supported-carriers
 * that the CV API exposes.
 */
export async function getCargoVisibility(
  connection: TmsConnection,
  endpointPath: string,
  opts: CvClientOptions = {},
): Promise<{ status: number; body: string }> {
  const baseUrl =
    opts.baseUrl ?? (connection.config?.base_url as string | undefined) ?? "https://cargo.wisegrid.net";
  const url = baseUrl.replace(/\/+$/, "") + endpointPath;

  const secrets = resolveAuthSecrets(connection.secretsRef);
  const token = await getCargoVisibilityToken(secrets);

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/xml" },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new TmsAdapterError(
      "cargowise",
      "cargo-visibility-get",
      `HTTP ${res.status} ${res.statusText} - ${body.slice(0, 500)}`,
    );
  }

  return { status: res.status, body };
}

/**
 * DELETE for subscription cancellation.
 */
export async function deleteCargoVisibility(
  connection: TmsConnection,
  endpointPath: string,
  opts: CvClientOptions = {},
): Promise<void> {
  const baseUrl =
    opts.baseUrl ?? (connection.config?.base_url as string | undefined) ?? "https://cargo.wisegrid.net";
  const url = baseUrl.replace(/\/+$/, "") + endpointPath;

  const secrets = resolveAuthSecrets(connection.secretsRef);
  const token = await getCargoVisibilityToken(secrets);

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new TmsAdapterError(
      "cargowise",
      "cargo-visibility-delete",
      `HTTP ${res.status} ${res.statusText} - ${body.slice(0, 500)}`,
    );
  }
}
