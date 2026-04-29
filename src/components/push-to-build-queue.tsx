"use client";

/**
 * Reusable "Push to build queue" button + modal.
 *
 * Drops onto any node-style entity (roadmap node, finding, change request).
 * Pre-generates a Markdown prompt from the source data + lets the operator
 * append additional notes before pushing. Notes get appended to the
 * prompt so the terminal helper sees one combined block.
 */

import { useState } from "react";
import { Hammer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PILL_SM } from "@/lib/ui-constants";

export interface BuildQueuePushSource {
  source_type: "roadmap" | "finding" | "change_request" | "manual";
  source_id?: string | null;
  title: string;
  /** Pre-generated context block to seed the prompt textarea. */
  context: string;
  /** Optional default working directory. */
  working_dir?: string;
}

export function PushToBuildQueueButton(props: BuildQueuePushSource & { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 ${props.compact ? "text-[10px]" : "text-[11px]"} text-violet-700 hover:bg-violet-50 px-1.5 py-0.5 rounded`}
        title="Push to build queue"
      >
        <Hammer className={props.compact ? "size-2.5" : "size-3"} />
        {!props.compact && "build"}
      </button>
    );
  }
  return <PushModal {...props} onClose={() => setOpen(false)} />;
}

function PushModal({ source_type, source_id, title, context, working_dir, onClose }: BuildQueuePushSource & { onClose: () => void }) {
  const [titleInput, setTitleInput] = useState(title);
  const [prompt, setPrompt] = useState(context);
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [wd, setWd] = useState(working_dir ?? "/Users/robdonald-agent/ai-projects/Corten Outreach/dashboard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);

  async function push() {
    setBusy(true);
    setErr(null);
    try {
      // Append notes to prompt so the terminal helper sees one combined block.
      const combined = notes.trim() ? `${prompt}\n\n## Additional notes\n\n${notes.trim()}` : prompt;
      const r = await fetch("/api/build-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_type, source_id: source_id ?? null,
          title: titleInput, prompt: combined,
          priority, working_dir: wd,
          notes: notes.trim() || null,
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "push failed");
      setPushed(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "push failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={(e) => e.stopPropagation()}>
      <div className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="w-[640px] bg-white border-l flex flex-col shadow-2xl">
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hammer className="size-4 text-violet-600" />
            <span className="text-sm font-medium">Push to build queue</span>
            <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>{source_type}</Badge>
          </div>
          <button onClick={onClose} className="size-7 inline-flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
          {pushed ? (
            <div className="py-12 text-center text-emerald-700 font-medium">✅ Pushed to queue</div>
          ) : (
            <>
              <div>
                <label className="text-[11px] text-zinc-600">Title</label>
                <input type="text" value={titleInput} onChange={(e) => setTitleInput(e.target.value)}
                  className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white" />
              </div>
              <div>
                <label className="text-[11px] text-zinc-600">Prompt (auto-generated, edit as needed)</label>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10}
                  className="w-full px-2 py-1.5 mt-0.5 rounded border border-zinc-300 text-xs font-mono bg-white resize-y" />
              </div>
              <div>
                <label className="text-[11px] text-zinc-600">Additional notes (optional, appended to prompt)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
                  placeholder="Things you want Claude to also know - constraints, edge cases, references..."
                  className="w-full px-2 py-1.5 mt-0.5 rounded border border-zinc-300 text-xs bg-white resize-y" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-zinc-600">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}
                    className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white">
                    <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-600">Working dir</label>
                  <input type="text" value={wd} onChange={(e) => setWd(e.target.value)}
                    className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-xs font-mono bg-white" />
                </div>
              </div>
              {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}
            </>
          )}
        </div>
        {!pushed && (
          <div className="border-t px-5 py-3 flex items-center justify-end gap-2 bg-zinc-50">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700" disabled={busy || !titleInput.trim() || !prompt.trim()} onClick={push}>
              {busy ? "Pushing..." : "Push to queue"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact prompt-builders for each source type.
 */
export function buildPromptForRoadmapNode(node: { title: string; rationale?: string; status?: string; priority?: string; area?: string; eta?: string; tags?: string[] }, parentTitle?: string | null): string {
  const lines = [
    `# Build: ${node.title}`,
    "",
    parentTitle ? `**Part of:** ${parentTitle}` : null,
    `**Status:** ${node.status ?? "?"} · **Priority:** ${node.priority ?? "?"}${node.area ? ` · **Area:** ${node.area}` : ""}${node.eta ? ` · **ETA:** ${node.eta}` : ""}`,
    node.tags && node.tags.length > 0 ? `**Tags:** ${node.tags.join(", ")}` : null,
    "",
    "## Rationale",
    "",
    node.rationale || "(no rationale captured - infer from title)",
    "",
    "## REVIEW FIRST - do not start coding immediately",
    "",
    "Before writing a line of code:",
    "1. Restate this task in your own words and surface any ambiguity. List 3+ assumptions you'd otherwise make silently.",
    "2. Ask clarifying questions for anything genuinely uncertain (scope, edge cases, data shape, UX).",
    "3. Outline the approach: which files, which migrations, which API routes, which UI surfaces. Identify the smallest shippable slice.",
    "4. Wait for the operator (Rob) to confirm before implementing. If running headless, write your review + plan to a CHECKPOINT.md file in the working dir and STOP.",
    "",
    "## Task",
    "",
    `Implement \`${node.title}\` end-to-end ONLY AFTER the review above is acknowledged. Follow the established patterns in this repo (Next.js App Router + Supabase + zod + requireSuperAdmin/requireManager). Add a /dev/security finding if you discover a security gap. Update CHANGELOG.md and log a build_log entry on completion. PATCH the roadmap node to in_progress when starting, shipped with the commit SHA when done.`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildPromptForFinding(f: { title: string; description: string; recommendation?: string | null; severity: string; file_path?: string | null; line_number?: number | null; tags?: string[] }): string {
  return [
    `# Fix: ${f.title}`,
    "",
    `**Severity:** ${f.severity}${f.file_path ? ` · **File:** \`${f.file_path}${f.line_number ? `:${f.line_number}` : ""}\`` : ""}`,
    f.tags && f.tags.length > 0 ? `**Tags:** ${f.tags.join(", ")}` : null,
    "",
    "## Description",
    "",
    f.description,
    "",
    f.recommendation ? "## Recommendation\n\n" + f.recommendation : null,
    "",
    "## REVIEW FIRST - do not start fixing immediately",
    "",
    "Before any code change:",
    "1. Read the file/line referenced and confirm the issue still exists in current main.",
    "2. Restate the vulnerability + the fix in your own words. Identify any assumptions.",
    "3. Surface side effects: what else uses this code path? what regressions could the fix introduce?",
    "4. If the recommendation is ambiguous or risky, propose alternatives and wait for confirmation. If running headless, write your review to CHECKPOINT.md and STOP.",
    "",
    "## Task",
    "",
    "Apply the recommendation ONLY AFTER the review above is acknowledged. After committing the fix, mark the finding as `resolved` via `PATCH /api/security` with the commit SHA in `resolved_commit_sha` so the dashboard counter ticks down.",
  ].filter(Boolean).join("\n");
}

export function buildPromptForChangeRequest(r: { title: string; description: string; source_page: string; priority: string; tags: string[]; brainstorm_notes?: string | null; cto_decision_note?: string | null }): string {
  return [
    `# Implement change request: ${r.title}`,
    "",
    `**Priority:** ${r.priority} · **Source page:** \`${r.source_page}\``,
    r.tags && r.tags.length > 0 ? `**Tags:** ${r.tags.join(", ")}` : null,
    "",
    "## Description",
    "",
    r.description,
    "",
    r.brainstorm_notes ? "## Brainstorm notes\n\n" + r.brainstorm_notes : null,
    r.cto_decision_note ? "## CTO decision\n\n" + r.cto_decision_note : null,
    "",
    "## REVIEW FIRST - do not start coding immediately",
    "",
    "Before writing code:",
    "1. Restate the change request in your own words. Surface assumptions.",
    "2. Ask clarifying questions on scope, edge cases, UX, success criteria.",
    "3. Outline approach + smallest shippable slice + risks.",
    "4. Wait for operator confirmation. If running headless, write CHECKPOINT.md and STOP.",
    "",
    "## Task",
    "",
    "Implement the change ONLY AFTER the review above is acknowledged. Update CHANGELOG.md. PATCH the change request to `in_build` when starting, then `shipped` with the commit SHA when done.",
  ].filter(Boolean).join("\n");
}
