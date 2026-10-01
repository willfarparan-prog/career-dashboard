import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/app/(app)/profile/item-controls";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { getDatabase } from "@/db";
import { COMPETENCIES } from "@/content/interview/competencies";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { listAchievements } from "@/lib/career/achievements";
import { isUuid } from "@/lib/export/formats";
import { practiceHref } from "@/lib/interview/links";
import { getStory } from "@/lib/interview/stories";
import { deleteStoryAction } from "../../actions";
import { StoryEditor } from "../story-editor";

export const metadata: Metadata = { title: "Story · Interview" };
export const maxDuration = 300;

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { userId }] = await Promise.all([params, requireViewer()]);
  const db = getDatabase();
  if (!db) return <Notice tone="warn">No database is connected yet.</Notice>;
  if (!isUuid(id)) notFound();
  const [story, achievements] = await Promise.all([getStory(db, userId, id), listAchievements(db, userId)]);
  if (!story) notFound();

  const firstQuestion = COMPETENCIES.find((c) => story.competencies.includes(c.key));
  const practice = firstQuestion ? practiceHref(firstQuestion.questions[0], { competency: firstQuestion.key }) : "/interview/practice";

  return (
    <>
      <PageHeader
        title={story.title}
        back={{ href: "/interview", label: "Interview" }}
        actions={
          <>
            <ButtonLink href={practice} variant="secondary">
              Practice telling it
            </ButtonLink>
            <DeleteButton action={deleteStoryAction} id={story.id} confirm={`Delete "${story.title}"?`} />
          </>
        }
      />
      {/* Keyed on updatedAt so the form shows the saved values after a save. */}
      <StoryEditor
        key={story.updatedAt.toISOString()}
        story={{
          id: story.id,
          title: story.title,
          achievementId: story.achievementId ?? "",
          format: story.format,
          situation: story.situation,
          task: story.task,
          action: story.action,
          result: story.result,
          body: story.body,
          competencies: story.competencies,
          factStatus: story.factStatus,
        }}
        achievements={achievements.map(({ id: achievementId, headline }) => ({ id: achievementId, headline }))}
        competencies={COMPETENCIES.map(({ key, label, narrative }) => ({ key, label, narrative }))}
        aiReady={aiConfigured()}
      />
    </>
  );
}
