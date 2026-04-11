import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET - list blocked senders
export async function GET() {
  const { data } = await supabase.from("email_blocked_senders")
    .select("*").order("created_at", { ascending: false });
  return Response.json({ blocked: data || [] });
}

// POST - block a sender or domain
export async function POST(req: Request) {
  const { email_address, domain, blocked_by, reason } = await req.json();
  if (!email_address && !domain) {
    return Response.json({ error: "Provide email_address or domain" }, { status: 400 });
  }

  const { error } = await supabase.from("email_blocked_senders").upsert({
    email_address: email_address || null,
    domain: domain || null,
    blocked_by: blocked_by || "",
    reason: reason || "manual_block",
  }, { onConflict: "email_address" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

// DELETE - unblock a sender or domain
export async function DELETE(req: Request) {
  const { email_address, domain } = await req.json();

  if (email_address) {
    await supabase.from("email_blocked_senders").delete().eq("email_address", email_address);
  } else if (domain) {
    await supabase.from("email_blocked_senders").delete().eq("domain", domain);
  } else {
    return Response.json({ error: "Provide email_address or domain" }, { status: 400 });
  }

  return Response.json({ success: true });
}
