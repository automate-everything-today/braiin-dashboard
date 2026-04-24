import { supabase } from "@/services/base";

// GET - search emails by tag
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tag = url.searchParams.get("tag");
  const emailId = url.searchParams.get("emailId");

  if (emailId) {
    const { data } = await supabase.from("email_tags")
      .select("*").eq("email_id", emailId).order("created_at");
    return Response.json({ tags: data || [] });
  }

  if (tag) {
    // Search all emails with this tag - primary threads first
    const { data } = await supabase.from("email_tags")
      .select("*").eq("tag", tag)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false });
    return Response.json({ tagged_emails: data || [] });
  }

  // Get all unique tags with counts
  const { data } = await supabase.from("email_tags")
    .select("tag, tag_type, party");
  const tagCounts: Record<string, { count: number; type: string; parties: string[] }> = {};
  for (const t of (data || [])) {
    if (!tagCounts[t.tag]) tagCounts[t.tag] = { count: 0, type: t.tag_type ?? "", parties: [] };
    tagCounts[t.tag].count++;
    if (t.party && !tagCounts[t.tag].parties.includes(t.party)) tagCounts[t.tag].parties.push(t.party);
  }
  return Response.json({ tags: tagCounts });
}

// POST - add a tag to an email
export async function POST(req: Request) {
  const { email_id, tag, tag_type, tagged_by, auto_tagged, party, is_primary } = await req.json();
  if (!email_id || !tag) return Response.json({ error: "Missing email_id or tag" }, { status: 400 });

  // If marking as primary, unset any existing primary for this tag
  if (is_primary) {
    await supabase.from("email_tags")
      .update({ is_primary: false })
      .eq("tag", tag.toUpperCase().trim())
      .eq("is_primary", true);
  }

  const { error } = await supabase.from("email_tags").upsert({
    email_id,
    tag: tag.toUpperCase().trim(),
    tag_type: tag_type || "job_ref",
    tagged_by: tagged_by || "",
    auto_tagged: auto_tagged || false,
    party: party || null,
    is_primary: is_primary || false,
  }, { onConflict: "email_id,tag" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

// PATCH - update tag (set party or primary)
export async function PATCH(req: Request) {
  const { email_id, tag, party, is_primary } = await req.json();
  if (!email_id || !tag) return Response.json({ error: "Missing fields" }, { status: 400 });

  // If setting primary, unset others first
  if (is_primary) {
    await supabase.from("email_tags")
      .update({ is_primary: false })
      .eq("tag", tag)
      .eq("is_primary", true);
  }

  const updates: any = {};
  if (party !== undefined) updates.party = party;
  if (is_primary !== undefined) updates.is_primary = is_primary;

  const { error } = await supabase.from("email_tags")
    .update(updates)
    .eq("email_id", email_id)
    .eq("tag", tag);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

// DELETE - remove a tag
export async function DELETE(req: Request) {
  const { email_id, tag } = await req.json();
  if (!email_id || !tag) return Response.json({ error: "Missing fields" }, { status: 400 });

  await supabase.from("email_tags").delete().eq("email_id", email_id).eq("tag", tag);
  return Response.json({ success: true });
}
