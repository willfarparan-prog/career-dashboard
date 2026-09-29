import Link from "next/link";
import { BrandMark } from "@/components/brand";

export default function Unauthorized() {
  return (
    <main className="grid min-h-screen place-items-center bg-[linear-gradient(160deg,#032d60_0%,#0176d3_55%,#1b96ff_100%)] px-4">
      <div className="w-full max-w-md rounded-lg bg-card p-6 text-center shadow-2xl">
        <BrandMark size={48} />
        <h1 className="mt-3 text-lg font-bold">This workspace is private</h1>
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          You&apos;re signed in, but this account isn&apos;t the owner, or its email isn&apos;t verified yet. Verify your email (or use Google sign-in) and try again.
        </p>
        <Link href="/auth/sign-out" className="mt-4 inline-flex h-8 items-center rounded-[0.25rem] border border-primary bg-primary px-4 text-[0.8125rem] font-semibold text-primary-foreground hover:bg-primary-hover">
          Sign out
        </Link>
      </div>
    </main>
  );
}
