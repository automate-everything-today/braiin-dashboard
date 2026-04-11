import { getQueueStats } from "@/lib/enrichment/queue";

export async function GET() {
  try {
    const stats = await getQueueStats();
    return Response.json(stats);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
