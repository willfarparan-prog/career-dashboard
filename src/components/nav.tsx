"use client";

import { Activity, Briefcase, FileUp, LayoutDashboard, ListChecks, Settings, Trophy, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/achievements", label: "Achievements", icon: Trophy },
  { href: "/profile/import", label: "Import", icon: FileUp },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/applications", label: "Applications", icon: ListChecks },
  { href: "/activity", label: "Claude activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/profile") return pathname === "/profile";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon aria-hidden size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
