// Personal access token helper. Tokens are SHA-256 hashed before storage.
// Generated tokens have format `bra_<32 hex chars>` and are only shown once.

import { supabase } from "@/services/base";
import { createHash, randomBytes } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

export function generatePersonalToken(): { plaintext: string; sha256: string } {
  const plaintext = "bra_" + randomBytes(32).toString("hex");
  const sha256 = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, sha256 };
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Look up an active personal token by its plaintext value. Returns the
 * row (without the hash) on hit, null on miss or revoked. Also bumps
 * last_used_at on hit (best-effort).
 */
export async function verifyPersonalToken(
  plaintext: string,
): Promise<{ user_email: string; token_id: string; label: string } | null> {
  if (!plaintext.startsWith("bra_")) return null;
  const sha = hashToken(plaintext);
  const { data, error } = await db
    .schema("feedback")
    .from("personal_tokens")
    .select("token_id, user_email, label, revoked_at")
    .eq("token_sha256", sha)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  void db
    .schema("feedback")
    .from("personal_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_id", data.token_id);
  return { user_email: data.user_email, token_id: data.token_id, label: data.label };
}
