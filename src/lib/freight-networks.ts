import { supabase } from "@/services/base";

/**
 * Lookup helpers for the freight_networks directory. The classify-email route
 * uses these to flag emails coming from known freight networks (WCA, Globalia,
 * JCtrans, etc.) so they don't get bucketed as quote_request / agent_request -
 * networks are membership organisations, not clients.
 */

export type FreightNetwork = {
  id: number;
  name: string;
  primary_domain: string;
  additional_domains: string[];
  relationship: "member" | "non-member" | "prospect" | "declined";
  network_type: "general" | "project_cargo" | "specialised" | "association";
  annual_fee_amount: number | null;
  fee_currency: "GBP" | "USD" | "EUR";
  events_per_year: number | null;
  website: string | null;
  notes: string | null;
  parent_network_id: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Extract the lowercased domain from an email address. Returns null if the
 * input doesn't look like an email. Used as the matching key for network
 * lookups.
 */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Returns the freight_network row matching the given email's domain, or null
 * if no match. Checks primary_domain first, then any additional_domains.
 * Active rows only.
 */
export async function findNetworkByEmail(email: string | null | undefined): Promise<FreightNetwork | null> {
  const domain = emailDomain(email);
  if (!domain) return null;

  // Check primary_domain first.
  const { data: byPrimary, error: e1 } = await supabase
    .from("freight_networks")
    .select("*")
    .eq("active", true)
    .eq("primary_domain", domain)
    .limit(1)
    .maybeSingle();
  if (e1) {
    console.warn("[freight-networks] primary lookup failed:", e1.message);
    return null;
  }
  if (byPrimary) return byPrimary as unknown as FreightNetwork;

  // Fall back to additional_domains via Postgres array contains.
  const { data: byAdditional, error: e2 } = await supabase
    .from("freight_networks")
    .select("*")
    .eq("active", true)
    .contains("additional_domains", [domain])
    .limit(1)
    .maybeSingle();
  if (e2) {
    console.warn("[freight-networks] additional lookup failed:", e2.message);
    return null;
  }
  return (byAdditional as unknown as FreightNetwork) || null;
}

/**
 * Render a freight network into a single line for the classifier prompt.
 * Includes the relationship status so Claude can write a sensible summary
 * (e.g. "this is a paid member - they're inviting us as a guest").
 */
export function describeNetworkForPrompt(network: FreightNetwork): string {
  const parts: string[] = [
    network.name,
    `relationship: ${network.relationship}`,
    `type: ${network.network_type}`,
  ];
  if (network.relationship === "member" && network.annual_fee_amount) {
    const symbol = network.fee_currency === "USD" ? "$" : network.fee_currency === "EUR" ? "EUR " : "GBP ";
    parts.push(`annual fee: ${symbol}${network.annual_fee_amount.toLocaleString("en-GB")}`);
  }
  return parts.join("; ");
}
