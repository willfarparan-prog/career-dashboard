import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

export default async function AfterSignIn() {
  await requireViewer();
  redirect("/");
}
