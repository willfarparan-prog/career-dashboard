import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-lg font-semibold tracking-tight">Career Dashboard</p>
          <p className="mt-1 text-sm text-muted-foreground">Private workspace. Sign in with the owner account; the email must be verified (Google sign-in verifies it automatically).</p>
        </div>
        <AuthView path={path} />
      </div>
    </main>
  );
}
