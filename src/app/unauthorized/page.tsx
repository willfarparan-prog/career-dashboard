import Link from "next/link";

export default function Unauthorized() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This workspace is private</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;re signed in, but this account isn&apos;t the owner, or its email isn&apos;t verified yet. Verify your email (or use Google sign-in) and try again.
        </p>
        <Link href="/auth/sign-out" className="mt-4 inline-block text-sm text-primary underline">Sign out</Link>
      </div>
    </main>
  );
}
