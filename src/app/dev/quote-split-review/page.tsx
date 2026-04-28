"use client";

/**
 * Visual mock-up of the operator review screen for low-confidence
 * sibling-group splits.
 *
 * When classify-email decides an inbound RFQ should split into N
 * quote drafts but its split_confidence is below the threshold
 * (~0.85), the children stay in `pending review` state and the
 * group's `operator_reviewed` flag is FALSE. The inbox parent row
 * shows a "Review split" CTA that lands here.
 *
 * Layout: original email on the left with sentence highlights showing
 * which phrases triggered which proposed sibling. Proposed siblings
 * on the right as cards - per-card actions to edit, merge, drop, or
 * add another. Bottom bar to confirm the split, merge into a single
 * quote, or cancel.
 *
 * Static page - no backend calls.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageGuard } from "@/components/page-guard";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Layers,
  Mail,
  Merge,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

// ============================================================
// Mock data
// ============================================================

interface ProposedSibling {
  id: string; // local id for client-side ops only
  intent: string; // operator-readable label
  modeLabel: string;
  origin: string;
  destination: string;
  equipment?: string;
  weightVolume?: string;
  commodity?: string;
  incoterms?: string;
  collectionDate?: string;
  // Sentence indices (into the EMAIL_SENTENCES array) that AI used to
  // populate this sibling. Drives the highlight rendering on the left.
  sourceSentences: number[];
  perSiblingConfidence: number; // 0-1
}

const EMAIL_FROM = "andrew.bewlay@bewlay-industrial.co.uk";
const EMAIL_TO = "ops@braiin.app";
const EMAIL_RECEIVED = "Today 09:14";
const EMAIL_SUBJECT = "Quote required - Genoa to Leeds, 1x40HC steel parts";

// Each sentence rendered separately so we can highlight per proposed sibling.
const EMAIL_SENTENCES = [
  "Hi Rob,",
  "Hope you're well.",
  "We have a 40' high cube container of steel forgings ready for collection from our supplier in Genoa next Wednesday.",
  "Final destination is our Leeds facility (LS9 8DG).",
  "Could you give us a price for the sea leg from Genoa to Felixstowe?",
  "Separately, please quote the road delivery from Felixstowe to Leeds, including any unloading at our end.",
  "We may run this through ourselves if your sea rate is competitive.",
  "Total weight is around 18 tonnes and the goods are non-haz.",
  "Need rates back by Thursday afternoon ideally.",
  "Thanks,",
  "Andrew",
];

const INITIAL_SIBLINGS: ProposedSibling[] = [
  {
    id: "s1",
    intent: "Sea Genoa-Felixstowe",
    modeLabel: "Sea FCL",
    origin: "ITGOA",
    destination: "GBFXT",
    equipment: "1× 40HC",
    weightVolume: "~18,000 kg",
    commodity: "Steel forgings, non-haz",
    incoterms: "FCA Genoa (assumed)",
    collectionDate: "Wed 3 May",
    sourceSentences: [2, 4, 7],
    perSiblingConfidence: 0.78,
  },
  {
    id: "s2",
    intent: "Road Felixstowe-Leeds",
    modeLabel: "Road",
    origin: "GBFXT",
    destination: "GBLEE",
    equipment: "1× 40HC",
    weightVolume: "~18,000 kg",
    commodity: "Steel forgings, non-haz",
    incoterms: "Delivery to LS9 8DG",
    collectionDate: "after FXT discharge",
    sourceSentences: [3, 5],
    perSiblingConfidence: 0.71,
  },
];

const SPLIT_CONFIDENCE = 0.62;
const REASON =
  "Customer explicitly says 'sea leg' and 'separately, please quote the road delivery' - asking for 2 distinct quotes. Phrase 'we may run this through ourselves if your sea rate is competitive' adds confidence the customer wants them priced separately. Marked low confidence because they could equally accept a combined door-to-door quote, and your prior pattern with this customer is door-to-door pricing.";

// ============================================================
// Helpers
// ============================================================

// Shared small-pill class. Matches /dev/quote-inbox + /dev/quote-preview.
const PILL_SM = "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85
      ? "bg-emerald-100 text-emerald-800"
      : value >= 0.7
        ? "bg-amber-100 text-amber-800"
        : "bg-orange-100 text-orange-800";
  return <Badge className={`${tone} ${PILL_SM} font-mono`}>{pct}%</Badge>;
}

// ============================================================
// Page
// ============================================================

export default function QuoteSplitReviewPage() {
  const [siblings, setSiblings] = useState<ProposedSibling[]>(INITIAL_SIBLINGS);
  const [hovered, setHovered] = useState<string | null>(null); // sibling id
  const [confirmed, setConfirmed] = useState(false);
  const [merged, setMerged] = useState(false);

  const sentenceToSibling = useMemo(() => {
    const map = new Map<number, ProposedSibling[]>();
    for (const s of siblings) {
      for (const idx of s.sourceSentences) {
        const list = map.get(idx) ?? [];
        list.push(s);
        map.set(idx, list);
      }
    }
    return map;
  }, [siblings]);

  function dropSibling(id: string) {
    setSiblings((s) => s.filter((x) => x.id !== id));
  }

  function mergeAllIntoOne() {
    setMerged(true);
  }

  function addAnother() {
    const newId = `s${siblings.length + 1}-new`;
    setSiblings((s) => [
      ...s,
      {
        id: newId,
        intent: "New option",
        modeLabel: "Sea FCL",
        origin: "ITGOA",
        destination: "GBLEE",
        equipment: "1× 40HC",
        weightVolume: "~18,000 kg",
        commodity: "Steel forgings, non-haz",
        sourceSentences: [],
        perSiblingConfidence: 1.0, // operator-added => full confidence
      },
    ]);
  }

  // Visual tone per sibling card (cycles for >2)
  const TONES = [
    "border-l-violet-400 bg-violet-50/30",
    "border-l-cyan-400 bg-cyan-50/30",
    "border-l-amber-400 bg-amber-50/30",
    "border-l-rose-400 bg-rose-50/30",
  ];

  return (
    <PageGuard pageId="dev_quote_split_review">
      <div className="min-h-screen bg-zinc-50">
        {/* Top bar */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/dev/quote-inbox"
                className="text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1 text-sm"
              >
                <ArrowLeft className="size-4" /> Inbox
              </Link>
              <Separator orientation="vertical" className="h-5" />
              <Layers className="size-5 text-orange-600" />
              <h1 className="text-lg font-medium">Review proposed split</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>
                GRP-2026-0428-BW01
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 inline-flex items-center gap-1.5">
                <Sparkles className="size-3 text-violet-600" />
                AI split confidence:
              </span>
              <ConfidenceBadge value={SPLIT_CONFIDENCE} />
            </div>
          </div>
        </div>

        {/* Banner */}
        <div className="bg-orange-50/60 border-b border-orange-100">
          <div className="max-w-[1600px] mx-auto px-6 py-3">
            <div className="flex items-start gap-2 text-xs text-zinc-700">
              <Layers className="size-4 text-orange-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-orange-900 mb-0.5">
                  AI thinks this email contains 2 separate quote requests, but isn't
                  sure
                </div>
                <div className="text-zinc-600 leading-relaxed">{REASON}</div>
              </div>
            </div>
          </div>
        </div>

        {confirmed || merged ? (
          // Resolution screen
          <div className="max-w-[1600px] mx-auto px-6 py-12 flex flex-col items-center text-center">
            <div className="size-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <Check className="size-6" />
            </div>
            <h2 className="text-xl font-medium mb-1">
              {merged
                ? "Merged into a single door-to-door quote"
                : `Confirmed - ${siblings.length} drafts will go live`}
            </h2>
            <p className="text-sm text-zinc-500 max-w-md mb-6">
              {merged
                ? "Children deleted. The original draft is now a single quote covering Genoa to Leeds end-to-end. Sourcing will fan out to multimodal carriers."
                : "Each child draft becomes a live RFQ in the inbox. They share a sibling group so the conversation thread can ask combined questions, and the customer-facing email at the end will present both options together."}
            </p>
            <div className="flex items-center gap-2">
              <Link href="/dev/quote-inbox">
                <Button>Back to inbox</Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmed(false);
                  setMerged(false);
                  setSiblings(INITIAL_SIBLINGS);
                }}
              >
                Re-run review (demo)
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-12 gap-6">
            {/* ===== LEFT: Original email ===== */}
            <div className="col-span-5 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Mail className="size-4" /> Original email
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="grid grid-cols-[80px_1fr] gap-y-1 text-xs text-zinc-600">
                    <span className="text-zinc-400">From</span>
                    <span className="font-mono">{EMAIL_FROM}</span>
                    <span className="text-zinc-400">To</span>
                    <span className="font-mono">{EMAIL_TO}</span>
                    <span className="text-zinc-400">Received</span>
                    <span>{EMAIL_RECEIVED}</span>
                    <span className="text-zinc-400">Subject</span>
                    <span className="font-medium text-zinc-800">{EMAIL_SUBJECT}</span>
                  </div>
                  <Separator />
                  <div className="text-sm text-zinc-700 leading-relaxed space-y-2">
                    {EMAIL_SENTENCES.map((sentence, idx) => {
                      const sibsForSentence = sentenceToSibling.get(idx) ?? [];
                      const isHovered =
                        hovered !== null &&
                        sibsForSentence.some((s) => s.id === hovered);
                      const isAnyHighlighted = sibsForSentence.length > 0;

                      const cls =
                        hovered !== null
                          ? isHovered
                            ? "bg-amber-100/80 ring-1 ring-amber-300 rounded px-1"
                            : "opacity-40"
                          : isAnyHighlighted
                            ? "bg-zinc-100/60 rounded px-1"
                            : "";

                      const label = sibsForSentence
                        .map((s, i) => i + 1)
                        .join(",");
                      // Use position in the siblings array for the marker number
                      const numbers = sibsForSentence
                        .map((s) => siblings.findIndex((x) => x.id === s.id) + 1)
                        .filter((n) => n > 0);

                      return (
                        <span
                          key={idx}
                          className={`inline transition-opacity ${cls}`}
                        >
                          {sentence}
                          {numbers.length > 0 && (
                            <span className="ml-1 inline-flex items-center gap-0.5 align-text-top">
                              {numbers.map((n) => (
                                <span
                                  key={n}
                                  className="text-[9px] font-mono px-1 rounded bg-zinc-200 text-zinc-700"
                                >
                                  {n}
                                </span>
                              ))}
                            </span>
                          )}{" "}
                        </span>
                      );
                    })}
                  </div>
                  {hovered === null && (
                    <div className="text-[11px] text-zinc-400 italic">
                      Hover a proposed split on the right to see which sentences fed
                      into it.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Building2 className="size-4" /> Customer context
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-zinc-700 pt-0 space-y-2 leading-relaxed">
                  <div>
                    <span className="text-zinc-500">Bewlay Industrial</span> · YTD
                    £34k · 12 jobs in last 90d
                  </div>
                  <div className="text-zinc-600">
                    Pattern: usually requests <b>door-to-door pricing</b> as a single
                    quote. Last 8 quotes were combined sea+road. This email is the
                    first time they've asked for <i>"separately"</i> pricing - hence
                    the lower split confidence.
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ===== RIGHT: Proposed siblings ===== */}
            <div className="col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Proposed splits ({siblings.length})
                </div>
                <Button size="sm" variant="outline" onClick={addAnother}>
                  <Plus className="size-3.5 mr-1" />
                  Add another option
                </Button>
              </div>

              {siblings.map((s, i) => (
                <Card
                  key={s.id}
                  onMouseEnter={() => setHovered(s.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={`border-l-4 ${TONES[i % TONES.length]} transition-shadow ${
                    hovered === s.id ? "shadow-lg" : ""
                  }`}
                >
                  <CardHeader className="pb-3 flex flex-row items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700">
                          {i + 1}
                        </span>
                        {s.intent}
                      </CardTitle>
                      <div className="flex items-center gap-2 text-xs text-zinc-600">
                        <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-700`}>{s.modeLabel}</Badge>
                        <span className="font-mono">{s.origin}</span>
                        <ArrowRight className="size-3 text-zinc-400" />
                        <span className="font-mono">{s.destination}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfidenceBadge value={s.perSiblingConfidence} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {s.equipment && (
                        <div>
                          <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
                            Equipment
                          </div>
                          <div>{s.equipment}</div>
                        </div>
                      )}
                      {s.weightVolume && (
                        <div>
                          <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
                            Weight / volume
                          </div>
                          <div>{s.weightVolume}</div>
                        </div>
                      )}
                      {s.commodity && (
                        <div className="col-span-2">
                          <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
                            Commodity
                          </div>
                          <div>{s.commodity}</div>
                        </div>
                      )}
                      {s.incoterms && (
                        <div>
                          <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
                            Incoterms
                          </div>
                          <div>{s.incoterms}</div>
                        </div>
                      )}
                      {s.collectionDate && (
                        <div>
                          <div className="text-zinc-500 text-[10px] uppercase tracking-wide">
                            Collection
                          </div>
                          <div>{s.collectionDate}</div>
                        </div>
                      )}
                    </div>

                    {s.sourceSentences.length > 0 && (
                      <div className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
                        <span className="text-zinc-400">Triggered by sentence{s.sourceSentences.length > 1 ? "s" : ""}:</span>{" "}
                        {s.sourceSentences.map((idx, j) => (
                          <span key={idx}>
                            <span className="italic text-zinc-700">
                              "{EMAIL_SENTENCES[idx]?.trim()}"
                            </span>
                            {j < s.sourceSentences.length - 1 && " · "}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs">
                          Edit fields
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500">
                          <Merge className="size-3 mr-1" />
                          Merge with another
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-rose-600 hover:bg-rose-50"
                        onClick={() => dropSibling(s.id)}
                      >
                        <Trash2 className="size-3 mr-1" />
                        Drop this option
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {!confirmed && !merged && (
          <div className="sticky bottom-0 border-t bg-white">
            <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
              <div className="text-xs text-zinc-500">
                Operator review captured in <span className="font-mono">quotes.sibling_groups.operator_reviewed</span> ·
                edits feed back into the classify-email split prompt via decision-loop.
              </div>
              <div className="flex items-center gap-2">
                <Link href="/dev/quote-inbox">
                  <Button variant="ghost" size="sm">
                    <X className="size-3.5 mr-1" />
                    Cancel
                  </Button>
                </Link>
                <Button variant="outline" size="sm" onClick={mergeAllIntoOne}>
                  <Merge className="size-3.5 mr-1" />
                  Merge into one quote
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={siblings.length === 0}
                  onClick={() => setConfirmed(true)}
                >
                  <Check className="size-3.5 mr-1" />
                  Confirm split &amp; create {siblings.length} drafts
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Footer disclaimer */}
        {!confirmed && !merged && (
          <div className="max-w-[1600px] mx-auto px-6 pb-8 pt-4">
            <div className="text-[11px] text-zinc-400 text-center">
              Mock-up · static data, no backend calls · production page reads{" "}
              <span className="font-mono">quotes.sibling_groups</span> + draft children
              and writes the operator decision back via{" "}
              <span className="font-mono">operator_reviewed</span>.
            </div>
          </div>
        )}
      </div>
    </PageGuard>
  );
}
