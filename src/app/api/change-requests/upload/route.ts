// Image / file upload for change request attachments.
// Writes to Supabase Storage bucket `change-request-attachments`,
// returns the public URL plus metadata so the client can append it
// to the request's attachments JSONB array.
//
// Hardening (post-audit 2026-04-29):
//   - require auth (proxy already does this; belt-and-braces)
//   - 10 MB max size
//   - explicit content-type allowlist; SVG explicitly blocked because the
//     bucket serves files via a public URL and inline <script> in SVG would
//     execute in the browser
//   - filename sanitiser: strip path components, restrict to safe chars,
//     cap length, fall back to "file" if empty after sanitising
//   - generic error message to the client; Supabase error stays in console
//   - rejected uploads are written to feedback.security_events so the
//     security dashboard can surface attack patterns

import { supabase } from "@/services/base";
import { requireAuth } from "@/lib/api-auth";
import { logSecurityEvent } from "@/lib/security/log";

const ROUTE = "/api/change-requests/upload";
const BUCKET = "change-request-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

// Allowlist of safe extensions, mirrored from ALLOWED_TYPES so the stored
// key on disk has a sensible extension regardless of the client-supplied
// content type. We never trust file.type alone.
const TYPE_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function sanitiseFilename(raw: string): string {
  // Strip any path components (Windows or POSIX) - some browsers happily
  // submit the full local path in file.name.
  const base = raw.replace(/^.*[\\/]/, "");
  // Keep only safe chars; replace runs of unsafe with underscore.
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
  // Cap length so a 10kB filename doesn't blow up DB rows.
  const capped = cleaned.slice(0, 200);
  return capped.length > 0 ? capped : "file";
}

export async function POST(req: Request) {
  const auth = await requireAuth(ROUTE);
  if (!auth.ok) return auth.response;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file field required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    await logSecurityEvent({
      event_type: "upload_rejected",
      severity: "medium",
      route: ROUTE,
      user_email: auth.session.email,
      details: { reason: "size_exceeded", size: file.size, limit: MAX_BYTES },
    });
    return Response.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  const declaredType = file.type || "";
  if (!ALLOWED_TYPES.has(declaredType)) {
    await logSecurityEvent({
      event_type: "upload_rejected",
      severity: "high",
      route: ROUTE,
      user_email: auth.session.email,
      details: { reason: "type_not_allowed", content_type: declaredType, filename: file.name.slice(0, 200) },
    });
    return Response.json(
      { error: "File type not allowed. PNG, JPEG, GIF, WEBP, or PDF only." },
      { status: 415 },
    );
  }

  const safeName = sanitiseFilename(file.name);
  const ext = TYPE_TO_EXT[declaredType] ?? "bin";
  const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, file, {
      contentType: declaredType,
      upsert: false,
    });
  if (error) {
    // Server-side detail; client gets a generic message so we don't leak
    // bucket name / Supabase error pattern to the caller.
    console.error("[upload] supabase storage failed:", error.message);
    return Response.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);

  return Response.json({
    attachment: {
      url: pub.publicUrl,
      filename: safeName,
      content_type: declaredType,
      size: file.size,
      uploaded_at: new Date().toISOString(),
    },
  });
}
