"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageGuard } from "@/components/page-guard";
import {
  CONVERSATION_STAGES,
  STAGE_LABEL,
  STAGE_STYLE,
  STAGE_DESCRIPTION,
  type ConversationStage,
} from "@/lib/conversation-stages";

type StageCard = {
  email_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  created_at: string;
  summary: string;
  stage: ConversationStage;
  stage_source: "ai" | "user";
  tags: string[];
  days_in_stage: number;
};

type StageColumn = {
  stage: ConversationStage;
  count: number;
  cards: StageCard[];
};

// Threshold in days beyond which a card is flagged as "stale" for each
// stage. Early-lifecycle stages expect faster movement; post-delivery
// stages (invoicing, paid) can legitimately sit longer. These numbers
// are starting defaults - tune with Rob once there's real data.
const STALE_DAYS: Record<ConversationStage, number> = {
  lead: 14,
  quote_request: 2,
  awaiting_info: 5,
  quote_sent: 5,
  quote_follow_up: 3,
  quote_secured: 3,
  booked: 7,
  live_shipment: 14,
  exception: 1,
  delivered: 5,
  invoicing: 14,
  paid: 30,
  closed: 90,
};

export default function StagesPage() {
  return (
    <PageGuard pageId="stages">
      <StagesInner />
    </PageGuard>
  );
}

function StagesInner() {
  const [columns, setColumns] = useState<StageColumn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/stages");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load stages");
      setColumns(d.columns || []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load stages");
      setColumns([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!columns) return null;
    const q = search.trim().toLowerCase();
    return columns.map((col) => {
      const cards = col.cards.filter((card) => {
        if (onlyStale && card.days_in_stage < STALE_DAYS[col.stage]) return false;
        if (!q) return true;
        const hay = `${card.subject} ${card.from_name} ${card.from_email} ${card.summary}`.toLowerCase();
        return hay.includes(q);
      });
      return { ...col, cards, count: cards.length };
    });
  }, [columns, search, onlyStale]);

  const totals = useMemo(() => {
    if (!filtered) return { total: 0, stale: 0 };
    let total = 0;
    let stale = 0;
    for (const col of filtered) {
      total += col.cards.length;
      for (const card of col.cards) {
        if (card.days_in_stage >= STALE_DAYS[col.stage]) stale++;
      }
    }
    return { total, stale };
  }, [filtered]);

  if (columns === null) return <p className="text-zinc-400 py-12">Loading pipeline...</p>;

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Conversation Stages</h1>
          <p className="text-xs text-zinc-400">
            Threads grouped by their position in the shipment lifecycle. {totals.total} active threads, {totals.stale} stale.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, sender, summary..."
            className="px-2.5 py-1.5 border rounded text-xs w-64"
          />
          <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyStale}
              onChange={(e) => setOnlyStale(e.target.checked)}
              className="w-3 h-3"
            />
            Stale only
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {(filtered || []).map((col) => (
          <StageColumnView key={col.stage} column={col} />
        ))}
      </div>
    </div>
  );
}

function StageColumnView({ column }: { column: StageColumn }) {
  return (
    <div className="w-72 shrink-0 flex flex-col">
      <div className={`px-2.5 py-1.5 rounded-t-lg border border-b-0 ${STAGE_STYLE[column.stage]} flex items-center justify-between`}>
        <div>
          <h2 className="text-xs font-semibold">{STAGE_LABEL[column.stage]}</h2>
          <p className="text-[9px] opacity-75">{STAGE_DESCRIPTION[column.stage]}</p>
        </div>
        <span className="text-[11px] font-mono bg-white/60 rounded px-1.5 py-0.5">
          {column.count}
        </span>
      </div>
      <div className="flex-1 min-h-[60px] bg-zinc-50 border border-zinc-200 rounded-b-lg p-1.5 space-y-1.5">
        {column.cards.length === 0 ? (
          <p className="text-[10px] text-zinc-400 text-center py-4">No threads</p>
        ) : (
          column.cards.map((card) => (
            <StageCardView key={card.email_id} card={card} />
          ))
        )}
      </div>
    </div>
  );
}

function StageCardView({ card }: { card: StageCard }) {
  const threshold = STALE_DAYS[card.stage];
  const isStale = card.days_in_stage >= threshold;
  const ageLabel = card.days_in_stage === 0
    ? "today"
    : card.days_in_stage === 1
      ? "1 day"
      : `${card.days_in_stage} days`;

  return (
    <Link
      href={`/email?id=${encodeURIComponent(card.email_id)}`}
      className={`block bg-white border rounded-md p-2 hover:shadow-sm transition-shadow ${
        isStale ? "border-red-300" : "border-zinc-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[11px] font-medium text-zinc-800 line-clamp-2 flex-1">
          {card.subject || "(no subject)"}
        </p>
        {card.stage_source === "user" && (
          <span className="text-[8px] bg-zinc-200 text-zinc-600 rounded px-1" title="Manually set">
            set
          </span>
        )}
      </div>
      <p className="text-[10px] text-zinc-500 truncate">{card.from_name || card.from_email}</p>
      {card.summary && (
        <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{card.summary}</p>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          {card.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[9px] px-1 rounded bg-zinc-100 text-zinc-600">
              {tag}
            </span>
          ))}
        </div>
        <span className={`text-[9px] ${isStale ? "text-red-600 font-medium" : "text-zinc-400"}`}>
          {ageLabel}
        </span>
      </div>
    </Link>
  );
}
