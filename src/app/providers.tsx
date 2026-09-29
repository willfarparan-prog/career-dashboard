"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      baseURL={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      redirectTo="/auth/continue"
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => router.refresh()}
      Link={Link}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
