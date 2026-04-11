import { NextRequest } from "next/server";

const PIPEDRIVE_BASE = "https://api.pipedrive.com/v1";

function apiError(message: string, status = 400) {
  return Response.json({ success: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  const token = process.env.PIPEDRIVE_TOKEN;
  if (!token) return apiError("Pipedrive not configured", 503);

  const body = await req.json();
  const { endpoint, method = "POST", data } = body;

  if (!endpoint || typeof endpoint !== "string") {
    return apiError("endpoint is required");
  }

  // Only allow known Pipedrive API paths
  const allowed = /^\/?(deals|organizations|persons|notes|activities)(\/\d+)?$/;
  if (!allowed.test(endpoint)) {
    return apiError("endpoint not allowed", 403);
  }

  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${PIPEDRIVE_BASE}/${endpoint.replace(/^\//, "")}${separator}api_token=${token}`;

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    const json = await res.json();
    return Response.json(json, { status: res.status });
  } catch (e: any) {
    return apiError(`Pipedrive request failed: ${e.message}`, 502);
  }
}

export async function PUT(req: NextRequest) {
  const token = process.env.PIPEDRIVE_TOKEN;
  if (!token) return apiError("Pipedrive not configured", 503);

  const body = await req.json();
  const { endpoint, data } = body;

  if (!endpoint || typeof endpoint !== "string") {
    return apiError("endpoint is required");
  }

  const allowed = /^\/?(deals|organizations|persons|notes|activities)(\/\d+)?$/;
  if (!allowed.test(endpoint)) {
    return apiError("endpoint not allowed", 403);
  }

  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${PIPEDRIVE_BASE}/${endpoint.replace(/^\//, "")}${separator}api_token=${token}`;

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
    });
    const json = await res.json();
    return Response.json(json, { status: res.status });
  } catch (e: any) {
    return apiError(`Pipedrive request failed: ${e.message}`, 502);
  }
}
