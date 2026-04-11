import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const email = formData.get("email") as string;

  if (!file || !email) {
    return Response.json({ error: "Missing file or email" }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "File too large (max 5MB)" }, { status: 400 });
  }

  const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (!file.type.startsWith("image/") || !ALLOWED_EXTENSIONS.includes(ext)) {
    return Response.json({ error: "Invalid file type. Only images (jpg, jpeg, png, gif, webp) are allowed." }, { status: 400 });
  }
  const path = `avatars/${email.replace(/[@.]/g, "_")}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from("avatars").upload(path, buffer, {
    upsert: true,
    contentType: file.type,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  return Response.json({ url: urlData.publicUrl + "?t=" + Date.now() });
}
