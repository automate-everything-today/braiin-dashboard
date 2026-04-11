"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CUSTOMER } from "@/config/customer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";


type PipelineStats = {
  in_sequence: number;
  claude_enriched: number;
  apollo_enriched: number;
  replied: number;
  total_enrichments: number;
  total_contacts: number;
  total_companies: number;
  app_count: number;
};

const BADGE_COLORS: Record<string, string> = {
  hot: "bg-[#ff3366] text-white",
  warm: "bg-yellow-500 text-black",
  objection: "bg-orange-500 text-white",
  neutral: "bg-zinc-400 text-white",
  cold_negative: "bg-zinc-700 text-white",
  ooo: "bg-blue-400 text-white",
};

export default function Overview() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [bccLogs, setBccLogs] = useState<any[]>([]);
  const [expandedReply, setExpandedReply] = useState<number | null>(null);
  const [expandedBcc, setExpandedBcc] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      // Use individual counts instead of fetching all rows
      const statuses = ["in_sequence", "claude_enriched", "apollo_enriched", "replied"];
      const statusResults = await Promise.all(
        statuses.map(s => supabase.from("companies").select("*", { count: "exact", head: true }).eq("status", s))
      );
      const counts: Record<string, number> = {};
      statuses.forEach((s, i) => { counts[s] = statusResults[i].count || 0; });

      const { count: enrichments } = await supabase
        .from("enrichments").select("*", { count: "exact", head: true });
      const { count: contacts } = await supabase
        .from("contacts").select("*", { count: "exact", head: true }).not("email", "is", null);
      const { count: appCount } = await supabase
        .from("app_scores").select("*", { count: "exact", head: true }).eq("grade", "A++");

      setStats({
        in_sequence: counts["in_sequence"] || 0,
        claude_enriched: counts["claude_enriched"] || 0,
        apollo_enriched: counts["apollo_enriched"] || 0,
        replied: counts["replied"] || 0,
        total_enrichments: enrichments || 0,
        total_contacts: contacts || 0,
        total_companies: Object.values(counts).reduce((a, b) => a + b, 0),
        app_count: appCount || 0,
      });

      const { data: replyData } = await supabase
        .from("replies").select("*").order("created_at", { ascending: false }).limit(10);
      setReplies(replyData || []);

      const { data: bccData } = await supabase
        .from("bcc_log").select("*").order("created_at", { ascending: false }).limit(10);
      setBccLogs(bccData || []);
    }
    load();
  }, []);

  const statCards = stats ? [
    { label: "In Sequence", value: stats.in_sequence, color: "text-blue-600" },
    { label: "Enriched", value: stats.claude_enriched, color: "text-green-600" },
    { label: "Replied", value: stats.replied, color: "text-[#ff3366]" },
    { label: "Contacts", value: stats.total_contacts, color: "text-purple-600" },
    { label: "Enrichments", value: stats.total_enrichments, color: "text-orange-600" },
    { label: "A++ Prospects", value: stats.app_count, color: "text-yellow-600" },
  ] : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Braiin Outreach - Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-zinc-500 uppercase">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Replies - Expandable */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Replies</CardTitle>
          </CardHeader>
          <CardContent>
            {replies.length === 0 ? (
              <p className="text-zinc-400 text-sm">No replies yet</p>
            ) : (
              <div className="space-y-2">
                {replies.map((r) => (
                  <div
                    key={r.id}
                    className="rounded border bg-white overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedReply(expandedReply === r.id ? null : r.id)}
                      className="w-full flex items-start gap-3 p-3 text-left hover:bg-zinc-50"
                    >
                      <Badge className={`${BADGE_COLORS[r.classification] || "bg-zinc-300"} mt-0.5 shrink-0`}>
                        {r.classification?.toUpperCase()}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{r.summary || "No summary"}</p>
                        <p className="text-xs text-zinc-400">
                          {r.assigned_rep || "Unassigned"} - {new Date(r.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-zinc-400 text-xs shrink-0">
                        {expandedReply === r.id ? "▲" : "▼"}
                      </span>
                    </button>

                    {expandedReply === r.id && (
                      <div className="px-4 pb-4 border-t bg-zinc-50">
                        <div className="mt-3 space-y-2">
                          {r.next_action && (
                            <div>
                              <span className="text-xs font-medium text-zinc-500">Recommended action:</span>
                              <p className="text-sm">{r.next_action}</p>
                            </div>
                          )}
                          {r.reply_text && (
                            <div>
                              <span className="text-xs font-medium text-zinc-500">Full reply:</span>
                              <p className="text-sm mt-1 p-3 bg-white rounded border whitespace-pre-wrap">
                                {r.reply_text}
                              </p>
                            </div>
                          )}
                          <div className="flex gap-4 text-xs text-zinc-400 pt-2">
                            <span>Confidence: {r.confidence ? Math.round(r.confidence * 100) + "%" : "-"}</span>
                            <span>Account: {r.sending_account || "-"}</span>
                            {r.colleague_mentioned && <span>Referred to: {r.colleague_mentioned}</span>}
                            {r.return_date && <span>Returns: {r.return_date}</span>}
                            {r.pipedrive_deal_url && (
                              <a href={r.pipedrive_deal_url} target="_blank" className="text-blue-600 hover:underline">
                                Open in Pipedrive
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lead Intel - Expandable */}
        <Card>
          <CardHeader>
            <CardTitle>Lead Intel</CardTitle>
          </CardHeader>
          <CardContent>
            {bccLogs.length === 0 ? (
              <p className="text-zinc-400 text-sm">No lead intel yet. BCC bcc@leadintel.co.uk on any email.</p>
            ) : (
              <div className="space-y-2">
                {bccLogs.map((b: any) => (
                  <div
                    key={b.id}
                    className="rounded border bg-white overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedBcc(expandedBcc === b.id ? null : b.id)}
                      className="w-full flex items-start gap-3 p-3 text-left hover:bg-zinc-50"
                    >
                      <Badge
                        className={`shrink-0 mt-0.5 ${
                          b.pipedrive_action === "new_deal" ? "bg-[#ff3366] text-white"
                          : b.pipedrive_action === "existing_deal" ? "bg-yellow-500 text-black"
                          : "bg-green-600 text-white"
                        }`}
                      >
                        {b.pipedrive_action === "new_deal" ? "NEW"
                         : b.pipedrive_action === "existing_deal" ? "EXISTING"
                         : "CLIENT"}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{b.company_name || b.domain}</p>
                        <p className="text-xs text-zinc-400">
                          {b.contact_name || b.to_email} | {new Date(b.created_at).toLocaleString()}
                        </p>
                      </div>
                      {b.icp_score && (
                        <span className="text-xs font-bold text-[#ff3366] shrink-0">ICP {b.icp_score}</span>
                      )}
                      <span className="text-zinc-400 text-xs shrink-0">
                        {expandedBcc === b.id ? "▲" : "▼"}
                      </span>
                    </button>

                    {expandedBcc === b.id && (
                      <div className="px-4 pb-4 border-t bg-zinc-50">
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Left: The Opportunity */}
                          <div>
                            <h4 className="font-bold text-xs uppercase text-zinc-400 mb-2">The Opportunity</h4>

                            {b.enquiry_summary ? (
                              <div className="space-y-3">
                                <div className="p-3 bg-white rounded border">
                                  <span className="text-[10px] text-zinc-400">What they want:</span>
                                  <p className="text-sm font-medium">{b.enquiry_summary}</p>
                                </div>

                                {(b.freight_mode || b.volume || b.commodity) && (
                                  <div className="grid grid-cols-2 gap-2">
                                    {b.freight_mode && (
                                      <div className="p-2 bg-white rounded border">
                                        <span className="text-[10px] text-zinc-400">Mode</span>
                                        <p className="text-sm font-bold">{b.freight_mode}</p>
                                      </div>
                                    )}
                                    {b.volume && (
                                      <div className="p-2 bg-white rounded border">
                                        <span className="text-[10px] text-zinc-400">Volume</span>
                                        <p className="text-sm font-bold">{b.volume}</p>
                                      </div>
                                    )}
                                    {b.commodity && (
                                      <div className="p-2 bg-white rounded border">
                                        <span className="text-[10px] text-zinc-400">Commodity</span>
                                        <p className="text-sm">{b.commodity}</p>
                                      </div>
                                    )}
                                    {b.estimated_value && (
                                      <div className="p-2 bg-white rounded border">
                                        <span className="text-[10px] text-zinc-400">Est. Value</span>
                                        <p className="text-sm font-bold text-green-600">{b.estimated_value}</p>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {(b.origin || b.destination) && (
                                  <div className="p-2 bg-white rounded border">
                                    <span className="text-[10px] text-zinc-400">Route</span>
                                    <p className="text-sm">{b.origin || "?"} → {b.destination || "?"}</p>
                                  </div>
                                )}

                                {b.urgency && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-zinc-400">Urgency:</span>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                      b.urgency === "high" ? "bg-[#ff3366] text-white"
                                      : b.urgency === "medium" ? "bg-yellow-500 text-black"
                                      : "bg-zinc-300"
                                    }`}>{b.urgency}</span>
                                  </div>
                                )}

                                {b.buying_signals?.length > 0 && (
                                  <div>
                                    <span className="text-[10px] text-zinc-400">Buying signals:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {b.buying_signals.map((s: string, i: number) => (
                                        <span key={i} className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded">{s}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {b.competitive_intel && (
                                  <div className="p-2 bg-yellow-50 rounded border border-yellow-200">
                                    <span className="text-[10px] text-yellow-600">Competitive intel:</span>
                                    <p className="text-xs">{b.competitive_intel}</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              /* Fallback for old records without structured data */
                              <div className="space-y-2">
                                <div className="p-3 bg-white rounded border">
                                  <p className="text-sm"><strong>Subject:</strong> {b.subject}</p>
                                  <p className="text-sm mt-1"><strong>From:</strong> {b.rep_email || b.from_email}</p>
                                  <p className="text-sm"><strong>To:</strong> {b.contact_email || b.to_email}</p>
                                </div>
                                {b.brief && (
                                  <div className="p-3 bg-white rounded border whitespace-pre-wrap text-xs max-h-48 overflow-y-auto">
                                    {b.brief}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Right: Company Intel + Actions */}
                          <div>
                            <h4 className="font-bold text-xs uppercase text-zinc-400 mb-2">Company Intel</h4>

                            <div className="space-y-2">
                              <div className="p-3 bg-white rounded border">
                                <p className="font-medium text-sm">{b.company_name || b.domain}</p>
                                {b.company_summary && <p className="text-xs text-zinc-600 mt-1">{b.company_summary}</p>}
                                <div className="flex gap-3 mt-2 text-xs text-zinc-500">
                                  <span>ICP: <strong className={b.icp_score >= 70 ? "text-green-600" : "text-zinc-700"}>{b.icp_score || "Not in DB"}</strong></span>
                                  <span>Domain: {b.domain}</span>
                                  {b.is_existing_client && <span className="text-green-600 font-medium">Existing client</span>}
                                </div>
                              </div>

                              {b.contacts?.length > 0 && (
                                <div className="p-3 bg-white rounded border">
                                  <span className="text-[10px] text-zinc-400">Contacts:</span>
                                  {b.contacts.map((c: any, i: number) => (
                                    <div key={i} className="mt-1 text-sm">
                                      <p className="font-medium">{c.name}</p>
                                      <p className="text-xs text-zinc-500">{c.role} {c.email && `| ${c.email}`} {c.phone && `| ${c.phone}`}</p>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {b.missing_info?.length > 0 && (
                                <div className="p-3 bg-[#ff3366]/5 rounded border border-[#ff3366]/20">
                                  <span className="text-[10px] text-[#ff3366] font-medium">Needs more info:</span>
                                  <ul className="text-xs mt-1 space-y-0.5">
                                    {b.missing_info.map((m: string, i: number) => (
                                      <li key={i} className="text-zinc-600">- {m}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {b.recommended_action && (
                                <div className="p-3 bg-green-50 rounded border border-green-200">
                                  <span className="text-[10px] text-green-600 font-medium">Recommended action:</span>
                                  <p className="text-sm mt-1">{b.recommended_action}</p>
                                </div>
                              )}

                              {b.pipedrive_deal_id && CUSTOMER.pipedriveSubdomain && (
                                <a
                                  href={`https://${CUSTOMER.pipedriveSubdomain}.pipedrive.com/deal/${b.pipedrive_deal_id}`}
                                  target="_blank"
                                  className="inline-block text-xs text-blue-600 hover:underline"
                                >
                                  Open in Pipedrive
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
