/**
 * Score a (Granola meeting, event_contact) pair for likelihood of being
 * the same person. Used by the importer's Granola ingestion pass to decide
 * whether to auto-link, queue for operator review, or ignore.
 *
 * Methods (highest confidence first):
 *   - name_exact (100): first name is a token in the meeting title AND the
 *     contact's first interaction is within the date buffer window.
 *   - name_fuzzy (60-90): >=50% of the contact's name tokens appear as
 *     tokens in the title, AND date is in window. Score = 60 + overlap*30.
 *   - name_and_date (60): first name in title but date OUT of window.
 *   - none (0): no first-name token match and no fuzzy hit.
 *
 * Pure function. Caller compares against system_rules.granola_match
 * thresholds (auto_link_threshold / review_floor) to decide what to do.
 */

interface MeetingInput {
  id: string;
  title: string;
  recorded_at: string;
}

interface ContactInput {
  id: number;
  name: string | null;
  first_email_at: string | null;
}

export type MatchMethod =
  | "name_exact"
  | "name_fuzzy"
  | "name_and_date"
  | "none";

export interface MatchResult {
  confidence: number;
  method: MatchMethod;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

export function scoreGranolaMatch(
  meeting: MeetingInput,
  contact: ContactInput,
  dateBufferDays: number,
): MatchResult {
  if (!contact.name) return { confidence: 0, method: "none" };

  const titleTokens = tokens(meeting.title);
  const nameTokens = tokens(contact.name);
  if (nameTokens.length === 0) return { confidence: 0, method: "none" };

  const firstName = nameTokens[0];
  const firstNameInTitle = titleTokens.includes(firstName);
  const overlap =
    nameTokens.filter((t) => titleTokens.includes(t)).length / nameTokens.length;

  // Date proximity. If the contact has no interaction date, we don't
  // penalise — assume in-window. (The contact was imported recently;
  // the recording is likely from the event.)
  const inWindow = (() => {
    if (!contact.first_email_at) return true;
    const ms = Math.abs(
      new Date(meeting.recorded_at).getTime() -
        new Date(contact.first_email_at).getTime(),
    );
    return ms <= dateBufferDays * 24 * 60 * 60 * 1000;
  })();

  if (firstNameInTitle && inWindow) {
    return { confidence: 100, method: "name_exact" };
  }
  if (overlap >= 0.5 && inWindow) {
    return {
      confidence: Math.round(60 + overlap * 30),
      method: "name_fuzzy",
    };
  }
  if (firstNameInTitle) {
    return { confidence: 60, method: "name_and_date" };
  }
  return { confidence: 0, method: "none" };
}
