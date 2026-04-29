/**
 * /api/event-followup/scan
 *
 * POST: run the already-engaged scanner for one event. Updates each
 * pending contact's last_inbound_at, engagement_summary, and flips
 * follow_up_status to 'already_engaged' where signal is found.
 *
 * Body: { event_id: number }
 * Auth: manager / sales_manager / super_admin
 *
 * Returns counts of scanned + flagged contacts.
 */

import { z } from "zod";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { scanEventEngagement } from "@/lib/event-followup/already-engaged";

const ROUTE = "/api/event-followup/scan";

const schema = z.object({
  event_id: z.number().int().positive(),
});

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const result = await scanEventEngagement(parsed.data.event_id);
    return apiResponse({ result });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Scan failed", 500);
  }
}
