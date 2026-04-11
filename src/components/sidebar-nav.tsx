"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrendingUp, Brain, Users, Lightbulb, Target,
  Sparkles, Phone, LayoutDashboard, Activity, BarChart3, Trophy, UserCog, Shield, Settings, Kanban, CheckSquare, Mail, MessageSquare, AlertTriangle,
} from "lucide-react";

const nav = [
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/email", label: "Email", icon: Mail },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/pnl", label: "P&L", icon: BarChart3 },
  { href: "/bonus", label: "Bonus Tracker", icon: Trophy },
  { href: "/team", label: "Team", icon: UserCog },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/client-intel", label: "Client Intel", icon: Brain },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/lead-intel", label: "Lead Intel", icon: Lightbulb },
  { href: "/prospects", label: "Prospects", icon: Target },
  { href: "/enriched", label: "Enriched", icon: Sparkles },
  { href: "/cold-calling", label: "Cold Calling", icon: Phone },
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/usage", label: "Usage", icon: Activity },
  { href: "/access", label: "Access", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="w-14 bg-[#1B2A4A] text-white p-2 flex flex-col gap-1 h-screen fixed top-0 left-0 items-center z-40">
      <div className="mb-4 flex items-center justify-center">
        <img src="/brain-icon.png" alt="The Brain" className="w-8 h-8" />
      </div>
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`group relative flex items-center justify-center w-10 h-10 rounded transition-colors ${
              active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon size={20} className="text-white shrink-0" />
            <span className="absolute left-full ml-2 px-2 py-1 bg-zinc-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
