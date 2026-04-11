import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get("braiin_session");

  if (!session?.value) {
    return Response.json({ authenticated: false });
  }

  try {
    const data = JSON.parse(session.value);

    if (data.expires_at && data.expires_at < Date.now()) {
      return Response.json({ authenticated: false, reason: "expired" });
    }

    // Fetch latest access from staff table
    let pageAccess: string[] = [];
    let accessRole = data.role || "viewer";

    if (data.staff_id) {
      const { data: staff } = await supabase
        .from("staff")
        .select("access_role, page_access")
        .eq("id", data.staff_id)
        .single();

      if (staff) {
        accessRole = staff.access_role || accessRole;
        pageAccess = staff.page_access || [];
      }
    }

    return Response.json({
      authenticated: true,
      email: data.email,
      name: data.name,
      role: accessRole,
      department: data.department,
      branch: data.branch,
      is_staff: data.is_staff,
      staff_id: data.staff_id,
      page_access: pageAccess,
    });
  } catch {
    return Response.json({ authenticated: false });
  }
}
