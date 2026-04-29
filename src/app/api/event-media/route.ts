/**
 * /api/event-media
 *
 * GET ?event_id=...   list event media. Auth: any staff.
 * POST                 multipart upload. Auth: manager+. Max 2MB per file.
 *
 * Storage: 'event-media' bucket created via Supabase Studio with policies
 * restricting upload to manager+ via JWT. RLS on event_media table also
 * gates reads to authenticated users.
 */

import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";

const ROUTE = "/api/event-media";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const eventId = parseInt(url.searchParams.get("event_id") || "0", 10);
  if (!eventId) return apiError("event_id required", 400);

  const { data, error } = await supabase
    .from("event_media")
    .select("id, event_id, storage_path, caption, uploaded_at, uploaded_by")
    .eq("event_id", eventId)
    .order("uploaded_at", { ascending: false });
  if (error) return apiError(error.message, 500);

  // Sign each storage_path so the dashboard can render <img> tags directly.
  const withUrls = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: signed } = await supabase.storage
        .from("event-media")
        .createSignedUrl(row.storage_path as string, 3600);
      return { ...row, signed_url: signed?.signedUrl ?? null };
    }),
  );

  return apiResponse({ media: withUrls });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  // multipart/form-data
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "form parse failed";
    return apiError(`Invalid form data: ${msg}`, 400);
  }

  const eventIdRaw = form.get("event_id");
  const eventId = parseInt(String(eventIdRaw ?? "0"), 10);
  if (!eventId) return apiError("event_id required (multipart field)", 400);

  const captionRaw = form.get("caption");
  const caption =
    typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim() : null;

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) {
    return apiError("file is required and must be a File", 400);
  }

  if (fileEntry.size > MAX_FILE_BYTES) {
    return apiError(
      `File too large (${fileEntry.size} bytes; max ${MAX_FILE_BYTES})`,
      400,
    );
  }

  const mime = fileEntry.type;
  if (!ALLOWED_MIME.has(mime)) {
    return apiError(
      `Unsupported MIME type: ${mime}. Allowed: ${[...ALLOWED_MIME].join(", ")}`,
      400,
    );
  }

  const safeName = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `events/${eventId}/${Date.now()}-${safeName}`;

  const buffer = Buffer.from(await fileEntry.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from("event-media")
    .upload(storagePath, buffer, {
      contentType: mime,
      upsert: false,
    });
  if (upErr) {
    return apiError(`Storage upload failed: ${upErr.message}`, 500);
  }

  const { data: row, error: dbErr } = await supabase
    .from("event_media")
    .insert({
      event_id: eventId,
      storage_path: storagePath,
      caption,
      uploaded_by: auth.session.email ?? null,
    })
    .select()
    .single();
  if (dbErr || !row) {
    // Best-effort cleanup of the uploaded blob.
    await supabase.storage.from("event-media").remove([storagePath]);
    return apiError(`Insert failed: ${dbErr?.message ?? "no row"}`, 500);
  }

  // Sign the URL for immediate use.
  const { data: signed } = await supabase.storage
    .from("event-media")
    .createSignedUrl(storagePath, 3600);

  return apiResponse({ media: { ...row, signed_url: signed?.signedUrl ?? null } });
}
