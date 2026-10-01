import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, aiRuns, applications, interviews, jobRequirements, jobs, roles } from "@/db/schema";
import { COMPETENCIES } from "@/content/interview/competencies";
import { GUIDE_ORDER } from "@/content/learn/guides";
import { practiceAnswer } from "@/lib/ai/tasks/feedback";
import { generatePrep } from "@/lib/ai/tasks/prep";
import { draftStory } from "@/lib/ai/tasks/story";
import { addInterview, deleteInterview, interviewActions, listInterviews, updateInterview, type InterviewInput } from "@/lib/interview/interviews";
import { answerLength, getPrep, listPracticeAttempts, saveCompanyNotes } from "@/lib/interview/prep";
import { createStory, deleteStory, listStories, storyCoverage, updateStory, type StoryInput } from "@/lib/interview/stories";
import { nextActions } from "@/lib/overview/dashboard";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const story = (values: Partial<StoryInput> = {}): StoryInput => ({
  title: "Rebuilt member onboarding",
  achievementId: null,
  format: "star",
  situation: "New members were quitting in the first month.",
  task: "I owned onboarding.",
  action: "I redesigned the first four weeks around small wins.",
  result: "More members stayed past month one.",
  body: "",
  competencies: ["drove-adoption"],
  factStatus: "verified",
  ...values,
});

async function seedLibrary(userId: string) {
  const [role] = await db.insert(roles).values({ userId, employer: "Exos", title: "Performance Coach", factStatus: "verified" }).returning();
  const [achievement] = await db
    .insert(achievements)
    .values({ userId, roleId: role.id, headline: "Grew class participation across an onsite program", action: "Ran a 6-week challenge", outcome: "Participation rose", factStatus: "verified" })
    .returning();
  return { role, achievement };
}

test("competencies: unique keys, every guide path has some, narrative ones exist", () => {
  const keys = new Set(COMPETENCIES.map((c) => c.key));
  assert.equal(keys.size, COMPETENCIES.length);
  for (const path of GUIDE_ORDER) assert.ok(COMPETENCIES.some((c) => c.paths.includes(path)), `no competencies for ${path}`);
  assert.ok(COMPETENCIES.filter((c) => c.narrative).length >= 3);
  for (const c of COMPETENCIES) assert.ok(c.questions.length >= 3 && c.listenFor.trim(), c.key);
});

