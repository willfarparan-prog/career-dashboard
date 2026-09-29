import assert from "node:assert/strict";
import { test } from "node:test";
import type { Library } from "@/lib/ai/library";
import { extractNumbers, runTruthChecks, similarity } from "@/lib/checks/truth";
import { wordDiff } from "@/lib/drafts/diff";

const now = new Date();
const role = (over: Partial<Library["roles"][number]> = {}): Library["roles"][number] => ({
  id: "role-1", userId: "u", employer: "Peak Performance", title: "Head Coach", start: "2019-03", end: "", isCurrent: true, location: "Tampa, FL",
  employmentType: "", summary: "", isSaas: false, factStatus: "verified", sort: 0, createdAt: now, updatedAt: now, ...over,
});
const achievement = (over: Partial<Library["achievements"][number]> = {}): Library["achievements"][number] => ({
  id: "ach-1", userId: "u", roleId: "role-1", headline: "Built a client onboarding program", action: "Designed onboarding for new members", audience: "adult members",
  scale: "120 members", collaborators: "", tools: ["Trainerize"], outcome: "Raised 90-day retention to 85%", metrics: [{ label: "retention", value: "85", unit: "%", status: "verified" }],
  tags: [], factStatus: "verified", evidenceNote: "", sourceQuote: "", missingMetrics: [], sort: 0, createdAt: now, updatedAt: now, ...over,
});
const library = (over: Partial<Library> = {}): Library => ({
  profile: null, roles: [role()], achievements: [achievement()], skills: [{ id: "s1", userId: "u", name: "Client onboarding", category: "skill", factStatus: "verified", note: "", createdAt: now }], credentials: [], ...over,
});
const bullet = (text: string, over: Record<string, unknown> = {}) => ({ id: `b-${text.length}-${Math.random()}`, roleId: "role-1", achievementId: "ach-1", text, state: "proposed", ...over });
const kinds = (findings: ReturnType<typeof runTruthChecks>) => findings.map((f) => f.kind);
const check = (bullets: ReturnType<typeof bullet>[], over: Partial<Parameters<typeof runTruthChecks>[0]> = {}) =>
  runTruthChecks({ summary: "Coach who builds onboarding programs.", skills: [], roleOrder: ["role-1"], bullets, library: library(), ...over });

test("numbers are normalized for comparison", () => {
  assert.deepEqual(extractNumbers("Grew revenue $1,200 (35%) in 2.50 months, 3x"), ["1200", "35", "2.5", "3"]);
});

test("a supported bullet passes clean", () => {
  assert.deepEqual(kinds(check([bullet("Designed onboarding for 120 adult members, lifting 90-day retention to 85%.")])), []);
});

test("a number that isn't in the linked achievement is an error", () => {
  const findings = check([bullet("Designed onboarding that lifted retention to 95%.")]);
  const metric = findings.find((f) => f.kind === "invented_metric");
  assert.equal(metric?.severity, "error");
  assert.match(metric!.message, /"95"/);
});

test("years from role dates are allowed", () => {
  assert.deepEqual(kinds(check([bullet("Since 2019, designed onboarding for adult members.")])), []);
});

test("a bullet without an achievement is unsupported", () => {
  assert.ok(kinds(check([bullet("Managed enterprise renewals.", { achievementId: null })])).includes("unsupported"));
});

test("unverified achievements, wrong roles and private facts are flagged", () => {
  const lib = library({ achievements: [achievement({ factStatus: "approximate", roleId: "role-2" })], roles: [role(), role({ id: "role-2", title: "Assistant Coach" })] });
  const found = kinds(check([bullet("Designed onboarding for adult members.")], { library: lib }));
  assert.ok(found.includes("unverified_fact"));
  assert.ok(found.includes("wrong_role"));
});

test("SaaS claims need a SaaS-marked role", () => {
  assert.ok(kinds(check([bullet("Drove SaaS adoption for adult members.")])).includes("saas_claim"));
  const withSaas = library({ roles: [role({ isSaas: true })] });
  assert.ok(!kinds(check([bullet("Drove SaaS adoption for adult members.")], { library: withSaas })).includes("saas_claim"));
});

test("an implied title in the summary is flagged", () => {
  assert.ok(kinds(check([], { summary: "Customer Success Manager with a coaching background." })).includes("inflated_title"));
  assert.ok(!kinds(check([], { summary: "Head coach moving into customer success." })).includes("inflated_title"));
});

test("duplicates, vague filler and repeated verbs are caught", () => {
  const found = kinds(
    check([
      bullet("Designed onboarding for adult members."),
      bullet("Designed onboarding for adult members."),
      bullet("Responsible for various onboarding tasks for members."),
      bullet("Designed a welcome sequence for adult members and families."),
    ]),
  );
  assert.ok(found.includes("duplicate"));
  assert.ok(found.includes("vague"));
  assert.ok(found.includes("repetition"));
});

test("rejected bullets are ignored", () => {
  assert.deepEqual(kinds(check([bullet("Grew revenue 400%.", { state: "rejected", achievementId: null })])), []);
});

test("date problems and unsupported skills", () => {
  const lib = library({ roles: [role({ isCurrent: false, start: "2021-05", end: "2020-01" })] });
  const found = check([], { library: lib, skills: [{ name: "Salesforce", evidence: [] }, { name: "trainerize", evidence: [] }] });
  assert.ok(found.some((f) => f.kind === "date" && f.severity === "error"));
  assert.deepEqual(found.filter((f) => f.kind === "unsupported_skill").map((f) => f.message.split('"')[1]), ["Salesforce"]);
});

test("similarity and word diff", () => {
  assert.ok(similarity("Built onboarding for members", "Built onboarding for new members") > 0.7);
  const parts = wordDiff("Led weekly group sessions", "Led weekly client sessions");
  assert.deepEqual(parts.filter((p) => p.type !== "same").map((p) => `${p.type}:${p.text}`), ["removed:group", "added:client"]);
});
