import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, profiles, skills } from "@/db/schema";
import {
  allTags,
  createAchievement,
  deleteAchievement,
  getAchievement,
  groupByRole,
  listAchievements,
  metricPrompts,
  updateAchievement,
  type AchievementInput,
} from "@/lib/career/achievements";
import { createCredential, deleteCredential, listCredentials, updateCredential } from "@/lib/career/credentials";
import { setFactStatus } from "@/lib/career/facts";
import { parseAchievementForm, parseAnnualUsd, parseSearchSettingsForm } from "@/lib/career/forms";
import { formatRange, normalizeMonth } from "@/lib/career/labels";
import { ensureProfile, fitWeightsOf, getProfile, saveContact, saveSearchSettings } from "@/lib/career/profile";
import { createRole, deleteRole, findRoleByTitle, getRole, listRoles, updateRole, type RoleInput } from "@/lib/career/roles";
import { addSkill, deleteSkill, listSkills, updateSkill } from "@/lib/career/skills";
import { CareerInputError } from "@/lib/career/util";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const ME = "career-owner";
const OTHER = "career-stranger";

const role = (overrides: Partial<RoleInput> = {}): RoleInput => ({
  employer: "Harbor Fitness",
  title: "Head Coach",
  start: "2019-03",
  end: "",
  isCurrent: true,
  location: "Tampa, FL",
  employmentType: "Full-time",
  summary: "",
  isSaas: false,
  factStatus: "verified",
  ...overrides,
});

const achievement = (overrides: Partial<AchievementInput> = {}): AchievementInput => ({
  roleId: null,
  headline: "Built member onboarding",
  action: "Designed a four-week onboarding program",
  audience: "new members",
  scale: "",
  collaborators: "",
  tools: ["Mindbody", "mindbody", " Excel "],
  outcome: "",
  metrics: [],
  tags: ["Onboarding", "program ownership"],
  factStatus: "verified",
  evidenceNote: "",
  missingMetrics: [],
  ...overrides,
});

const isInputError = (pattern: RegExp) => (error: unknown) => error instanceof CareerInputError && pattern.test(error.message);

test("dates accept YYYY-MM or YYYY and format for display", () => {
  assert.equal(normalizeMonth("2021-3"), "2021-03");
  assert.equal(normalizeMonth("2021/04"), "2021-04");
  assert.equal(normalizeMonth("2021"), "2021");
  assert.equal(normalizeMonth(""), "");
  assert.equal(normalizeMonth("March 2021"), null);
  assert.equal(normalizeMonth("2021-13"), null);
  assert.equal(formatRange("2021-03", "", true), "Mar 2021 – Present");
  assert.equal(formatRange("2019", "2021-11", false), "2019 – Nov 2021");
});

test("profile contact details upsert into one row per user", async () => {
  assert.equal(await getProfile(db, ME), null);
  await saveContact(db, ME, { fullName: " Will Test ", headline: "Coach", email: "will@example.com", phone: "", location: "Tampa, FL", links: ["https://example.com", "https://example.com"] });
  const saved = await saveContact(db, ME, { fullName: "Will Test", headline: "Coach → CS", email: "will@example.com", phone: "555", location: "Tampa, FL", links: ["https://example.com"] });
  assert.equal(saved.headline, "Coach → CS");
  assert.deepEqual(saved.links, ["https://example.com"]);
  assert.equal((await db.select().from(profiles).where(eq(profiles.userId, ME))).length, 1);
  await assert.rejects(saveContact(db, ME, { fullName: "", headline: "", email: "not-an-email", phone: "", location: "", links: [] }), isInputError(/email/));
});

test("search settings save targets, comp minimum and clamped fit weights", async () => {
  const form = new FormData();
  form.append("targetRoles", "customer_success");
  form.append("targetRoles", "implementation");
  form.append("targetRoles", "strength_conditioning");
  form.append("targetRoles", "astronaut");
  form.set("targetLocations", "San Francisco, Remote, Tampa");
  form.set("remoteOk", "on");
  form.set("compMin", "$85,000");
  form.set("weight_compensation", "5");
  form.set("weight_location", "9");
  form.set("weight_fit", "");
  const saved = await saveSearchSettings(db, ME, parseSearchSettingsForm(form));
  assert.deepEqual(saved.targetRoles, ["customer_success", "implementation", "strength_conditioning"]);
  assert.deepEqual(saved.targetLocations, ["San Francisco", "Remote", "Tampa"]);
  assert.equal(saved.remoteOk, true);
  assert.equal(saved.compMin, 85000);
  assert.deepEqual(saved.fitWeights, { compensation: 5, location: 5, fit: 3, companySize: 3, growth: 3, interest: 3 });
  // Contact details from the earlier test are untouched.
  assert.equal(saved.fullName, "Will Test");
  assert.equal(parseAnnualUsd("90k"), 90000);
  assert.throws(() => parseAnnualUsd("lots"), CareerInputError);
  assert.deepEqual(fitWeightsOf(null), { compensation: 3, location: 3, fit: 3, companySize: 3, growth: 3, interest: 3 });
  const fresh = await ensureProfile(db, "brand-new-user");
  assert.equal(fresh.userId, "brand-new-user");
});

