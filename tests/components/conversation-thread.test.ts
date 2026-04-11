// tests/components/conversation-thread.test.ts
import { describe, it, expect } from "vitest";
import { formatMessageTime, groupMessagesByDate } from "@/components/conversation/conversation-thread";
import type { ConversationMessage } from "@/types";

const makeMsg = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
  id: "1",
  type: "incoming",
  author_name: "James Wilson",
  author_email: "james@maersk.com",
  author_initials: "JW",
  content: "Hello",
  channel: "email",
  timestamp: "2026-04-06T14:32:00Z",
  ...overrides,
});

describe("formatMessageTime", () => {
  it("formats time as HH:MM", () => {
    const result = formatMessageTime("2026-04-06T14:32:00Z");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe("groupMessagesByDate", () => {
  it("groups messages by date", () => {
    const msgs = [
      makeMsg({ id: "1", timestamp: "2026-04-05T09:00:00Z" }),
      makeMsg({ id: "2", timestamp: "2026-04-05T10:00:00Z" }),
      makeMsg({ id: "3", timestamp: "2026-04-06T14:00:00Z" }),
    ];
    const groups = groupMessagesByDate(msgs);
    expect(groups.length).toBe(2);
    expect(groups[0].messages.length).toBe(2);
    expect(groups[1].messages.length).toBe(1);
  });

  it("returns empty array for no messages", () => {
    const groups = groupMessagesByDate([]);
    expect(groups.length).toBe(0);
  });
});
