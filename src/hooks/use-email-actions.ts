// src/hooks/use-email-actions.ts

import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Email, SenderIntel, TagInfo } from "@/types";

export interface EmailActionsParams {
  selected: Email | null;
  senderIntel: SenderIntel | null;
  emailTags: Record<string, TagInfo[]>;
  tagParty: string;
  actionNote: string;
  setEmailTags: React.Dispatch<React.SetStateAction<Record<string, TagInfo[]>>>;
  setTagInput: React.Dispatch<React.SetStateAction<string>>;
  setTagParty: React.Dispatch<React.SetStateAction<string>>;
  setEmails: React.Dispatch<React.SetStateAction<Email[]>>;
  setSelected: React.Dispatch<React.SetStateAction<Email | null>>;
  setProcessedEmails: React.Dispatch<React.SetStateAction<Set<string>>>;
  setArchivedEmails: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPinnedEmails: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActionModal: React.Dispatch<React.SetStateAction<string | null>>;
  setActionNote: React.Dispatch<React.SetStateAction<string>>;
  pinnedEmails: Set<string>;
  session: { name?: string; email?: string } | null;
}

export function useEmailActions(params: EmailActionsParams) {
  const {
    selected, senderIntel, emailTags, tagParty, actionNote,
    setEmailTags, setTagInput, setTagParty, setEmails, setSelected,
    setProcessedEmails, setArchivedEmails, setPinnedEmails,
    setActionModal, setActionNote, pinnedEmails, session,
  } = params;

  async function addTag(emailId: string, tag: string, party?: string) {
    if (!tag.trim()) return;
    const upperTag = tag.trim().toUpperCase();
    await fetch("/api/email-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: emailId, tag: upperTag, tag_type: "job_ref", party: party || tagParty || null }),
    });
    setEmailTags(prev => ({
      ...prev,
      [emailId]: [...(prev[emailId] || []), { tag: upperTag, party: party || tagParty || null, is_primary: false }],
    }));
    setTagInput("");
    setTagParty("");
    toast.success(`Tagged with ${upperTag}${party || tagParty ? ` (${party || tagParty})` : ""}`);
  }

  async function removeTag(emailId: string, tag: string) {
    await fetch("/api/email-tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: emailId, tag }),
    });
    setEmailTags(prev => ({ ...prev, [emailId]: (prev[emailId] || []).filter(t => t.tag !== tag) }));
    toast.success("Tag removed");
  }

  async function setTagPartyOnEmail(emailId: string, tag: string, party: string) {
    await fetch("/api/email-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: emailId, tag, party }),
    });
    setEmailTags(prev => ({
      ...prev,
      [emailId]: (prev[emailId] || []).map(t => t.tag === tag ? { ...t, party } : t),
    }));
    toast.success(`Set as ${party}`);
  }

  async function togglePrimary(emailId: string, tag: string) {
    const current = emailTags[emailId]?.find(t => t.tag === tag);
    const newVal = !current?.is_primary;
    await fetch("/api/email-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: emailId, tag, is_primary: newVal }),
    });
    setEmailTags(prev => {
      const updated = { ...prev };
      if (newVal) {
        for (const eid of Object.keys(updated)) {
          updated[eid] = (updated[eid] || []).map(t => t.tag === tag ? { ...t, is_primary: eid === emailId } : t);
        }
      } else {
        updated[emailId] = (updated[emailId] || []).map(t => t.tag === tag ? { ...t, is_primary: false } : t);
      }
      return updated;
    });
    toast.success(newVal ? "Set as primary thread" : "Removed primary");
  }

  async function pinEmail() {
    if (!selected) return;
    const userEmail = session?.email;
    if (!userEmail) {
      toast.error("Not signed in - cannot pin");
      return;
    }

    const isPinned = pinnedEmails.has(selected.id);
    const newPinned = new Set(pinnedEmails);

    if (isPinned) {
      newPinned.delete(selected.id);
      setPinnedEmails(newPinned);
      const { error } = await supabase.from("email_pins")
        .delete().eq("user_email", userEmail).eq("email_id", selected.id);
      if (error) {
        console.error("[email] Failed to unpin:", error.message);
        toast.error("Unpin failed - refresh to sync");
        // Revert optimistic update
        setPinnedEmails(pinnedEmails);
        return;
      }
      toast.success("Unpinned");
    } else {
      newPinned.add(selected.id);
      setPinnedEmails(newPinned);
      setProcessedEmails(prev => new Set([...prev, selected.id]));

      const { error } = await supabase.from("email_pins")
        .insert({ user_email: userEmail, email_id: selected.id });
      if (error) {
        console.error("[email] Failed to pin:", error.message);
        toast.error("Pin failed - refresh to sync");
        setPinnedEmails(pinnedEmails);
        return;
      }

      // Also create a follow-up task, as before
      supabase.from("tasks").insert({
        title: `Follow up: ${selected.subject}`,
        description: `From: ${selected.fromName || selected.from}\n${selected.preview}`,
        account_code: selected.matchedAccount || "",
        assigned_to: "",
        due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        priority: "medium",
        status: "open",
        auto_generated: true,
        source: "email_pin",
      }).then(({ error: taskErr }) => {
        if (taskErr) {
          console.error("[email] Failed to create follow-up task:", taskErr.message);
          toast.error("Pinned, but follow-up task failed");
        }
      });
      toast.success("Pinned - task created for follow-up");
    }
  }

  async function archiveEmail(emailId?: string) {
    // Defensive: React button onClick passes the MouseEvent as the first arg.
    // If a caller wires `onClick={archiveEmail}` without a wrapper, we get a
    // DOM event instead of a string id. Reject anything that isn't a string.
    const rawId = typeof emailId === "string" ? emailId : undefined;
    const id = rawId || selected?.id;
    if (!id) return;
    // Optimistic UI update
    setArchivedEmails(prev => new Set([...prev, id]));
    setProcessedEmails(prev => new Set([...prev, id]));
    if (selected?.id === id) setSelected(null);
    toast.success("Archived");
    // Actually move in Outlook
    try {
      const res = await fetch("/api/email-sync", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: id, action: "archive", user_email: session?.email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[archive] Graph API returned error:", body);
        // Revert optimistic update so the email reappears in the list.
        setArchivedEmails(prev => { const next = new Set(prev); next.delete(id); return next; });
        toast.error(`Archive failed in Outlook: ${body.error || res.statusText}`);
      }
    } catch (err) {
      console.error("[archive] fetch rejected:", err);
      setArchivedEmails(prev => { const next = new Set(prev); next.delete(id); return next; });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Archive failed: ${msg}`);
    }
  }

  async function deleteEmail(emailId?: string) {
    const rawId = typeof emailId === "string" ? emailId : undefined;
    const id = rawId || selected?.id;
    if (!id) return;
    // Optimistic UI update
    setArchivedEmails(prev => new Set([...prev, id]));
    setProcessedEmails(prev => new Set([...prev, id]));
    if (selected?.id === id) setSelected(null);
    toast.success("Deleted");
    // Actually move to trash in Outlook
    try {
      const res = await fetch("/api/email-sync", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: id, action: "delete", user_email: session?.email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[delete] Graph API returned error:", body);
        setArchivedEmails(prev => { const next = new Set(prev); next.delete(id); return next; });
        toast.error(`Delete failed in Outlook: ${body.error || res.statusText}`);
      }
    } catch (err) {
      console.error("[delete] fetch rejected:", err);
      setArchivedEmails(prev => { const next = new Set(prev); next.delete(id); return next; });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Delete failed: ${msg}`);
    }
  }

  async function blockSender() {
    if (!selected) return;
    await fetch("/api/email-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_address: selected.from, reason: "manual_block" }),
    });
    setEmails(prev => prev.filter(e => e.from !== selected.from));
    setSelected(null);
    toast.success(`Blocked ${selected.from}`);
  }

  async function blockDomain() {
    if (!selected) return;
    const domain = selected.from.split("@")[1];
    if (!domain) return;
    await fetch("/api/email-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, reason: "manual_block" }),
    });
    setEmails(prev => prev.filter(e => !e.from.endsWith(`@${domain}`)));
    setSelected(null);
    toast.success(`Blocked all emails from ${domain}`);
  }

  async function unsubscribe() {
    if (!selected) return;
    await fetch("/api/email-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_address: selected.from, reason: "unsubscribe" }),
    });
    if (selected.unsubscribeUrl) {
      window.open(selected.unsubscribeUrl, "_blank");
    }
    setEmails(prev => prev.filter(e => e.from !== selected.from));
    setSelected(null);
    toast.success("Unsubscribed and blocked sender");
  }

  async function createContactFromEmail() {
    if (!selected) return;
    const { error } = await supabase.from("cargowise_contacts").insert({
      contact_name: selected.fromName || selected.from.split("@")[0],
      email: selected.from,
      org_name: selected.matchedCompany || selected.fromName || "",
      account_code: selected.matchedAccount || "",
    });
    if (error) { toast.error("Failed to create contact"); return; }
    toast.success(`Contact created: ${selected.fromName || selected.from}`);
    setProcessedEmails(prev => new Set([...prev, selected.id]));
    setActionModal(null);
  }

  async function createDealFromEmail() {
    if (!selected) return;
    const title = `${selected.fromName || selected.from.split("@")[0]} | ${selected.matchedCompany || selected.subject.slice(0, 30)}`;
    const { data: newDeal, error } = await supabase.from("deals").insert({
      title,
      company_name: selected.matchedCompany || selected.fromName || "",
      contact_name: selected.fromName || "",
      contact_email: selected.from,
      account_code: selected.matchedAccount || "",
      description: selected.subject,
      source: "email_inbound",
      stage: "Lead",
      pipeline_type_id: 1,
      stage_id: 1,
      probability: 10,
    }).select("id").single();
    if (error) { toast.error("Failed to create deal"); return; }
    if (newDeal) {
      await supabase.from("deal_messages").insert({
        deal_id: newDeal.id,
        type: "email_in",
        content: `**From:** ${selected.from}\n**Subject:** ${selected.subject}\n\n${selected.preview}`,
        sender_name: selected.fromName,
        sender_email: selected.from,
      });
    }
    toast.success("Deal created from email");
    setProcessedEmails(prev => new Set([...prev, selected.id]));
    setActionModal(null);
  }

  async function addEmailToDeal() {
    if (!selected || !actionNote) return;
    const dealId = parseInt(actionNote);
    if (isNaN(dealId)) { toast.error("Enter a valid deal ID"); return; }
    await supabase.from("deal_messages").insert({
      deal_id: dealId,
      type: "email_in",
      content: `**From:** ${selected.from}\n**Subject:** ${selected.subject}\n\n${selected.preview}`,
      sender_name: selected.fromName,
      sender_email: selected.from,
    });
    toast.success("Email added to deal");
    setProcessedEmails(prev => new Set([...prev, selected.id]));
    setActionModal(null);
    setActionNote("");
  }

  async function saveAsInsight() {
    if (!selected) return;
    const ac = selected.matchedAccount || senderIntel?.accountCode;
    if (!ac) { toast.error("No account matched"); return; }
    await supabase.from("client_notes").insert({
      account_code: ac,
      note: `[Email] ${selected.subject} - ${selected.preview}`,
      author: "Email",
    });
    toast.success("Saved as insight");
    setProcessedEmails(prev => new Set([...prev, selected.id]));
  }

  async function shareWithTeam() {
    if (!selected) return;
    await supabase.from("activities").insert({
      account_code: selected.matchedAccount || "",
      type: "note",
      subject: `Shared: ${selected.subject}`,
      body: `From: ${selected.fromName || selected.from}\n\n${selected.preview}`,
      user_name: "Shared",
    });
    toast.success("Shared with team");
    setProcessedEmails(prev => new Set([...prev, selected.id]));
  }

  return {
    addTag,
    removeTag,
    setTagPartyOnEmail,
    togglePrimary,
    pinEmail,
    archiveEmail,
    deleteEmail,
    blockSender,
    blockDomain,
    unsubscribe,
    createContactFromEmail,
    createDealFromEmail,
    addEmailToDeal,
    saveAsInsight,
    shareWithTeam,
  };
}
