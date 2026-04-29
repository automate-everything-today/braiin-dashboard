"use client";

/**
 * /dev/system-rules
 *
 * Operator admin surface for the five system-rule categories:
 *   seniority_score, company_match, granola_match, model_routing, baseline_template
 *
 * Each section loads its current value via GET /api/system-rules?category=<cat>,
 * lets the operator edit it, and POSTs to /api/system-rules to save.
 * Undo is available when previous_value is non-null.
 *
 * Manager+ access only (PageGuard).
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import { BraiinLoader } from "@/components/braiin-loader";
import { Plus, RotateCcw, Trash2, Wand2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemRule {
  id: number;
  category: string;
  key: string;
  value: unknown;
  previous_value: unknown;
  notes: string | null;
  active: boolean;
  updated_at: string;
  updated_by: string | null;
}

type Status = "idle" | "loading" | "saving" | "saved" | "error";

// ---------------------------------------------------------------------------
// Shared hook: load + save + undo a single rule slot
// ---------------------------------------------------------------------------

function useSectionRule(category: string, key: string) {
  const [rule, setRule] = useState<SystemRule | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/system-rules?category=${category}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed");
      const found: SystemRule | undefined = (data.rules ?? []).find(
        (r: SystemRule) => r.key === key,
      );
      setRule(found ?? null);
      setStatus("idle");
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Load failed");
      setStatus("error");
    }
  }, [category, key]);

  useEffect(() => { load(); }, [load]);

  async function save(value: unknown, notes?: string) {
    setStatus("saving");
    setErrMsg("");
    try {
      const res = await fetch("/api/system-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, key, value, notes: notes ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setRule(data.rule);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Save failed");
      setStatus("error");
    }
  }

  async function undo() {
    if (!rule?.id) return;
    setStatus("saving");
    try {
      const res = await fetch(`/api/system-rules/${rule.id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Undo failed");
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Undo failed");
      setStatus("error");
    }
  }

  return { rule, status, errMsg, setErrMsg, load, save, undo, setStatus };
}

// ---------------------------------------------------------------------------
// Shared UI: section card header with status + undo + save
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  status,
  errMsg,
  hasPrevious,
  onUndo,
  onSave,
}: {
  title: string;
  status: Status;
  errMsg: string;
  hasPrevious: boolean;
  onUndo: () => void;
  onSave: () => void;
}) {
  return (
    <CardHeader className="py-4 flex flex-row items-center justify-between">
      <CardTitle className="text-base">{title}</CardTitle>
      <div className="flex items-center gap-2">
        {status === "saving" && <span className="text-sm text-zinc-500">Saving...</span>}
        {status === "saved" && <span className="text-sm text-emerald-600 font-medium">Saved</span>}
        {status === "error" && <span className="text-sm text-red-600">{errMsg || "Error"}</span>}
        {hasPrevious && (
          <Button size="sm" variant="outline" onClick={onUndo}>
            <RotateCcw className="h-3 w-3 mr-1" /> Undo
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={status === "saving"}>Save</Button>
      </div>
    </CardHeader>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default function SystemRulesPage() {
  return (
    <PageGuard pageId="system-rules">
      <SystemRulesInner />
    </PageGuard>
  );
}

function SystemRulesInner() {
  return (
    <div className="p-6 space-y-8 w-full">
      <div>
        <h1 className="text-2xl font-semibold">System rules</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Operator-configurable rules that drive AI scoring, matching, model routing and
          outbound template authoring. Changes take effect on the next pipeline run.
        </p>
      </div>
      <SeniorityScoreSection />
      <CompanyMatchSection />
      <GranolaMatchSection />
      <ModelRoutingSection />
      <BaselineTemplateSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: seniority_score
// ---------------------------------------------------------------------------

interface SeniorityRow { keyword: string; score: number }

function SeniorityScoreSection() {
  const { rule, status, errMsg, setErrMsg, setStatus, save, undo } =
    useSectionRule("seniority_score", "weights");
  const [rows, setRows] = useState<SeniorityRow[]>([
    { keyword: "default_unknown", score: 20 },
  ]);

  useEffect(() => {
    if (rule?.value) {
      const val = rule.value as Record<string, number>;
      setRows(Object.entries(val).map(([keyword, score]) => ({ keyword, score })));
    }
  }, [rule]);

  function handleSave() {
    const hasDefault = rows.some((r) => r.keyword === "default_unknown");
    if (!hasDefault) {
      setErrMsg("default_unknown row is required");
      setStatus("error");
      return;
    }
    const value: Record<string, number> = {};
    for (const r of rows) {
      if (r.keyword.trim()) value[r.keyword.trim()] = Number(r.score);
    }
    save(value);
  }

  return (
    <section>
      <Card>
        <SectionHeader
          title="Seniority weights"
          status={status}
          errMsg={errMsg}
          hasPrevious={rule?.previous_value != null}
          onUndo={undo}
          onSave={handleSave}
        />
        <CardContent className="space-y-3">
          <p className="text-xs text-zinc-500">
            Map seniority keywords (e.g. ceo, director) to a score 0-100. The
            default_unknown row is required and locked.
          </p>
          {status === "loading" ? (
            <div className="flex items-center justify-center py-6"><BraiinLoader /></div>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map((row, idx) => {
                  const locked = row.keyword === "default_unknown";
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={row.keyword}
                        onChange={(e) =>
                          setRows((rs) => rs.map((r, i) => i === idx ? { ...r, keyword: e.target.value } : r))
                        }
                        disabled={locked}
                        placeholder="keyword"
                        className="flex-1 px-3 py-2 text-sm border rounded-md disabled:bg-zinc-50 disabled:text-zinc-500"
                      />
                      <input
                        type="number" min={0} max={100} value={row.score}
                        onChange={(e) =>
                          setRows((rs) => rs.map((r, i) => i === idx ? { ...r, score: parseInt(e.target.value, 10) || 0 } : r))
                        }
                        className="w-20 px-3 py-2 text-sm border rounded-md text-right"
                      />
                      <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                        disabled={locked} className="text-zinc-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { keyword: "", score: 50 }])}>
                <Plus className="h-4 w-4 mr-1" /> Add keyword
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: company_match
// ---------------------------------------------------------------------------

interface CompanyMatchValue {
  strip_suffixes: string[];
  treat_and_equal: boolean;
  strip_punctuation: boolean;
  lowercase: boolean;
}

const COMPANY_MATCH_DEFAULTS: CompanyMatchValue = {
  strip_suffixes: [],
  treat_and_equal: true,
  strip_punctuation: true,
  lowercase: true,
};

const COMPANY_TOGGLES = [
  { key: "treat_and_equal" as const, label: "Treat & and And as equal" },
  { key: "strip_punctuation" as const, label: "Strip punctuation before matching" },
  { key: "lowercase" as const, label: "Lowercase before matching" },
];

function CompanyMatchSection() {
  const { rule, status, errMsg, save, undo } =
    useSectionRule("company_match", "config");
  const [form, setForm] = useState<CompanyMatchValue>(COMPANY_MATCH_DEFAULTS);
  const [chipInput, setChipInput] = useState("");

  useEffect(() => {
    if (rule?.value) setForm(rule.value as CompanyMatchValue);
  }, [rule]);

  function addChip() {
    const token = chipInput.trim();
    if (!token) return;
    setForm((f) => ({ ...f, strip_suffixes: [...f.strip_suffixes, token] }));
    setChipInput("");
  }

  return (
    <section>
      <Card>
        <SectionHeader
          title="Company matching"
          status={status}
          errMsg={errMsg}
          hasPrevious={rule?.previous_value != null}
          onUndo={undo}
          onSave={() => save(form)}
        />
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            Controls how company names are normalised before matching. Suffix tokens
            (e.g. Ltd, Inc, GmbH) are stripped before comparison.
          </p>
          {status === "loading" ? (
            <div className="flex items-center justify-center py-6"><BraiinLoader /></div>
          ) : (
            <>
              <div className="space-y-3">
                {COMPANY_TOGGLES.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                      className="h-4 w-4 rounded border-zinc-300" />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-2">
                  Suffix tokens to strip
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.strip_suffixes.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-100 rounded-full text-xs">
                      {s}
                      <button type="button"
                        onClick={() => setForm((f) => ({ ...f, strip_suffixes: f.strip_suffixes.filter((_, j) => j !== i) }))}
                        className="text-zinc-400 hover:text-red-600 ml-0.5">x</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={chipInput} onChange={(e) => setChipInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addChip()}
                    placeholder="e.g. Ltd"
                    className="flex-1 px-3 py-2 text-sm border rounded-md" />
                  <Button size="sm" variant="outline" onClick={addChip}>
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: granola_match
// ---------------------------------------------------------------------------

interface GranolaMatchValue { auto_link_threshold: number; review_floor: number; date_buffer_days: number }

const GRANOLA_FIELDS = [
  { key: "auto_link_threshold" as const, label: "Auto-link threshold", note: "Score >= this = auto-link", min: 0, max: 100 },
  { key: "review_floor" as const, label: "Review floor", note: "Score >= this but below threshold = queued for review", min: 0, max: 100 },
  { key: "date_buffer_days" as const, label: "Date buffer (days)", note: "Days either side of meeting to consider a match", min: 0, max: 30 },
];

function GranolaMatchSection() {
  const { rule, status, errMsg, setErrMsg, setStatus, save, undo } =
    useSectionRule("granola_match", "thresholds");
  const [form, setForm] = useState<GranolaMatchValue>({ auto_link_threshold: 85, review_floor: 60, date_buffer_days: 3 });

  useEffect(() => {
    if (rule?.value) setForm(rule.value as GranolaMatchValue);
  }, [rule]);

  function handleSave() {
    if (form.review_floor >= form.auto_link_threshold) {
      setErrMsg("review_floor must be less than auto_link_threshold");
      setStatus("error");
      return;
    }
    save(form);
  }

  return (
    <section>
      <Card>
        <SectionHeader
          title="Granola matching thresholds"
          status={status}
          errMsg={errMsg}
          hasPrevious={rule?.previous_value != null}
          onUndo={undo}
          onSave={handleSave}
        />
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            Controls auto-linking and review queueing when matching meeting transcripts
            to contacts. review_floor must be less than auto_link_threshold.
          </p>
          {status === "loading" ? (
            <div className="flex items-center justify-center py-6"><BraiinLoader /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {GRANOLA_FIELDS.map(({ key, label, note, min, max }) => (
                <div key={key}>
                  <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
                  <input type="number" min={min} max={max} value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: parseInt(e.target.value, 10) || 0 }))}
                    className="w-full px-3 py-2 text-sm border rounded-md" />
                  <p className="text-xs text-zinc-400 mt-1">{note}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: model_routing
// ---------------------------------------------------------------------------

const DEFAULT_TASKS = [
  "draft_email",
  "seniority_score",
  "company_canonicalisation",
  "granola_match",
  "already_engaged_summary",
  "voice_lint_regenerate",
  "baseline_template_authoring",
];

interface ModelRow { task: string; model: string }

function ModelRoutingSection() {
  const { rule, status, errMsg, setErrMsg, setStatus, save, undo } =
    useSectionRule("model_routing", "routing");
  const [rows, setRows] = useState<ModelRow[]>(DEFAULT_TASKS.map((t) => ({ task: t, model: "" })));

  useEffect(() => {
    if (rule?.value) {
      const val = rule.value as Record<string, string>;
      const allTasks = new Set([...DEFAULT_TASKS, ...Object.keys(val)]);
      setRows(Array.from(allTasks).map((t) => ({ task: t, model: val[t] ?? "" })));
    }
  }, [rule]);

  function handleSave() {
    const hasDraftEmail = rows.some((r) => r.task === "draft_email");
    if (!hasDraftEmail) {
      setErrMsg("draft_email row is required and cannot be removed");
      setStatus("error");
      return;
    }
    const value: Record<string, string> = {};
    for (const r of rows) {
      if (r.task.trim() && r.model.trim()) value[r.task.trim()] = r.model.trim();
    }
    save(value);
  }

  return (
    <section>
      <Card>
        <SectionHeader
          title="Model routing"
          status={status}
          errMsg={errMsg}
          hasPrevious={rule?.previous_value != null}
          onUndo={undo}
          onSave={handleSave}
        />
        <CardContent className="space-y-3">
          <p className="text-xs text-zinc-500">
            Maps each AI task to the model ID it should use. The draft_email row is
            required. Leave a model blank to fall back to the LLM gateway default.
          </p>
          {status === "loading" ? (
            <div className="flex items-center justify-center py-6"><BraiinLoader /></div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 pb-1 border-b">
                  <span className="text-xs uppercase tracking-wide text-zinc-400">Task</span>
                  <span className="text-xs uppercase tracking-wide text-zinc-400">Model ID</span>
                </div>
                {rows.map((row, idx) => {
                  const isDefault = DEFAULT_TASKS.includes(row.task);
                  const isRequired = row.task === "draft_email";
                  return (
                    <div key={idx} className="grid grid-cols-2 gap-2 items-center">
                      <input value={row.task} disabled={isDefault}
                        onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, task: e.target.value } : r))}
                        placeholder="task_name"
                        className="px-3 py-2 text-sm border rounded-md disabled:bg-zinc-50 disabled:text-zinc-500 font-mono" />
                      <div className="flex gap-2 items-center">
                        <input value={row.model}
                          onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, model: e.target.value } : r))}
                          placeholder="e.g. claude-sonnet-4-6"
                          className="flex-1 px-3 py-2 text-sm border rounded-md font-mono" />
                        <Button size="sm" variant="ghost"
                          onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                          disabled={isRequired || isDefault}
                          className="text-zinc-400 hover:text-red-600 disabled:opacity-30">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Button size="sm" variant="outline"
                onClick={() => setRows((rs) => [...rs, { task: "", model: "" }])}>
                <Plus className="h-4 w-4 mr-1" /> Add custom task
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: baseline_template
// ---------------------------------------------------------------------------

const LANGUAGES = ["en", "pt-br"] as const;
type Language = (typeof LANGUAGES)[number];
const TIERS = ["A", "B", "C", "D"] as const;
type TierBand = (typeof TIERS)[number];

interface BaselineFormState {
  greeting_default: string;
  ask_default: string;
  signoff_default: string;
  include_country_hook: boolean;
  length_cap_lines: number;
  rep_first_name: string;
}

interface ProposedTemplate {
  greeting: string;
  ask: string;
  signoff: string;
  length_cap_lines: number;
  include_country_hook: boolean;
  country_hook_template?: string;
}

function BaselineTemplateSection() {
  const [language, setLanguage] = useState<Language>("en");
  const [tierBand, setTierBand] = useState<TierBand>("D");
  const slotKey = `${language}:${tierBand}`;

  const { rule: existingRule, status: loadStatus, load: reloadSlot, save, undo } =
    useSectionRule("baseline_template", slotKey);

  const [form, setForm] = useState<BaselineFormState>({
    greeting_default: "Hi {first_name}",
    ask_default: "",
    signoff_default: "Best regards",
    include_country_hook: false,
    length_cap_lines: 8,
    rep_first_name: "",
  });
  const [proposed, setProposed] = useState<ProposedTemplate | null>(null);
  const [genStatus, setGenStatus] = useState<Status>("idle");
  const [genErr, setGenErr] = useState("");
  const [saveStatus, setSaveStatus] = useState<Status>("idle");
  const [saveErr, setSaveErr] = useState("");

  // Reset proposal when slot changes
  useEffect(() => { setProposed(null); }, [slotKey]);

  async function generate() {
    setGenErr("");
    setGenStatus("saving");
    try {
      const res = await fetch("/api/system-rules/baseline-template/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language, tier_band: tierBand,
          greeting_default: form.greeting_default,
          ask_default: form.ask_default,
          signoff_default: form.signoff_default,
          include_country_hook: form.include_country_hook,
          length_cap_lines: form.length_cap_lines,
          rep_first_name: form.rep_first_name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setProposed({ ...data.proposed });
      setGenStatus("idle");
    } catch (e: unknown) {
      setGenErr(e instanceof Error ? e.message : "Generate failed");
      setGenStatus("error");
    }
  }

  async function saveProposal() {
    if (!proposed) return;
    setSaveErr("");
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/system-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "baseline_template", key: slotKey, value: proposed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      await reloadSlot();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
      setSaveStatus("error");
    }
  }

  return (
    <section>
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Baseline template authoring</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-zinc-500">
            Author the baseline cold-outreach template for a language + tier slot. Fill
            in the questionnaire, generate a proposal via Sonnet, review and edit, then
            save. Slot key = language:tier (e.g. en:D).
          </p>

          {/* Slot picker */}
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}
                className="px-3 py-2 text-sm border rounded-md">
                <option value="en">English (en)</option>
                <option value="pt-br">Portuguese BR (pt-br)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Tier band</label>
              <select value={tierBand} onChange={(e) => setTierBand(e.target.value as TierBand)}
                className="px-3 py-2 text-sm border rounded-md">
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="pt-5">
              <span className="text-sm font-mono bg-zinc-100 px-2 py-1 rounded">Slot: {slotKey}</span>
            </div>
            {existingRule && (
              <div className="pt-5 text-xs text-emerald-600 font-medium">
                Template exists - last saved {new Date(existingRule.updated_at).toLocaleDateString()}
              </div>
            )}
          </div>

          {loadStatus === "loading" ? (
            <div className="flex items-center justify-center py-4"><BraiinLoader /></div>
          ) : (
            <>
              {/* Questionnaire */}
              <div className="border rounded-lg p-4 space-y-4 bg-zinc-50">
                <h3 className="text-sm font-medium">Questionnaire</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Greeting default</label>
                    <input value={form.greeting_default}
                      onChange={(e) => setForm((f) => ({ ...f, greeting_default: e.target.value }))}
                      placeholder="Hi {first_name}"
                      className="w-full px-3 py-2 text-sm border rounded-md bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Signoff default</label>
                    <input value={form.signoff_default}
                      onChange={(e) => setForm((f) => ({ ...f, signoff_default: e.target.value }))}
                      placeholder="Best regards"
                      className="w-full px-3 py-2 text-sm border rounded-md bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Rep first name</label>
                    <input value={form.rep_first_name}
                      onChange={(e) => setForm((f) => ({ ...f, rep_first_name: e.target.value }))}
                      placeholder="Rob"
                      className="w-full px-3 py-2 text-sm border rounded-md bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Length cap (lines)</label>
                    <input type="number" min={2} max={20} value={form.length_cap_lines}
                      onChange={(e) => setForm((f) => ({ ...f, length_cap_lines: parseInt(e.target.value, 10) || 8 }))}
                      className="w-full px-3 py-2 text-sm border rounded-md bg-white" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Ask default</label>
                    <textarea value={form.ask_default}
                      onChange={(e) => setForm((f) => ({ ...f, ask_default: e.target.value }))}
                      rows={2} placeholder="A 15-minute call to understand your current freight setup"
                      className="w-full px-3 py-2 text-sm border rounded-md bg-white resize-none" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={form.include_country_hook}
                        onChange={(e) => setForm((f) => ({ ...f, include_country_hook: e.target.checked }))}
                        className="h-4 w-4 rounded border-zinc-300" />
                      <span className="text-sm">Include country/region hook paragraph</span>
                    </label>
                  </div>
                </div>
                {genErr && <div className="text-sm text-red-600">{genErr}</div>}
                <Button size="sm" onClick={generate}
                  disabled={genStatus === "saving" || !form.ask_default.trim() || !form.rep_first_name.trim()}>
                  <Wand2 className="h-4 w-4 mr-1" />
                  {genStatus === "saving" ? "Generating..." : "Generate proposal"}
                </Button>
              </div>

              {/* Proposal review */}
              {proposed && (
                <div className="border rounded-lg p-4 space-y-4 border-emerald-200 bg-emerald-50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-emerald-800">Proposal - review and edit before saving</h3>
                    <div className="flex items-center gap-2">
                      {saveStatus === "saving" && <span className="text-sm text-zinc-500">Saving...</span>}
                      {saveStatus === "saved" && <span className="text-sm text-emerald-600 font-medium">Saved</span>}
                      {saveStatus === "error" && <span className="text-sm text-red-600">{saveErr}</span>}
                      {existingRule?.previous_value != null && (
                        <Button size="sm" variant="outline" onClick={undo}>
                          <RotateCcw className="h-3 w-3 mr-1" /> Undo
                        </Button>
                      )}
                      <Button size="sm" onClick={saveProposal} disabled={saveStatus === "saving"}>
                        Save template
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {(["greeting", "ask", "signoff"] as const).map((k) => (
                      <div key={k}>
                        <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{k}</label>
                        <textarea value={(proposed[k] as string) ?? ""} rows={k === "ask" ? 3 : 2}
                          onChange={(e) => setProposed((p) => p ? { ...p, [k]: e.target.value } : p)}
                          className="w-full px-3 py-2 text-sm border rounded-md bg-white resize-none" />
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Length cap (lines)</label>
                        <input type="number" min={2} max={20} value={proposed.length_cap_lines}
                          onChange={(e) => setProposed((p) => p ? { ...p, length_cap_lines: parseInt(e.target.value, 10) || 8 } : p)}
                          className="w-full px-3 py-2 text-sm border rounded-md bg-white" />
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={proposed.include_country_hook}
                            onChange={(e) => setProposed((p) => p ? { ...p, include_country_hook: e.target.checked } : p)}
                            className="h-4 w-4 rounded border-zinc-300" />
                          <span className="text-sm">Include country hook</span>
                        </label>
                      </div>
                    </div>
                    {proposed.include_country_hook && (
                      <div>
                        <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Country hook template</label>
                        <textarea value={proposed.country_hook_template ?? ""} rows={2}
                          onChange={(e) => setProposed((p) => p ? { ...p, country_hook_template: e.target.value } : p)}
                          placeholder="We have strong coverage across {country} ..."
                          className="w-full px-3 py-2 text-sm border rounded-md bg-white resize-none" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Existing saved value preview (no proposal shown yet) */}
              {existingRule && !proposed && (
                <div className="border rounded-lg p-4 bg-zinc-50 space-y-2">
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Current saved template for {slotKey}</p>
                  <div className="space-y-1 text-sm">
                    {(["greeting", "ask", "signoff"] as const).map((k) => {
                      const v = existingRule.value as Record<string, string>;
                      return (
                        <div key={k}>
                          <span className="text-zinc-400 text-xs uppercase mr-2">{k}:</span>
                          <span>{v[k] ?? "-"}</span>
                        </div>
                      );
                    })}
                  </div>
                  {existingRule.previous_value != null && (
                    <Button size="sm" variant="outline" onClick={undo} className="mt-2">
                      <RotateCcw className="h-3 w-3 mr-1" /> Undo
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
