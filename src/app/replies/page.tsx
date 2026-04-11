"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REPS = [
  { name: "Rob Donald", pd_id: 22090674 },
  { name: "Sam Yauner", pd_id: 22120682 },
  { name: "Hathim Mahamood", pd_id: 22120660 },
  { name: "Bruna Natale", pd_id: 23474408 },
  { name: "Coral Chen", pd_id: 23562474 },
];

const BADGE_COLORS: Record<string, string> = {
  hot: "bg-[#ff3366] text-white",
  warm: "bg-yellow-500 text-black",
  objection: "bg-orange-500 text-white",
  neutral: "bg-zinc-400 text-white",
  cold_negative: "bg-zinc-700 text-white",
  ooo: "bg-blue-400 text-white",
};

export default function RepliesPage() {
  const [replies, setReplies] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    load();
  }, [filter]);

  async function load() {
    let query = supabase
      .from("replies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (filter !== "all") {
      query = query.eq("classification", filter);
    }

    const { data } = await query;
    setReplies(data || []);
  }

  async function assignRep(replyId: number, dealId: number, repPdId: number, repName: string) {
    // Update Pipedrive deal owner via server-side proxy
    if (dealId) {
      await fetch("/api/pipedrive", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: `deals/${dealId}`,
          data: { user_id: repPdId },
        }),
      });
    }

    // Update Supabase
    await supabase
      .from("replies")
      .update({ assigned_rep: repName })
      .eq("id", replyId);

    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Replies</h1>
        <Select value={filter} onValueChange={(v) => { if (v) setFilter(v); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="objection">Objection</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="ooo">OOO</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {replies.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <Badge className={BADGE_COLORS[r.classification] || "bg-zinc-300"}>
                  {r.classification?.toUpperCase()}
                </Badge>

                <div className="flex-1 min-w-0">
                  <p className="font-medium">{r.summary || "No summary"}</p>
                  <p className="text-sm text-zinc-500 mt-1">
                    Confidence: {r.confidence ? Math.round(r.confidence * 100) + "%" : "-"} |
                    Next: {r.next_action || "-"}
                  </p>
                  {r.reply_text && (
                    <p className="text-sm mt-2 p-2 bg-zinc-100 rounded italic">
                      &ldquo;{r.reply_text.substring(0, 200)}&rdquo;
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-xs text-zinc-400">
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                    {r.pipedrive_deal_url && (
                      <a href={r.pipedrive_deal_url} target="_blank" className="text-blue-600 hover:underline">
                        Open in Pipedrive
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 min-w-[160px]">
                  <p className="text-xs text-zinc-500">
                    Assigned: <strong>{r.assigned_rep || "Unassigned"}</strong>
                  </p>
                  <Select
                    onValueChange={(val) => {
                      const rep = REPS.find((r) => r.name === val);
                      if (rep) assignRep(r.id, r.pipedrive_deal_id, rep.pd_id, rep.name);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Assign rep" />
                    </SelectTrigger>
                    <SelectContent>
                      {REPS.map((rep) => (
                        <SelectItem key={rep.name} value={rep.name}>
                          {rep.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {replies.length === 0 && (
          <p className="text-zinc-400 text-center py-12">No replies matching filter</p>
        )}
      </div>
    </div>
  );
}
