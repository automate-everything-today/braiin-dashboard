/**
 * Pull Granola meetings within an event's date window and link them to
 * matching event_contacts.
 *
 * The Granola API client is injected so:
 *   - Tests pass a mock that returns fixture meetings + transcripts.
 *   - Production wires it to the Granola MCP tools (Task 5.3).
 *
 * Pipeline:
 *   1. Look up the event's start/end dates and compute the window with
 *      snapshot.granolaThresholds.date_buffer_days padding.
 *   2. listMeetings within that window.
 *   3. For each meeting, fetch transcript and upsert into granola_meetings.
 *   4. SELECT event_contacts for the event.
 *   5. For each (contact, meeting) pair, score and write a link if
 *      confidence is at or above the review_floor.
 */

import { supabase } from "@/services/base";
import { scoreGranolaMatch } from "./granola-match";
import type { RulesSnapshot } from "@/lib/system-rules/types";

export interface GranolaMeetingMetadata {
  id: string;
  title: string;
  recorded_at: string;
  participants?: unknown;
}

export interface GranolaTranscript {
  transcript: string;
  summary: string | null;
}

export interface GranolaApiClient {
  listMeetings(window: { start: string; end: string }): Promise<GranolaMeetingMetadata[]>;
  getTranscript(meetingId: string): Promise<GranolaTranscript>;
}

export interface GranolaImportResult {
  ingested_meetings: number;
  auto_linked: number;
  pending_review: number;
  errors: string[];
}

export async function importGranolaForEvent(
  eventId: number,
  granola: GranolaApiClient,
  snapshot: RulesSnapshot,
): Promise<GranolaImportResult> {
  const result: GranolaImportResult = {
    ingested_meetings: 0,
    auto_linked: 0,
    pending_review: 0,
    errors: [],
  };

  // 1. Look up the event's date window.
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, start_date, end_date")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) throw new Error(`granola: event lookup failed: ${evErr.message}`);
  if (!event) throw new Error(`granola: event ${eventId} not found`);

  const buffer = snapshot.granolaThresholds.date_buffer_days;
  const start = new Date(event.start_date as string);
  start.setDate(start.getDate() - buffer);
  const end = new Date((event.end_date as string | null) ?? (event.start_date as string));
  end.setDate(end.getDate() + buffer);

  // 2. Pull meetings in window.
  let meetings: GranolaMeetingMetadata[];
  try {
    meetings = await granola.listMeetings({
      start: start.toISOString(),
      end: end.toISOString(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "listMeetings failed";
    result.errors.push(`granola.listMeetings: ${msg}`);
    return result;
  }

  // 3. Fetch transcripts and upsert.
  for (const m of meetings) {
    try {
      const { transcript, summary } = await granola.getTranscript(m.id);
      const { error: upErr } = await supabase
        .from("granola_meetings")
        .upsert({
          id: m.id,
          title: m.title,
          recorded_at: m.recorded_at,
          transcript,
          summary,
          participants: m.participants ?? [],
        });
      if (upErr) {
        result.errors.push(`granola_meetings upsert ${m.id}: ${upErr.message}`);
        continue;
      }
      result.ingested_meetings++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "transcript fetch failed";
      result.errors.push(`granola.getTranscript ${m.id}: ${msg}`);
    }
  }

  // 4. Pull contacts for the event.
  const { data: contacts, error: cErr } = await supabase
    .from("event_contacts")
    .select("id, name, last_inbound_at, sent_at")
    .eq("event_id", eventId);
  if (cErr) throw new Error(`granola: event_contacts select failed: ${cErr.message}`);

  // 5. Score every (contact, meeting) pair, write links above review_floor.
  const auto = snapshot.granolaThresholds.auto_link_threshold;
  const review = snapshot.granolaThresholds.review_floor;

  for (const c of contacts ?? []) {
    const contactInput = {
      id: c.id as number,
      name: c.name as string | null,
      first_email_at: ((c.last_inbound_at as string | null) ?? (c.sent_at as string | null)) ?? null,
    };
    for (const m of meetings) {
      const { confidence, method } = scoreGranolaMatch(
        { id: m.id, title: m.title, recorded_at: m.recorded_at },
        contactInput,
        snapshot.granolaThresholds.date_buffer_days,
      );
      if (confidence >= auto) {
        const { error } = await supabase
          .from("event_contact_granola_links")
          .upsert({
            event_contact_id: c.id,
            granola_meeting_id: m.id,
            match_confidence: confidence,
            match_method: method,
          });
        if (error) {
          result.errors.push(`auto-link ${c.id}-${m.id}: ${error.message}`);
        } else {
          result.auto_linked++;
        }
      } else if (confidence >= review) {
        const { error } = await supabase
          .from("event_contact_granola_links")
          .upsert({
            event_contact_id: c.id,
            granola_meeting_id: m.id,
            match_confidence: confidence,
            match_method: "pending_review",
          });
        if (error) {
          result.errors.push(`pending-link ${c.id}-${m.id}: ${error.message}`);
        } else {
          result.pending_review++;
        }
      }
      // confidence < review_floor -> no link
    }
  }

  return result;
}
