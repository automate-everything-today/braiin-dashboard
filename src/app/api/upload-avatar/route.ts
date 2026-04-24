import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";

const ADMIN_ROLES = new Set(["admin", "super_admin", "branch_md"]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const requestedEmail = (formData.get("email") as string | null)?.trim().toLowerCase();

  if (!file) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }

  // Users can only overwrite their own avatar. Admins can overwrite anyone's
  // (useful when onboarding new staff). Never trust the email from form data
  // without verifying the caller has permission to write to that path.
  const targetEmail = requestedEmail && requestedEmail !== session.email.toLowerCase()
    ? requestedEmail
    : session.email.toLowerCase();

  if (targetEmail !== session.email.toLowerCase() && !ADMIN_ROLES.has(session.role)) {
    console.warn(
      `[upload-avatar] ${session.email} (role=${session.role}) attempted to upload avatar for ${targetEmail}`,
    );
    return Response.json({ error: "Cannot upload avatar for another user" }, { status: 403 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "File too large (max 5MB)" }, { status: 400 });
  }

  const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (!file.type.startsWith("image/") || !ALLOWED_EXTENSIONS.includes(ext)) {
    return Response.json({ error: "Invalid file type. Only images (jpg, jpeg, png, gif, webp) are allowed." }, { status: 400 });
  }
  const path = `avatars/${targetEmail.replace(/[@.]/g, "_")}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from("avatars").upload(path, buffer, {
    upsert: true,
    contentType: file.type,
  });

  if (error) {
    console.error(`[upload-avatar] Upload failed for ${targetEmail}:`, error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  return Response.json({ url: urlData.publicUrl + "?t=" + Date.now() });
}
