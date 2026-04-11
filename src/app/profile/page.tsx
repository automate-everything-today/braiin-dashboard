"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { useRef } from "react";

type Prefs = {
  display_name: string;
  photo_url: string;
  phone: string;
  font_size: string;
  email_tone: string;
  email_signoff: string;
  sample_email: string;
  phrases_use: string;
  phrases_avoid: string;
  timezone: string;
  ai_learning_enabled: boolean;
};

const DEFAULT_PREFS: Prefs = {
  display_name: "", photo_url: "", phone: "", font_size: "normal",
  email_tone: "professional", email_signoff: "Kind regards", sample_email: "",
  phrases_use: "", phrases_avoid: "", timezone: "Europe/London",
  ai_learning_enabled: true,
};

export default function ProfilePage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "profile");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const sessionRes = await fetch("/api/auth/session");
      const session = await sessionRes.json();
      if (session.email) {
        setEmail(session.email);
        setPrefs(prev => ({ ...prev, display_name: session.name || "" }));

        const { data } = await supabase.from("user_preferences")
          .select("*").eq("email", session.email).single();
        if (data) {
          setPrefs({
            display_name: data.display_name || session.name || "",
            photo_url: data.photo_url || "",
            phone: data.phone || "",
            font_size: data.font_size || "normal",
            email_tone: data.email_tone || "professional",
            email_signoff: data.email_signoff || "Kind regards",
            sample_email: data.sample_email || "",
            phrases_use: data.phrases_use || "",
            phrases_avoid: data.phrases_avoid || "",
            timezone: data.timezone || "Europe/London",
            ai_learning_enabled: data.ai_learning_enabled !== false,
          });
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  async function save() {
    const { error } = await supabase.from("user_preferences").upsert({
      email,
      ...prefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (error) { toast.error("Failed to save"); return; }
    toast.success("Preferences saved");
  }

  async function uploadPhoto(file: File) {
    if (!email || !file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("email", email);
      const res = await fetch("/api/upload-avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Upload failed"); setUploading(false); return; }
      setPrefs({ ...prefs, photo_url: data.url });
      toast.success("Photo uploaded");
    } catch {
      toast.error("Upload failed");
    }
    setUploading(false);
  }

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "voice", label: "Voice & Tone" },
  ];

  if (loading) return <p className="text-zinc-400 py-12">Loading...</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === t.id ? "border-zinc-900 font-medium" : "border-transparent text-zinc-400 hover:text-zinc-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {tab === "profile" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              {prefs.photo_url ? (
                <img src={prefs.photo_url} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xl font-medium">
                  {prefs.display_name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?"}
                </div>
              )}
              <div className="flex-1 space-y-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0]); }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 border rounded text-xs hover:bg-zinc-50 disabled:opacity-50">
                  <Upload size={12} /> {uploading ? "Uploading..." : "Upload photo"}
                </button>
                {prefs.photo_url && (
                  <button onClick={() => setPrefs({ ...prefs, photo_url: "" })}
                    className="text-[10px] text-zinc-400 hover:text-red-500">Remove photo</button>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Display Name</label>
              <input value={prefs.display_name} onChange={e => setPrefs({ ...prefs, display_name: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm" />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Email</label>
              <input value={email} disabled className="w-full px-3 py-2 border rounded text-sm bg-zinc-50 text-zinc-400" />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Phone</label>
              <input value={prefs.phone} onChange={e => setPrefs({ ...prefs, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm" placeholder="+44..." />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Timezone</label>
              <select value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm">
                <option value="Europe/London">London (GMT/BST)</option>
                <option value="Europe/Istanbul">Istanbul (TRT)</option>
                <option value="Europe/Madrid">Madrid (CET)</option>
                <option value="Europe/Warsaw">Warsaw (CET)</option>
                <option value="Asia/Kolkata">India (IST)</option>
                <option value="America/New_York">New York (EST)</option>
                <option value="Asia/Dubai">Dubai (GST)</option>
              </select>
            </div>

            <Button onClick={save} className="bg-zinc-900 hover:bg-zinc-800 text-xs gap-1.5">
              <Save size={12} /> Save Profile
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Preferences tab */}
      {tab === "preferences" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Display Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-[10px] text-zinc-400">Font Size</label>
              <div className="flex gap-2 mt-1">
                {["small", "normal", "large"].map(size => (
                  <button key={size} onClick={() => setPrefs({ ...prefs, font_size: size })}
                    className={`px-4 py-2 rounded border text-sm capitalize ${prefs.font_size === size ? "bg-zinc-900 text-white border-zinc-900" : "hover:bg-zinc-50"}`}>
                    {size}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">
                Preview: <span style={{ fontSize: prefs.font_size === "small" ? "12px" : prefs.font_size === "large" ? "16px" : "14px" }}>This is how text will appear</span>
              </p>
            </div>

            <div className="pt-2 border-t">
              <label className="text-[10px] text-zinc-400 font-medium uppercase">AI Learning</label>
              <div className="flex items-center justify-between mt-2">
                <div>
                  <p className="text-xs font-medium">Learn from my emails</p>
                  <p className="text-[10px] text-zinc-400">When enabled, Braiin learns your writing style from sent emails to improve reply suggestions. Turn off for privacy when handling personal or sensitive emails.</p>
                </div>
                <button
                  onClick={() => setPrefs({ ...prefs, ai_learning_enabled: !prefs.ai_learning_enabled })}
                  className={`w-10 h-5 rounded-full transition-colors relative ${prefs.ai_learning_enabled ? "bg-zinc-900" : "bg-zinc-300"}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${prefs.ai_learning_enabled ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>

            <Button onClick={save} className="bg-zinc-900 hover:bg-zinc-800 text-xs gap-1.5">
              <Save size={12} /> Save Preferences
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Voice & Tone tab */}
      {tab === "voice" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Voice & Tone</CardTitle>
            <p className="text-[10px] text-zinc-400">This teaches the AI how to write emails in your voice</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-[10px] text-zinc-400">Email Tone</label>
              <div className="flex gap-2 mt-1">
                {["formal", "professional", "warm", "casual"].map(tone => (
                  <button key={tone} onClick={() => setPrefs({ ...prefs, email_tone: tone })}
                    className={`px-3 py-1.5 rounded border text-xs capitalize ${prefs.email_tone === tone ? "bg-zinc-900 text-white border-zinc-900" : "hover:bg-zinc-50"}`}>
                    {tone}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">How do you sign off?</label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {["Kind regards", "Best regards", "Best", "Thanks", "Cheers", "Many thanks"].map(s => (
                  <button key={s} onClick={() => setPrefs({ ...prefs, email_signoff: s })}
                    className={`px-3 py-1.5 rounded border text-xs ${prefs.email_signoff === s ? "bg-zinc-900 text-white border-zinc-900" : "hover:bg-zinc-50"}`}>
                    {s}
                  </button>
                ))}
              </div>
              <input value={prefs.email_signoff} onChange={e => setPrefs({ ...prefs, email_signoff: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm mt-2" placeholder="Or type your own..." />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Paste an example email you have written</label>
              <p className="text-[10px] text-zinc-400 mb-1">This helps the AI learn your writing style</p>
              <textarea value={prefs.sample_email} onChange={e => setPrefs({ ...prefs, sample_email: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm min-h-[150px] resize-y"
                placeholder="Paste a real email you've sent so the AI can learn your voice..." />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Phrases you always use</label>
              <textarea value={prefs.phrases_use} onChange={e => setPrefs({ ...prefs, phrases_use: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm min-h-[60px] resize-y"
                placeholder='e.g. "Happy to help", "Let me know if you need anything"' />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400">Phrases you never use</label>
              <textarea value={prefs.phrases_avoid} onChange={e => setPrefs({ ...prefs, phrases_avoid: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm min-h-[60px] resize-y"
                placeholder='e.g. "I hope this email finds you well", "Per my last email"' />
            </div>

            <Button onClick={save} className="bg-zinc-900 hover:bg-zinc-800 text-xs gap-1.5">
              <Save size={12} /> Save Voice Settings
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
