import type { Metadata } from "next";
import { Card, Notice, PageHeader } from "@/components/ui";
import { getDatabase } from "@/db";
import { requireViewer } from "@/lib/auth/owner";
import { listRoles } from "@/lib/career/roles";
import { createAchievementAction } from "../actions";
import { AchievementForm } from "../achievement-form";

export const metadata: Metadata = { title: "New achievement" };

export default async function NewAchievementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await requireViewer();
  const { role } = await searchParams;
  const header = <PageHeader title="New achievement" description="One real accomplishment, in plain words." back={{ href: "/achievements", label: "Achievements" }} />;
  const db = getDatabase();
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet. Set DATABASE_URL to start your library.</Notice>
      </>
    );
  }
  const roles = await listRoles(db, userId);
  const defaultRoleId = typeof role === "string" && roles.some((r) => r.id === role) ? role : undefined;
  return (
    <>
      {header}
      <Card>
        <AchievementForm roles={roles} defaultRoleId={defaultRoleId} action={createAchievementAction} submitLabel="Add achievement" />
      </Card>
    </>
  );
}
