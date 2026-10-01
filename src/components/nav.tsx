"use client";

import { Activity, Briefcase, FileUp, GraduationCap, House, ListChecks, MessagesSquare, type LucideIcon, Radar, Settings, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/*
 * The app's "objects", Lightning style: each section has a label, a glyph and
 * the color of its standard object icon, used in the tab bar and page headers.
 */
export type Section = { href: string; label: string; icon: LucideIcon; color: string; tab: boolean };

export const SECTIONS: Section[] = [
  { href: "/", label: "Home", icon: House, color: "#ef6e64", tab: true },
  { href: "/learn", label: "Learn", icon: GraduationCap, color: "#3ba755", tab: true },
  { href: "/discover", label: "Discover", icon: Radar, color: "#0d9dda", tab: true },
  { href: "/jobs", label: "Jobs", icon: Briefcase, color: "#f4a24b", tab: true },
  { href: "/applications", label: "Applications", icon: ListChecks, color: "#f88962", tab: true },
  { href: "/interview", label: "Interview", icon: MessagesSquare, color: "#7f6df2", tab: true },
  { href: "/achievements", label: "Achievements", icon: Trophy, color: "#e9696e", tab: true },
  { href: "/profile", label: "Profile", icon: UserRound, color: "#9b8ce8", tab: true },
  { href: "/profile/import", label: "Import", icon: FileUp, color: "#a89b82", tab: true },
  { href: "/activity", label: "Claude Activity", icon: Activity, color: "#20b7a8", tab: true },
  { href: "/settings", label: "Settings", icon: Settings, color: "#7f8ea3", tab: false },
];

function matches(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/profile") return pathname === "/profile";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionFor(pathname: string): Section {
  return SECTIONS.find((section) => matches(pathname, section.href)) ?? SECTIONS[0];
}

/** The navigation bar's tabs; the active one gets Lightning's brand underline. */
export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
      {SECTIONS.filter((section) => section.tab).map(({ href, label }) => {
        const active = matches(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex shrink-0 items-center px-3 text-[0.8125rem] whitespace-nowrap transition-colors ${
              active ? "bg-accent/40 font-semibold text-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground"
            }`}
          >
            {label}
            <span aria-hidden className={`absolute inset-x-0 bottom-0 h-[3px] ${active ? "bg-primary" : "bg-transparent"}`} />
          </Link>
        );
      })}
    </nav>
  );
}

/** The colored object icon for the current section (page headers). */
export function ObjectIcon({ size = "md" }: { size?: "sm" | "md" }) {
  const { icon: Icon, color } = sectionFor(usePathname());
  const box = size === "sm" ? "size-6 rounded" : "size-9 rounded-md";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center text-white ${box}`} style={{ backgroundColor: color }}>
      <Icon size={size === "sm" ? 14 : 20} strokeWidth={2} />
    </span>
  );
}

/** "Jobs › Customer Success Manager" above a page title. */
export function ObjectBreadcrumb({ back }: { back?: { href: string; label: string } }) {
  const section = sectionFor(usePathname());
  const showBack = back && back.href !== section.href && back.label !== section.label;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <Link href={section.href} className="hover:text-foreground hover:underline">
        {section.label}
      </Link>
      {showBack ? (
        <>
          <span aria-hidden>›</span>
          <Link href={back.href} className="min-w-0 truncate hover:text-foreground hover:underline">
            {back.label}
          </Link>
        </>
      ) : null}
    </p>
  );
}
