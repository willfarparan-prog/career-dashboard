import type { Metadata } from "next";
import { Notice, PageHeader } from "@/components/ui";
import { getDatabase } from "@/db";
import { COMPETENCIES } from "@/content/interview/competencies";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { listAchievements } from "@/lib/career/achievements";
import { StoryEditor } from "../story-editor";

export const metadata: Metadata = { title: "New story · Interview" };
export const maxDuration = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewStoryPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ userId }, params] = await Promise.all([requireViewer(), searchParams]);
  const db = getDatabase();
  const header = (
    <PageHeader
      title="New story"
      back={{ href: "/interview", label: "Interview" }}
      description="A story you'll retell in interviews. Keep it true and specific; tag the questions it answers."
    />
  );
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet.</Notice>
      </>
    );
  }
  const achievements = await listAchievements(db, userId);
  const from = typeof params.achievement === "string" ? params.achievement : undefined;
  return (
    <>
      {header}
      <StoryEditor
        achievements={achievements.map(({ id, headline }) => ({ id, headline }))}
        competencies={COMPETENCIES.map(({ key, label, narrative }) => ({ key, label, narrative }))}
        initialAchievementId={achievements.some((a) => a.id === from) ? from : undefined}
        aiReady={aiConfigured()}
      />
    </>
  );
}