test("stories: validated, scoped to the owner, unknown competencies dropped, coverage puts gaps first", async () => {
  const user = "story-user";
  const { achievement } = await seedLibrary(user);
  await assert.rejects(createStory(db, user, story({ title: " " })), /title/);
  await assert.rejects(createStory(db, user, story({ action: "" })), /Action/);
  await assert.rejects(createStory(db, user, story({ format: "free", body: "" })), /answer/);
  const [otherAchievement] = await db.insert(achievements).values({ userId: "someone-else", headline: "Theirs" }).returning();
  await assert.rejects(createStory(db, user, story({ achievementId: otherAchievement.id })), /wasn't found/);

  const created = await createStory(db, user, story({ achievementId: achievement.id, competencies: ["drove-adoption", "made-up", "drove-adoption"] }));
  assert.deepEqual(created.competencies, ["drove-adoption"]);
  await createStory(db, user, story({ title: "Pitch", format: "free", body: "I'm a coach moving into CS…", competencies: ["tell-me-about-yourself"] }));

  assert.equal(await updateStory(db, "someone-else", created.id, story()), null);
  const updated = await updateStory(db, user, created.id, story({ title: "Onboarding rebuild", competencies: ["drove-adoption", "teaching-onboarding"] }));
  assert.equal(updated?.title, "Onboarding rebuild");

  const list = await listStories(db, user);
  assert.equal(list.length, 2);
  const coverage = storyCoverage(list, ["implementation"]);
  assert.ok(coverage.every((row) => COMPETENCIES.find((c) => c.key === row.key)?.paths.includes("implementation")));
  const firstCovered = coverage.findIndex((row) => row.stories.length > 0);
  assert.ok(firstCovered > 0 && coverage.slice(firstCovered).every((row) => row.stories.length > 0), "uncovered competencies come first");
  assert.deepEqual(coverage.find((row) => row.key === "drove-adoption")?.stories.map((s) => s.title), ["Onboarding rebuild"]);

  assert.equal(await deleteStory(db, "someone-else", created.id), false);
  assert.equal(await deleteStory(db, user, created.id), true);
});

test("story drafting (fake): fills from the achievement, refuses other users' achievements, logs the run", async () => {
  const user = "draft-user";
  const { achievement } = await seedLibrary(user);
  const { draft, achievementId } = await draftStory(db, user, achievement.id);
  assert.equal(achievementId, achievement.id);
  assert.equal(draft.action, "Ran a 6-week challenge");
  assert.equal(draft.result, "Participation rose");
  await assert.rejects(draftStory(db, "someone-else", achievement.id), /wasn't found/);
  const runs = await db.select().from(aiRuns).where(eq(aiRuns.userId, user));
  assert.deepEqual(runs.map((run) => run.task), ["story"]);
});

const round = (values: Partial<InterviewInput> = {}): InterviewInput => ({
  stage: "recruiter_screen",
  date: "",
  interviewers: "",
  notes: "",
  debrief: "",
  thankYouSent: false,
  outcome: "pending",
  ...values,
});

test("interview rounds: scoped, validated dates, and they feed Home's next actions", async () => {
  const user = "rounds-user";
  const [job] = await db.insert(jobs).values({ userId: user, company: "Acme", title: "CSM", postingText: "x" }).returning();
  await db.insert(applications).values({ userId: user, jobId: job.id, status: "interview" });
  const [closedJob] = await db.insert(jobs).values({ userId: user, company: "Closed", title: "CSM", postingText: "x" }).returning();
  await db.insert(applications).values({ userId: user, jobId: closedJob.id, status: "rejected" });

  await assert.rejects(addInterview(db, "someone-else", job.id, round()), /wasn't found/);
  await assert.rejects(addInterview(db, user, job.id, round({ date: "someday" })), /date/);

  const upcoming = await addInterview(db, user, job.id, round({ stage: "hiring_manager", date: "Oct 2, 2026" }));
  assert.equal(upcoming.date, "2026-10-02");
  const past = await addInterview(db, user, job.id, round({ date: "2026-09-27" }));
  await addInterview(db, user, job.id, round({ date: "2026-08-01" })); // thank-you long overdue: dropped
  await addInterview(db, user, closedJob.id, round({ date: "2026-10-01" }));

  const actions = await interviewActions(db, user, "2026-09-29", "2026-10-06");
  assert.deepEqual(
    actions.map((a) => [a.label, a.date]).sort(),
    [
      ["Hiring manager interview", "2026-10-02"],
      ["Recruiter screen interview", "2026-10-01"],
      ["Send a thank-you note", "2026-09-28"],
    ],
  );

  const items = await nextActions(db, user, new Date("2026-09-29T15:00:00Z"));
  assert.deepEqual(
    items.map((item) => [item.nextAction, item.company, item.daysLeft, item.href]),
    [
      ["Send a thank-you note", "Acme", -1, `/jobs/${job.id}/interview`],
      ["Hiring manager interview", "Acme", 3, `/jobs/${job.id}/interview`],
    ],
  );

  await updateInterview(db, user, past.id, round({ date: "2026-09-27", thankYouSent: true, outcome: "advanced", debrief: "Went well" }));
  const after = await interviewActions(db, user, "2026-09-29", "2026-10-06");
  assert.ok(!after.some((a) => a.label === "Send a thank-you note"));
  assert.equal(await updateInterview(db, "someone-else", past.id, round()), null);
  assert.equal(await deleteInterview(db, "someone-else", past.id), null);
  assert.ok(await deleteInterview(db, user, past.id));
  assert.equal((await listInterviews(db, user, job.id)).length, 2);
  // Deleting the job removes its rounds.
  await db.delete(applications).where(eq(applications.jobId, job.id));
  await db.delete(jobs).where(eq(jobs.id, job.id));
  assert.equal((await db.select().from(interviews).where(eq(interviews.jobId, job.id))).length, 0);
});

test("prep pack (fake): story aliases resolve, invented ones are dropped, gaps get advice, notes survive regeneration", async () => {
  const user = "prep-user";
  const { achievement } = await seedLibrary(user);
  const [job] = await db.insert(jobs).values({ userId: user, company: "Acme", title: "CSM", postingText: "Own renewals." }).returning();
  await db.insert(jobRequirements).values([
    { userId: user, jobId: job.id, kind: "must", text: "Drive adoption", label: "transferable", achievementIds: [achievement.id], position: 0 },
    { userId: user, jobId: job.id, kind: "must", text: "Salesforce", label: "gap", position: 1 },
  ]);
  const kept = await createStory(db, user, story({ achievementId: achievement.id }));
  await createStory(db, user, story({ title: "Private one", factStatus: "private" }));

  await saveCompanyNotes(db, user, job.id, "Series C, 300 customers");
  const prep = await generatePrep(db, user, job.id);
  const content = prep.content!;
  assert.equal(content.likelyQuestions[0].question, "Tell me about yourself.");
  const adoption = content.likelyQuestions.find((q) => q.why === "Drive adoption")!;
  assert.deepEqual(adoption.storyIds, [kept.id], "S999 dropped; the private story was never offered");
  assert.equal(adoption.gapAdvice, null);
  assert.ok(content.likelyQuestions.find((q) => q.why === "Salesforce")?.gapAdvice);

  await generatePrep(db, user, job.id);
  const again = await getPrep(db, user, job.id);
  assert.equal(again?.companyNotes, "Series C, 300 customers");
  assert.equal(again?.promptVersion, "prep@1");
  await assert.rejects(generatePrep(db, "someone-else", job.id), /wasn't found/);
});

test("practice (fake): saves the attempt, flags numbers the library doesn't have, keeps history per question", async () => {
  const user = "practice-user";
  await seedLibrary(user);
  await assert.rejects(practiceAnswer(db, user, { question: "Q", answer: "Too short.", competency: "", jobId: null }), /full answer/);
  const answer =
    "When I ran the onsite program, participation was flat, so I had to fix it. I interviewed members, built a six-week challenge, and recruited team captains. As a result participation rose by 45% over the quarter.";
  const attempt = await practiceAnswer(db, user, { question: "Tell me about a time you drove adoption.", answer, competency: "drove-adoption", jobId: null });
  assert.equal(attempt.competency, "drove-adoption");
  assert.equal(attempt.feedback.star.action, true);
  assert.deepEqual(attempt.feedback.unsupportedClaims, ['"45%" isn\'t in your library.']);

  await practiceAnswer(db, user, { question: "Tell me about a time you drove adoption.", answer, competency: "nonsense", jobId: null });
  const history = await listPracticeAttempts(db, user, { question: "Tell me about a time you drove adoption." });
  assert.equal(history.length, 2);
  assert.equal(history[0].competency, "");
  assert.equal((await listPracticeAttempts(db, "someone-else")).length, 0);
});

test("answer length guidance", () => {
  assert.equal(answerLength("").words, 0);
  assert.match(answerLength("word ".repeat(60)).note, /Short/);
  assert.match(answerLength("word ".repeat(250)).note, /good/);
  assert.match(answerLength("word ".repeat(400)).note, /Long/);
  assert.equal(answerLength("word ".repeat(130)).seconds, 60);
});
