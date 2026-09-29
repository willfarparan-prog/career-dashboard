import "server-only";

import { redirect } from "next/navigation";
import { getAuth } from "./server";
import { isOwner } from "./policy";

/** `next dev` with CAREER_DEV_PREVIEW=1 skips sign-in. Production builds never do. */
export const devPreview = process.env.NODE_ENV === "development" && process.env.CAREER_DEV_PREVIEW === "1";
export const PREVIEW_USER_ID = "preview-owner";

export type Viewer = { userId: string; email: string; name: string };

type SessionState = { signedIn: boolean; viewer: Viewer | null };

async function sessionState(): Promise<SessionState> {
  if (devPreview) return { signedIn: true, viewer: { userId: PREVIEW_USER_ID, email: process.env.OWNER_EMAIL ?? "owner@preview.local", name: "Preview" } };
  const { data: session } = await getAuth().getSession();
  const user = session?.user;
  if (!user) return { signedIn: false, viewer: null };
  if (!isOwner(user.email, user.emailVerified, process.env.OWNER_EMAIL)) return { signedIn: true, viewer: null };
  return { signedIn: true, viewer: { userId: user.id, email: user.email, name: user.name ?? "" } };
}

/** The signed-in, verified owner, or null. */
export async function getViewer(): Promise<Viewer | null> {
  return (await sessionState()).viewer;
}

/** For pages: signed-out visitors go to sign-in; anyone else to /unauthorized. */
export async function requireViewer(): Promise<Viewer> {
  const { signedIn, viewer } = await sessionState();
  if (!signedIn) redirect("/auth/sign-in");
  if (!viewer) redirect("/unauthorized");
  return viewer;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireOwnerId(): Promise<string> {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Not authorized.");
  return viewer.userId;
}
