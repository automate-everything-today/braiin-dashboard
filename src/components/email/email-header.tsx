"use client";

import {
  Reply, ReplyAll, Forward, Pin, Archive, Trash2,
  BellOff, Ban, MoreHorizontal,
} from "lucide-react";
import type { Email } from "@/types";
import { Tooltip } from "@/components/ui/tooltip";

export interface EmailHeaderProps {
  selected: Email | null;
  pinnedEmails: Set<string>;
  showActions: boolean;
  setShowActions: (v: boolean) => void;
  startReply: (type: "reply" | "replyall" | "forward") => void;
  pinEmail: () => void;
  archiveEmail: () => void;
  deleteEmail: () => void;
  unsubscribe: () => void;
  blockSender: () => void;
  blockDomain: () => void;
  createDealFromEmail: () => void;
  createContactFromEmail: () => void;
  setActionModal: (v: string | null) => void;
}

export function EmailHeader({
  selected, pinnedEmails, showActions, setShowActions,
  startReply, pinEmail, archiveEmail, deleteEmail,
  unsubscribe, blockSender, blockDomain,
  createDealFromEmail, createContactFromEmail, setActionModal,
}: EmailHeaderProps) {
  if (!selected) {
    return <p className="text-xs text-zinc-400">Select an email to read</p>;
  }

  const initials = (selected.fromName || selected.from.split("@")[0])
    .split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  const isPinned = pinnedEmails.has(selected.id);

  return (
    <div className="flex items-center gap-3 min-w-0">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{selected.fromName || selected.from}</p>
        <p className="text-[10px] text-zinc-500 truncate">{selected.subject}</p>
      </div>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip content="Reply">
          <button onClick={() => startReply("reply")} className="p-1.5 hover:bg-zinc-100 rounded"><Reply size={13} className="text-zinc-500" /></button>
        </Tooltip>
        <Tooltip content="Reply all">
          <button onClick={() => startReply("replyall")} className="p-1.5 hover:bg-zinc-100 rounded"><ReplyAll size={13} className="text-zinc-500" /></button>
        </Tooltip>
        <Tooltip content="Forward">
          <button onClick={() => startReply("forward")} className="p-1.5 hover:bg-zinc-100 rounded"><Forward size={13} className="text-zinc-500" /></button>
        </Tooltip>
        <div className="w-px h-4 bg-zinc-200 mx-0.5" />
        <Tooltip content={isPinned ? "Unpin" : "Pin - creates follow-up task"}>
          <button onClick={pinEmail} className={`p-1.5 hover:bg-zinc-100 rounded ${isPinned ? "text-zinc-900" : "text-zinc-400"}`}><Pin size={13} /></button>
        </Tooltip>
        <Tooltip content="Archive">
          <button onClick={archiveEmail} className="p-1.5 hover:bg-zinc-100 rounded"><Archive size={13} className="text-zinc-500" /></button>
        </Tooltip>
        <Tooltip content="Delete">
          <button onClick={deleteEmail} className="p-1.5 hover:bg-zinc-100 rounded"><Trash2 size={13} className="text-zinc-500" /></button>
        </Tooltip>
        <div className="w-px h-4 bg-zinc-200 mx-0.5" />
        <Tooltip content="Unsubscribe & block sender">
          <button onClick={unsubscribe} className="p-1.5 hover:bg-red-50 rounded"><BellOff size={13} className="text-red-400" /></button>
        </Tooltip>
        <div className="relative">
          <Tooltip content="More actions">
            <button onClick={() => setShowActions(!showActions)} className="p-1.5 hover:bg-zinc-100 rounded"><MoreHorizontal size={13} className="text-zinc-500" /></button>
          </Tooltip>
          {showActions && (
            <div className="absolute right-0 top-full mt-1 bg-white border rounded shadow-lg py-1 w-44 z-50">
              <button onClick={() => { setActionModal("add_to_deal"); setShowActions(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Add to existing deal</button>
              <button onClick={() => { createDealFromEmail(); setShowActions(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Create new deal</button>
              <button onClick={() => { createContactFromEmail(); setShowActions(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Create contact</button>
              <div className="border-t my-1" />
              {selected.unsubscribeUrl && (
                <button onClick={() => { unsubscribe(); setShowActions(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center gap-1.5 text-zinc-600">
                  <BellOff size={11} /> Unsubscribe
                </button>
              )}
              <button onClick={() => { blockSender(); setShowActions(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center gap-1.5 text-zinc-600">
                <Ban size={11} /> Block sender
              </button>
              <button onClick={() => { blockDomain(); setShowActions(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center gap-1.5 text-red-500">
                <Ban size={11} /> Block domain
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
