import { getIncidentById, updateIncident } from "@/services/incidents";
import { apiResponse, apiError } from "@/lib/validation";
import { getSession } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) return apiError("Invalid ID", 400);
  try {
    const incident = await getIncidentById(numId);
    if (!incident) return apiError("Incident not found", 404);
    return apiResponse({ incident });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { id } = await params;
  const body = await req.json();

  try {
    const numId = parseInt(id);
    if (isNaN(numId)) return apiError("Invalid ID", 400);
    const incident = await updateIncident(numId, {
      ...body,
      resolved_by: body.status === "resolved" ? session.email : undefined,
    });
    return apiResponse({ incident });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