test("roles CRUD validates dates and is scoped to the owner", async () => {
  const created = await createRole(db, ME, role({ start: "2019-3" }));
  assert.equal(created.start, "2019-03");
  await assert.rejects(createRole(db, ME, role({ title: " " })), isInputError(/title/));
  await assert.rejects(createRole(db, ME, role({ start: "last spring" })), isInputError(/start date/));
  await assert.rejects(createRole(db, ME, role({ start: "2021", end: "2019", isCurrent: false })), isInputError(/before/));

  const updated = await updateRole(db, ME, created.id, role({ isCurrent: false, end: "2024-01", isSaas: true }));
  assert.equal(updated.end, "2024-01");
  assert.equal(updated.isSaas, true);
  const current = await updateRole(db, ME, created.id, role({ isCurrent: true, end: "2024-01" }));
  assert.equal(current.end, "", "a current role has no end date");

  assert.equal((await findRoleByTitle(db, ME, "harbor fitness ", "HEAD COACH"))?.id, created.id);
  assert.equal(await findRoleByTitle(db, OTHER, "Harbor Fitness", "Head Coach"), null);

  // Another user can't read, change or delete it.
  assert.equal(await getRole(db, OTHER, created.id), null);
  await assert.rejects(updateRole(db, OTHER, created.id, role({ title: "Hacked" })), isInputError(/no longer exists/));
  assert.equal(await deleteRole(db, OTHER, created.id), false);
  assert.equal(await getRole(db, OTHER, "not-a-uuid"), null);
  assert.equal((await listRoles(db, OTHER)).length, 0);
  assert.equal((await getRole(db, ME, created.id))?.title, "Head Coach");

  assert.equal(await deleteRole(db, ME, created.id), true);
  assert.equal(await getRole(db, ME, created.id), null);
});

test("credentials CRUD is scoped to the owner", async () => {
  const cred = await createCredential(db, ME, { kind: "certification", name: "CPT", issuer: "NASM", date: "2018", detail: "", factStatus: "approximate" });
  await assert.rejects(createCredential(db, ME, { kind: "badge" as never, name: "x", issuer: "", date: "", detail: "", factStatus: "verified" }), CareerInputError);
  await assert.rejects(updateCredential(db, OTHER, cred.id, { kind: "award", name: "Mine now", issuer: "", date: "", detail: "", factStatus: "verified" }), CareerInputError);
  const updated = await updateCredential(db, ME, cred.id, { kind: "certification", name: "Certified Personal Trainer", issuer: "NASM", date: "2018", detail: "", factStatus: "verified" });
  assert.equal(updated.name, "Certified Personal Trainer");
  assert.equal((await listCredentials(db, OTHER)).length, 0);
  assert.equal(await deleteCredential(db, OTHER, cred.id), false);
  assert.equal(await deleteCredential(db, ME, cred.id), true);
  assert.equal((await listCredentials(db, ME)).length, 0);
});

test("skills dedupe case-insensitively and per user", async () => {
  const first = await addSkill(db, ME, { name: "Program Design", category: "skill", factStatus: "verified" });
  assert.equal(first.created, true);
  const again = await addSkill(db, ME, { name: "  program design ", category: "tool", factStatus: "needs_confirmation" });
  assert.equal(again.created, false);
  assert.equal(again.skill.id, first.skill.id);
  const theirs = await addSkill(db, OTHER, { name: "program design", category: "skill", factStatus: "verified" });
  assert.equal(theirs.created, true, "another user's library is separate");

  const excel = await addSkill(db, ME, { name: "Excel", category: "tool", factStatus: "verified" });
  await assert.rejects(updateSkill(db, ME, excel.skill.id, { name: "PROGRAM DESIGN", category: "skill", factStatus: "verified" }), isInputError(/already have/));
  const renamed = await updateSkill(db, ME, excel.skill.id, { name: "Microsoft Excel", category: "tool", factStatus: "approximate" });
  assert.equal(renamed.name, "Microsoft Excel");
  await assert.rejects(updateSkill(db, OTHER, excel.skill.id, { name: "Stolen", category: "tool", factStatus: "verified" }), CareerInputError);

  // The database backs the dedupe up too.
  await assert.rejects(db.insert(skills).values({ userId: ME, name: "EXCEL" }).then(() => db.insert(skills).values({ userId: ME, name: "excel" })));
  assert.deepEqual((await listSkills(db, OTHER)).map((s) => s.name), ["program design"]);
  assert.equal(await deleteSkill(db, OTHER, first.skill.id), false);
  assert.equal(await deleteSkill(db, ME, first.skill.id), true);
});

