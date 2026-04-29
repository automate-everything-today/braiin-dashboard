/**
 * /api/voice-rules - CRUD for the anti-AI writing style enforcement layer.
 *
 * Read access:    any authenticated staff member (linter loads active rules).
 * Write access:   manager, sales_manager, super_admin.
 *
 * Each write invalidates the linter cache so new bans take effect on the
 * next draft generation. The catch_count + last_caught_at columns are
 * managed by the linter via the voice_rules_record_catch RPC; this route
 * does not touch them.
 *
 * Schema: see supabase/migrations/056_voice_rules.sql.
 * Linter: see src/lib/voice/lint.ts.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { invalidateVoiceRulesCache } from "@/lib/voice/lint";
import { CHANNELS, RULE_TYPES, SEVERITIES } from "@/lib/voice/types";

const ROUTE = "/api/voice-rules";

const createSchema = z.object({
  rule_type: z.enum(RULE_TYPES),
  pattern: z.string().min(1).max(500),
  replacement: z.string().min(1).max(1000),
  severity: z.enum(SEVERITIES).default("block"),
  channel: z.enum(CHANNELS).default("all"),
  notes: z.string().max(2000).nullable().optional(),
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  pattern: z.string().min(1).max(500).optional(),
  replacement: z.string().min(1).max(1000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  channel: z.enum(CHANNELS).optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const ruleType = url.searchParams.get("rule_type");
  const channel = url.searchParams.get("channel");
  const includeInactive = url.searchParams.get("include_inactive") === "true";

  let query = supabase.from("voice_rules").select("*");
  if (!includeInactive) query = query.eq("active", true);
  if (ruleType && (RULE_TYPES as readonly string[]).includes(ruleType)) {
    query = query.eq("rule_type", ruleType as (typeof RULE_TYPES)[number]);
  }
  if (channel && (CHANNELS as readonly string[]).includes(channel)) {
    query = query.eq("channel", channel as (typeof CHANNELS)[number]);
  }

  const { data, error } = await query
    .order("rule_type", { ascending: true })
    .order("pattern", { ascending: true });
  if (error) return apiError(error.message, 500);
  return apiResponse({ rules: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  const { data, error } = await supabase
    .from("voice_rules")
    .insert({
      rule_type: input.rule_type,
      pattern: input.pattern.trim(),
      replacement: input.replacement.trim(),
      severity: input.severity,
      channel: input.channel,
      notes: input.notes ?? null,
      added_by: auth.session.email,
      active: true,
    })
    .select()
    .single();
  if (error) {
    // Unique violation = duplicate (rule_type, pattern, channel).
    if (error.code === "23505") {
      return apiError("A rule with this pattern + channel already exists", 409);
    }
    return apiError(error.message, 500);
  }

  invalidateVoiceRulesCache();
  return apiResponse({ rule: data });
}

export async function PATCH(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...updates } = parsed.data;

  const payload: Record<string, unknown> = {};
  if (updates.pattern !== undefined) payload.pattern = updates.pattern.trim();
  if (updates.replacement !== undefined) payload.replacement = updates.replacement.trim();
  if (updates.severity !== undefined) payload.severity = updates.severity;
  if (updates.channel !== undefined) payload.channel = updates.channel;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.active !== undefined) payload.active = updates.active;

  if (Object.keys(payload).length === 0) {
    return apiError("No fields to update", 400);
  }

  const { data, error } = await supabase
    .from("voice_rules")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiError(error.message, 500);

  invalidateVoiceRulesCache();
  return apiResponse({ rule: data });
}

export async function DELETE(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) return apiError("id required", 400);

  // Soft delete preferred - keeps catch_count history intact for analysis.
  const { error } = await supabase
    .from("voice_rules")
    .update({ active: false })
    .eq("id", id);
  if (error) return apiError(error.message, 500);

  invalidateVoiceRulesCache();
  return apiResponse({ success: true });
}
