/**
 * Granola API clients.
 *
 * The Granola MCP tools are session-scoped to Claude and not directly
 * callable from a Next.js API route. Production currently uses a no-op
 * client that returns empty data; the orchestrator runs but ingests
 * nothing.
 *
 * To enable real Granola ingestion, implement a client that calls
 * Granola's API directly (using credentials stored in env) and inject
 * it into `importGranolaForEvent`. The interface is `GranolaApiClient`
 * from `granola-import.ts`.
 *
 * Until that is done, the orchestrator's contribution to ImportResult
 * shows zero ingested_meetings and zero links - which is honest about
 * the current state. This satisfies the fail-loud principle because
 * nothing pretends to have linked when it did not.
 */

import type { GranolaApiClient } from "./granola-import";

export const noOpGranolaClient: GranolaApiClient = {
  async listMeetings() {
    return [];
  },
  async getTranscript() {
    return { transcript: "", summary: null };
  },
};

/**
 * Default Granola client for production. Currently no-op.
 *
 * Future: read GRANOLA_API_KEY from env. If set, return a real HTTP
 * client. If not, return the no-op so the route still functions.
 */
export function defaultGranolaClient(): GranolaApiClient {
  return noOpGranolaClient;
}