test("achievements CRUD cleans input, filters, groups and stays scoped", async () => {
  const gym = await createRole(db, ME, role());
  const theirRole = await createRole(db, OTHER, role({ employer: "Elsewhere" }));

  const a = await createAchievement(db, ME, achievement({ roleId: gym.id }));
  assert.deepEqual(a.tools, ["Mindbody", "Excel"]);
  assert.deepEqual(a.tags, ["onboarding", "program ownership"]);
  await assert.rejects(createAchievement(db, ME, achievement({ roleId: theirRole.id })), isInputError(/your roles/));
  await assert.rejects(createAchievement(db, ME, achievement({ headline: "" })), isInputError(/headline/));
  await assert.rejects(createAchievement(db, ME, achievement({ metrics: [{ label: "members", value: "", unit: null, status: "verified" }] })), isInputError(/number for “members”/));

  const b = await createAchievement(
    db,
    ME,
    achievement({
      headline: "Grew retention",
      tags: ["retention"],
      metrics: [
        { label: "retention", value: "18", unit: "%", status: "verified" },
        { label: "", value: "", unit: null, status: "verified" },
      ],
    }),
  );
  assert.equal(b.metrics.length, 1, "blank metric rows are ignored");

  assert.deepEqual((await listAchievements(db, ME, { role: gym.id })).map((x) => x.id), [a.id]);
  assert.deepEqual((await listAchievements(db, ME, { role: "none" })).map((x) => x.id), [b.id]);
  assert.deepEqual((await listAchievements(db, ME, { tag: "Retention" })).map((x) => x.id), [b.id]);
  assert.deepEqual((await listAchievements(db, ME, { missingMetrics: true })).map((x) => x.id), [a.id]);
  assert.equal((await listAchievements(db, ME, { status: "needs_confirmation" })).length, 0);
  assert.equal((await listAchievements(db, OTHER)).length, 0);
  assert.deepEqual(allTags(await listAchievements(db, ME)), ["onboarding", "program ownership", "retention"]);

  const groups = groupByRole(await listAchievements(db, ME), await listRoles(db, ME));
  assert.deepEqual(groups.map((g) => [g.role?.id ?? null, g.items.length]), [[gym.id, 1], [null, 1]]);

  // Prompts ask for numbers; they never supply them.
  assert.deepEqual(metricPrompts(a), ["people onboarded", "time to onboard", "participation", "programs run", "retention"]);
  assert.deepEqual(metricPrompts(b), []);
  assert.deepEqual(metricPrompts({ ...b, missingMetrics: ["referrals"] }), ["referrals"]);

  assert.equal(await getAchievement(db, OTHER, a.id), null);
  await assert.rejects(updateAchievement(db, OTHER, a.id, achievement({ headline: "Mine" })), CareerInputError);
  const edited = await updateAchievement(db, ME, a.id, achievement({ roleId: gym.id, headline: "Built a four-week onboarding program" }));
  assert.equal(edited.headline, "Built a four-week onboarding program");
  assert.equal(await deleteAchievement(db, OTHER, a.id), false);

  // Deleting a role keeps its achievements, just without a role.
  await deleteRole(db, ME, gym.id);
  assert.equal((await getAchievement(db, ME, a.id))?.roleId, null);
  assert.equal(await deleteAchievement(db, ME, a.id), true);
});

test("the achievement form reads metric rows and skips blank ones", () => {
  const form = new FormData();
  form.set("headline", "Ran wellness challenges");
  form.set("tools", "Excel, Slack");
  form.set("tags", "employer wellbeing, stakeholder management");
  for (const [label, value, unit, status] of [
    ["participants", "140", "", "approximate"],
    ["", "", "", "verified"],
  ]) {
    form.append("metricLabel", label);
    form.append("metricValue", value);
    form.append("metricUnit", unit);
    form.append("metricStatus", status);
  }
  const input = parseAchievementForm(form);
  assert.equal(input.roleId, null);
  assert.deepEqual(input.tools, ["Excel", "Slack"]);
  assert.deepEqual(input.metrics[0], { label: "participants", value: "140", unit: null, status: "approximate" });
  assert.equal(input.metrics.length, 2, "cleanMetrics drops the blank row on save");
});

test("quick fact status changes are scoped and verify an achievement's numbers", async () => {
  const r = await createRole(db, ME, role({ employer: "Bayview", factStatus: "needs_confirmation" }));
  await setFactStatus(db, ME, "role", r.id, "verified");
  assert.equal((await getRole(db, ME, r.id))?.factStatus, "verified");
  await assert.rejects(setFactStatus(db, OTHER, "role", r.id, "private"), CareerInputError);
  await assert.rejects(setFactStatus(db, ME, "role", r.id, "made_up" as never), CareerInputError);

  const a = await createAchievement(
    db,
    ME,
    achievement({ factStatus: "needs_confirmation", metrics: [{ label: "members", value: "250", unit: null, status: "needs_confirmation" }, { label: "hours", value: "10", unit: null, status: "approximate" }] }),
  );
  await setFactStatus(db, ME, "achievement", a.id, "verified");
  const [row] = await db.select().from(achievements).where(eq(achievements.id, a.id));
  assert.equal(row.factStatus, "verified");
  assert.deepEqual(row.metrics.map((m) => m.status), ["verified", "approximate"]);
});
