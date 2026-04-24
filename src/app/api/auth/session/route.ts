import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";

export async function GET() {
  const data = await getSession();
  if (!data) {
    return Response.json({ authenticated: false });
  }

  // Fetch latest access from staff table
  let pageAccess: string[] = [];
  let accessRole = data.role || "viewer";

  if (data.staff_id) {
    const { data: staff, error } = await supabase
      .from("staff")
      .select("access_role, page_access")
      .eq("id", data.staff_id)
      .single();

    if (error) {
      console.error("[auth/session] Failed to load staff access:", error.message);
    }
    if (staff) {
      accessRole = staff.access_role || accessRole;
      // page_access is stored as jsonb and the schema doesn't pin the shape.
      // Narrow to string[] at the boundary.
      if (Array.isArray(staff.page_access)) {
        pageAccess = staff.page_access.filter((x): x is string => typeof x === "string");
      }
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
}
