import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, FactBadge, Notice, PageHeader } from "@/components/ui";
import { getDatabase } from "@/db";
import { requireViewer } from "@/lib/auth/owner";
import { getAchievement } from "@/lib/career/achievements";
import { listRoles } from "@/lib/career/roles";
import { DeleteButton, VerifyButton } from "../../profile/item-controls";
import { deleteAchievementAction, updateAchievementAction } from "../actions";
import { AchievementForm } from "../achievement-form";

export const metadata: Metadata = { title: "Edit achievement" };

export default async function EditAchievementPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireViewer();
  const { id } = await params;
  const db = getDatabase();
  if (!db) {
    return (
      <>
        <PageHeader title="Achievement" back={{ href: "/achievements", label: "Achievements" }} />
        <Notice tone="warn">No database is connected yet.</Notice>
      </>
    );
  }
  const [achievement, roles] = await Promise.all([getAchievement(db, userId, id), listRoles(db, userId)]);
  if (!achievement) notFound();

  return (
    <>
      <PageHeader
        title="Edit achievement"
        description={achievement.headline}
        back={{ href: "/achievements", label: "Achievements" }}
        actions={
          <>
            <FactBadge status={achievement.factStatus} />
            <VerifyButton kind="achievement" id={achievement.id} status={achievement.factStatus} />
          </>
        }
      />
      <div className="grid gap-5">
        {achievement.factStatus === "needs_confirmation" ? (
          <Notice tone="warn">Check every detail and number against what really happened, then mark it verified.</Notice>
        ) : null}
        <Card>
          <AchievementForm roles={roles} achievement={achievement} action={updateAchievementAction} submitLabel="Save achievement" />
        </Card>
        <div>
          <DeleteButton action={deleteAchievementAction} id={achievement.id} label="Delete achievement" confirm="Delete this achievement? Resume bullets written from it lose their evidence link." />
        </div>
      </div>
    </>
  );
}
