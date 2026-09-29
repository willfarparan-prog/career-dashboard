import { Grip, LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { NavTabs } from "@/components/nav";
import { devPreview, requireViewer } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const iconButton =
  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 shadow-[0_2px_3px_rgb(0_0_0_/_0.08)]">
        {/* Global header */}
        <div className="flex h-12 items-center gap-3 border-b border-header-border bg-header px-3 md:px-4">
          <Link href="/" className="flex items-center gap-2" aria-label="Career Dashboard home">
            <BrandMark />
            <span className="hidden text-[0.8125rem] leading-tight text-muted-foreground sm:block">
              <span className="block font-semibold text-foreground">Career Dashboard</span>
              Truthful tailoring, tracked
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            {devPreview ? <span className="mr-2 hidden rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn sm:inline">Local preview</span> : null}
            <Link href="/jobs/new" className={iconButton} title="New job" aria-label="New job">
              <Plus size={18} />
            </Link>
            <Link href="/settings" className={iconButton} title="Settings" aria-label="Settings">
              <Settings size={17} />
            </Link>
            <details className="relative">
              <summary
                className="ml-1 flex size-8 cursor-pointer list-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground [&::-webkit-details-marker]:hidden"
                title={viewer.email}
                aria-label="Account"
              >
                {initials(viewer.name, viewer.email)}
              </summary>
              <div className="absolute right-0 mt-2 w-60 rounded-md border border-border bg-popover p-3 text-sm shadow-lg">
                <p className="font-semibold">{viewer.name || "Signed in"}</p>
                <p className="truncate text-xs text-muted-foreground">{viewer.email}</p>
                <div className="mt-3 grid gap-1 border-t border-border pt-2">
                  <Link href="/settings" className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                    <Settings size={14} /> Settings
                  </Link>
                  {devPreview ? null : (
                    <Link href="/auth/sign-out" className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                      <LogOut size={14} /> Sign out
                    </Link>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>
        {/* Navigation bar: app launcher, app name, tabs */}
        <div className="flex h-10 items-stretch border-b border-header-border bg-header">
          <div className="flex shrink-0 items-center gap-2 border-r border-border pr-3 pl-3 md:pl-4">
            <Link href="/" className={`${iconButton} -ml-1 size-7 rounded-md`} aria-label="App launcher" title="Home">
              <Grip size={18} />
            </Link>
            <span className="hidden text-base font-semibold sm:block">Career</span>
          </div>
          <NavTabs />
        </div>
      </header>
      <main className="lightning-canvas flex-1">
        <div className="mx-auto w-full max-w-[1440px] min-w-0 px-3 py-3 md:px-4 md:py-4">{children}</div>
      </main>
    </div>
  );
}
