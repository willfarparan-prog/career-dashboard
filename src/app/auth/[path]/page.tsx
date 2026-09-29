import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";
import { BrandMark } from "@/components/brand";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  return (
    <main className="grid min-h-screen place-items-center bg-[linear-gradient(160deg,#032d60_0%,#0176d3_55%,#1b96ff_100%)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex flex-col items-center text-center text-white">
          <span className="rounded-2xl bg-white px-3 py-2 shadow-lg">
            <BrandMark size={56} />
          </span>
          <p className="mt-3 text-xl font-semibold tracking-tight">Career Dashboard</p>
          <p className="mt-1 text-[0.8125rem] text-white/85">
            Private workspace. Sign in with the owner account; the email must be verified — Google sign-in verifies it automatically.
          </p>
        </div>
        <div className="rounded-lg bg-card shadow-2xl">
          <AuthView path={path} />
        </div>
        <p className="mt-4 text-center text-xs text-white/70">Truthful tailoring, tracked.</p>
      </div>
    </main>
  );
}
