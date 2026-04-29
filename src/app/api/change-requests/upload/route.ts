// Image / file upload for change request attachments.
// Writes to Supabase Storage bucket `change-request-attachments`,
// returns the public URL plus metadata so the client can append it
// to the request's attachments JSONB array.

import { supabase } from "@/services/base";

const BUCKET = "change-request-attachments";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file field required" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) {
    return Response.json(
      {
        error: `upload failed: ${error.message}. Make sure the '${BUCKET}' bucket exists in Supabase Storage.`,
      },
      { status: 500 },
    );
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);

  return Response.json({
    attachment: {
      url: pub.publicUrl,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      uploaded_at: new Date().toISOString(),
    },
  });
}
