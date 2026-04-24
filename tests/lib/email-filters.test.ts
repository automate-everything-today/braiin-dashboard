import { describe, it, expect } from "vitest";
import {
  isUserInTo,
  isUserInCc,
  isFyiEmail,
  isMarketingEmail,
} from "@/types/email";
import type { Email } from "@/types/email";

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "msg-1",
    subject: "Test",
    preview: "preview",
    body: "",
    from: "sender@external.com",
    fromName: "Sender",
    to: [],
    cc: [],
    date: "2026-04-24T00:00:00Z",
    isRead: false,
    hasAttachments: false,
    hasInlineImages: false,
    conversationId: "conv-1",
    matchedAccount: null,
    matchedCompany: null,
    unsubscribeUrl: null,
    ...overrides,
  };
}

describe("isUserInTo / isUserInCc", () => {
  const me = "rob@corten.co.uk";

  it("matches logged-in user exactly, not other company staff on the To line", () => {
    const email = makeEmail({ to: ["sam@corten.co.uk", "hathim@corten.co.uk"] });
    expect(isUserInTo(email, me)).toBe(false);
  });

  it("matches when user is on the To line alongside colleagues", () => {
    const email = makeEmail({ to: ["rob@corten.co.uk", "sam@corten.co.uk"] });
    expect(isUserInTo(email, me)).toBe(true);
  });

  it("matches CC'd email correctly when user is only in Cc", () => {
    const email = makeEmail({
      to: ["sam@corten.co.uk"],
      cc: ["rob@corten.co.uk"],
    });
    expect(isUserInCc(email, me)).toBe(true);
    expect(isUserInTo(email, me)).toBe(false);
  });

  it("is case-insensitive on email comparison", () => {
    const email = makeEmail({ to: ["ROB@Corten.CO.UK"] });
    expect(isUserInTo(email, me)).toBe(true);
  });

  it("falls back to domain-match when userEmail is not provided (legacy)", () => {
    const email = makeEmail({ to: ["sam@corten.co.uk"] });
    // Without userEmail, the old behaviour: any internal domain match.
    // The fallback uses CUSTOMER.emailDomain which defaults to "example.com"
    // in tests, so this should NOT match.
    expect(isUserInTo(email)).toBe(false);
  });

  it("returns false for empty to/cc", () => {
    const email = makeEmail({ to: [], cc: [] });
    expect(isUserInTo(email, me)).toBe(false);
    expect(isUserInCc(email, me)).toBe(false);
  });

  it("ignores null addresses in the list", () => {
    const email = makeEmail({ to: [null as unknown as string, "rob@corten.co.uk"] });
    expect(isUserInTo(email, me)).toBe(true);
  });
});

describe("isMarketingEmail", () => {
  it("trusts the AI classification when it says marketing", () => {
    const email = makeEmail({ from: "friend@normal.com" });
    expect(isMarketingEmail(email, "marketing")).toBe(true);
  });

  it("does not flag direct emails as marketing by classification alone", () => {
    const email = makeEmail({ from: "customer@acme.com" });
    expect(isMarketingEmail(email, "direct")).toBe(false);
  });

  it("flags emails with a List-Unsubscribe header", () => {
    const email = makeEmail({
      from: "news@example.com",
      unsubscribeUrl: "https://example.com/unsub?id=123",
    });
    expect(isMarketingEmail(email)).toBe(true);
  });

  it("flags known marketing-tool domains", () => {
    expect(isMarketingEmail(makeEmail({ from: "a@mailchimp.com" }))).toBe(true);
    expect(isMarketingEmail(makeEmail({ from: "a@hubspot.com" }))).toBe(true);
    expect(isMarketingEmail(makeEmail({ from: "a@mailerlite.com" }))).toBe(true);
  });

  it("flags newsletter-ish local parts", () => {
    expect(isMarketingEmail(makeEmail({ from: "newsletter@acme.com" }))).toBe(true);
    expect(isMarketingEmail(makeEmail({ from: "marketing@acme.com" }))).toBe(true);
    expect(isMarketingEmail(makeEmail({ from: "promo@shop.com" }))).toBe(true);
  });

  it("does NOT flag a plain business email as marketing", () => {
    expect(isMarketingEmail(makeEmail({ from: "ops@acme-logistics.com" }))).toBe(false);
    expect(isMarketingEmail(makeEmail({ from: "accounts@client.co.uk" }))).toBe(false);
  });

  it("does NOT mistake a 'support@' email for marketing (that's FYI, not marketing)", () => {
    expect(isMarketingEmail(makeEmail({ from: "support@service.com" }))).toBe(false);
  });
});

describe("isFyiEmail", () => {
  it("flags noreply addresses", () => {
    expect(isFyiEmail(makeEmail({ from: "noreply@service.com" }))).toBe(true);
    expect(isFyiEmail(makeEmail({ from: "no-reply@service.com" }))).toBe(true);
  });

  it("flags notification addresses", () => {
    expect(isFyiEmail(makeEmail({ from: "notifications@app.com" }))).toBe(true);
  });

  it("does not flag regular business addresses", () => {
    expect(isFyiEmail(makeEmail({ from: "alice@client.com" }))).toBe(false);
  });
});
