"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  Briefcase,
  Building2,
  CheckSquare,
  Code2,
  Cog,
  GitBranch,
  Globe,
  History,
  Inbox,
  Kanban,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Mail,
  MessageCircle,
  MessageSquare,
  Percent,
  Phone,
  Settings,
  Shield,
  ShieldCheck,
  Ship,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Truck,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";
import { SidebarFlyout, type FlyoutSection } from "@/components/sidebar-flyout";

// =============================================================================
// Top-level groups - each renders as a single sidebar icon that opens a
// 320px flyout panel. Order top-to-bottom = order in the sidebar.
// =============================================================================

const SALES: FlyoutSection[] = [
  {
    pages: [
      { href: "/pipeline", label: "Pipeline", description: "Kanban deal board", icon: Kanban },
      { href: "/prospects", label: "Prospects", description: "Cold list with intent signals", icon: Target },
      { href: "/lead-intel", label: "Lead Intel", description: "AI-surfaced lead signals", icon: Lightbulb },
      { href: "/enriched", label: "Enriched", description: "Recently enriched contacts + companies", icon: Sparkles },
      { href: "/cold-calling", label: "Cold Calling", description: "Outbound dialer + scripts", icon: Phone },
    ],
  },
];

const CLIENTS: FlyoutSection[] = [
  {
    pages: [
      { href: "/clients", label: "Clients", description: "Active client accounts", icon: Users },
      { href: "/client-intel", label: "Client Intel", description: "AI insights per client", icon: Brain },
      { href: "/networks", label: "Networks", description: "Agent network + partners", icon: Globe },
    ],
  },
];

const COMMS: FlyoutSection[] = [
  {
    pages: [
      { href: "/email", label: "Email", description: "Inbound + outbound mail surface", icon: Mail },
      { href: "/messages", label: "Messages", description: "DM + chat threads", icon: MessageSquare },
      { href: "/stages", label: "Stages", description: "Conversation stage automation", icon: GitBranch },
    ],
  },
];

const OPS: FlyoutSection[] = [
  {
    pages: [
      { href: "/incidents", label: "Incidents", description: "Live incident queue", icon: AlertTriangle },
      { href: "/tasks", label: "Tasks", description: "Centralised task manager", icon: CheckSquare },
    ],
  },
];

const REPORTS: FlyoutSection[] = [
  {
    pages: [
      { href: "/pnl", label: "P&L", description: "Profit + loss by lane / customer", icon: BarChart3 },
      { href: "/bonus", label: "Bonus Tracker", description: "Per-staff bonus accrual", icon: Trophy },
      { href: "/performance", label: "Performance", description: "Team + individual KPIs", icon: TrendingUp },
    ],
  },
];

const ADMIN: FlyoutSection[] = [
  {
    pages: [
      { href: "/team", label: "Team", description: "Staff directory + roles", icon: UserCog },
      { href: "/usage", label: "Usage", description: "API + LLM cost tracking", icon: Activity },
      { href: "/access", label: "Access", description: "Role + page permissions", icon: Shield },
      { href: "/settings", label: "Settings", description: "App configuration", icon: Settings },
    ],
  },
];

const DEV: FlyoutSection[] = [
  {
    label: "Quoting engine",
    pages: [
      { href: "/dev/quote-inbox", label: "RFQ inbox", description: "Air-traffic control across all open RFQs", icon: Inbox },
      { href: "/dev/quote-preview", label: "Quote workspace", description: "Per-quote sourcing + recommendation", icon: Ship },
      { href: "/dev/quote-split-review", label: "Split review", description: "Low-confidence sibling-split safety valve", icon: Layers },
      { href: "/dev/charge-codes", label: "Charge codes", description: "Canonical Braiin dictionary + TMS mapping", icon: CheckSquare },
      { href: "/dev/margins", label: "Margin rules", description: "Per-line margin engine + test calculator", icon: Percent },
      { href: "/dev/carriers", label: "Carriers rolodex", description: "AI selection oracle directory", icon: Users },
    ],
  },
  {
    label: "TMS + integrations",
    pages: [
      { href: "/dev/cargowise", label: "Cargowise", description: "Adapter, subscriptions, recent events", icon: Truck },
      { href: "/dev/llm", label: "LLM gateway", description: "Model routing + prompt diagnostics", icon: MessageCircle },
      { href: "/dev/activity", label: "Activity", description: "Live event stream", icon: Activity },
    ],
  },
  {
    label: "Founder surface",
    pages: [
      { href: "/dev/change-requests", label: "Change requests", description: "CTO triage + brainstorm + decisions", icon: Lightbulb },
      { href: "/dev/build-log", label: "Build log", description: "Running ledger of everything shipped", icon: History },
      { href: "/dev/roadmap", label: "Roadmap", description: "CTO mind map - private", icon: BarChart3 },
      { href: "/dev/security", label: "Security", description: "Posture + findings + event stream", icon: ShieldCheck },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();
  const overviewActive = pathname === "/";

  return (
    <nav className="w-14 bg-[#1B2A4A] text-white py-2 flex flex-col h-screen fixed top-0 left-0 items-center z-40">
      <div className="mb-2 flex items-center justify-center shrink-0">
        <img src="/brain-icon.png" alt="The Brain" className="w-8 h-8" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 items-center w-full px-2 scrollbar-thin">
        {/* Home - single Link, not a flyout */}
        <Link
          href="/"
          title="Overview"
          className={`group relative flex items-center justify-center w-10 h-10 rounded transition-colors shrink-0 ${
            overviewActive ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <LayoutDashboard size={20} className="text-white shrink-0" />
          <span className="absolute left-full ml-2 px-2 py-1 bg-zinc-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
            Overview
          </span>
        </Link>

        <SidebarFlyout
          triggerIcon={Briefcase}
          triggerLabel="Sales"
          headerSubtitle="Outbound + lead generation"
          sections={SALES}
          accent="emerald"
        />
        <SidebarFlyout
          triggerIcon={Building2}
          triggerLabel="Clients"
          headerSubtitle="Accounts + relationship intel"
          sections={CLIENTS}
          accent="sky"
        />
        <SidebarFlyout
          triggerIcon={Mail}
          triggerLabel="Comms"
          headerSubtitle="Email, DMs, conversation stages"
          sections={COMMS}
          accent="amber"
        />
        <SidebarFlyout
          triggerIcon={Workflow}
          triggerLabel="Ops"
          headerSubtitle="Incidents + tasks"
          sections={OPS}
          accent="rose"
        />
        <SidebarFlyout
          triggerIcon={BarChart3}
          triggerLabel="Reports"
          headerSubtitle="P&L, bonus, team performance"
          sections={REPORTS}
          accent="indigo"
        />
        <SidebarFlyout
          triggerIcon={Cog}
          triggerLabel="Admin"
          headerSubtitle="Team, usage, access, settings"
          sections={ADMIN}
          accent="zinc"
        />
      </div>

      <div className="shrink-0 flex flex-col items-center gap-1 pt-2 mt-1 border-t border-white/10 w-full px-2">
        <SidebarFlyout
          triggerIcon={Code2}
          triggerLabel="Dev pages"
          headerSubtitle="Internal tools, mocks, founder surfaces"
          sections={DEV}
          accent="violet"
          footer={
            <span className="inline-flex items-center gap-1.5">
              <Lightbulb className="size-3" />
              Each page has the floating change-request widget bottom-right.
            </span>
          }
        />
      </div>
    </nav>
  );
}
