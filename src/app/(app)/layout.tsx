import Link from "next/link";
import { SideNav } from "@/components/nav";
import { devPreview, requireViewer } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  return (
    <div className="md:grid md:min-h-screen md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-card px-3 py-3 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:py-5">
        <div className="flex items-center justify-between gap-3 px-2 md:mb-6 md:block">
          <Link href="/" className="block">
            <span className="block text-sm font-semibold tracking-tight">Career Dashboard</span>
            <span className="hidden text-xs text-muted-foreground md:block">Truthful tailoring, tracked</span>
          </Link>
          <Link href="/auth/sign-out" className="text-xs text-muted-foreground hover:text-foreground md:hidden">Sign out</Link>
        </div>
        <div className="mt-3 md:mt-0">
          <SideNav />
        </div>
        <div className="mt-6 hidden px-2 text-xs text-muted-foreground md:block">
          <p className="truncate" title={viewer.email}>{viewer.email}</p>
          {devPreview ? <p className="mt-1 text-warn">Local preview (no sign-in)</p> : <Link href="/auth/sign-out" className="mt-1 inline-block hover:text-foreground">Sign out</Link>}
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
