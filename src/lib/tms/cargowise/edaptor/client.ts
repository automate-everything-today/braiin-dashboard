/**
 * eAdaptor HTTP+XML client.
 *
 * Single endpoint, multiple components - the component is selected by
 * the XML root element of the request body. POST returns the response
 * XML directly. GET on the same URL returns a landing-page HTML which
 * we use as a healthcheck signal.
 */

import { TmsAdapterError } from "../../adapter";
import { buildBasicAuthHeader, type EdaptorSecrets } from "./auth";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface EdaptorPostResult {
  status: number;
  body: string;
}

/**
 * POST an XML request body. Returns the response XML on 2xx, throws
 * TmsAdapterError otherwise. The eAdaptor service responds with XML
 * (UniversalResponse / UniversalEvent depending on component).
 */
export async function postEdaptorXml(
  secrets: EdaptorSecrets,
  xmlBody: string,
  opts: { timeoutMs?: number } = {},
): Promise<EdaptorPostResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(secrets.url, {
      method: "POST",
      headers: {
        Authorization: buildBasicAuthHeader(secrets),
        "Content-Type": "application/xml; charset=utf-8",
        Accept: "application/xml",
      },
      body: xmlBody,
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new TmsAdapterError(
        "cargowise",
        "edaptor-post",
        `HTTP ${res.status} ${res.statusText} - ${body.slice(0, 500)}`,
      );
    }
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof TmsAdapterError) throw err;
    throw new TmsAdapterError(
      "cargowise",
      "edaptor-post",
      err instanceof Error ? err.message : String(err),
      err,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET the eAdaptor landing page. Used for connectivity smoke-testing
 * because we don't need to send a valid XML body to confirm the URL +
 * credentials are good.
 */
export async function probeEdaptor(secrets: EdaptorSecrets): Promise<{
  ok: boolean;
  status: number;
  message: string;
}> {
  try {
    const res = await fetch(secrets.url, {
      method: "GET",
      headers: { Authorization: buildBasicAuthHeader(secrets) },
    });
    if (res.status === 401) {
      return { ok: false, status: 401, message: "Bad credentials" };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true, status: res.status, message: "Reachable" };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
