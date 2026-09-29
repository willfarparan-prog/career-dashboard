import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, credentials, profiles, roles, skills } from "@/db/schema";

export type Role = typeof roles.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Profile = typeof profiles.$inferSelect;

export type Library = {
  profile: Profile | null;
  roles: Role[];
  achievements: Achievement[];
  skills: Skill[];
  credentials: Credential[];
};

/** Roles newest first (current roles on top), then by manual sort. */
export function sortRoles(list: Role[]): Role[] {
  return [...list].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const end = (b.end || "9999").localeCompare(a.end || "9999");
    if (end !== 0) return end;
    const start = b.start.localeCompare(a.start);
    return start !== 0 ? start : a.sort - b.sort;
  });
}

export async function loadLibrary(db: Database, userId: string): Promise<Library> {
  const [profileRows, roleRows, achievementRows, skillRows, credentialRows] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, userId)),
    db.select().from(roles).where(eq(roles.userId, userId)),
    db.select().from(achievements).where(eq(achievements.userId, userId)).orderBy(asc(achievements.sort), asc(achievements.createdAt)),
    db.select().from(skills).where(eq(skills.userId, userId)).orderBy(asc(skills.name)),
    db.select().from(credentials).where(eq(credentials.userId, userId)).orderBy(asc(credentials.sort), asc(credentials.createdAt)),
  ]);
  return {
    profile: profileRows[0] ?? null,
    roles: sortRoles(roleRows),
    achievements: achievementRows,
    skills: skillRows,
    credentials: credentialRows,
  };
}

/**
 * Short, stable aliases (R1, A1…) stand in for UUIDs in prompts: fewer tokens,
 * and an alias Claude makes up is easy to detect because it isn't in the map.
 */
export type LibraryContext = {
  text: string;
  roleAlias: Map<string, string>;
  achievementAlias: Map<string, string>;
  roleByAlias: Map<string, Role>;
  achievementByAlias: Map<string, Achievement>;
  /** Achievements actually shown to Claude (private ones may be withheld). */
  shared: Achievement[];
};

const line = (label: string, value: string | null | undefined) => (value && value.trim() ? `${label}: ${value.trim()}` : null);

export function formatDates(start: string, end: string, isCurrent: boolean) {
  const from = start || "?";
  const to = isCurrent ? "present" : end || "?";
  return `${from} – ${to}`;
}

export function buildLibraryContext(library: Library, options: { includePrivate?: boolean } = {}): LibraryContext {
  const includePrivate = options.includePrivate ?? library.profile?.sendPrivateToClaude ?? false;
  const visible = <T extends { factStatus: string }>(item: T) => includePrivate || item.factStatus !== "private";

  const roleAlias = new Map<string, string>();
  const roleByAlias = new Map<string, Role>();
  library.roles.filter(visible).forEach((role, index) => {
    const alias = `R${index + 1}`;
    roleAlias.set(role.id, alias);
    roleByAlias.set(alias, role);
  });

  const shared = library.achievements.filter(visible);
  const achievementAlias = new Map<string, string>();
  const achievementByAlias = new Map<string, Achievement>();
  shared.forEach((achievement, index) => {
    const alias = `A${index + 1}`;
    achievementAlias.set(achievement.id, alias);
    achievementByAlias.set(alias, achievement);
  });

  const describeAchievement = (a: Achievement) => {
    const metrics = a.metrics.map((m) => `${m.label} = ${m.value}${m.unit ? ` ${m.unit}` : ""} (${m.status})`).join("; ");
    return [
      `  [${achievementAlias.get(a.id)}] ${a.headline} (fact: ${a.factStatus})`,
      ...[
        line("did", a.action),
        line("for", a.audience),
        line("scale", a.scale),
        line("with", a.collaborators),
        line("tools", a.tools.join(", ")),
        line("outcome", a.outcome),
        line("metrics", metrics),
        line("tags", a.tags.join(", ")),
      ]
        .filter(Boolean)
        .map((text) => `      ${text}`),
    ].join("\n");
  };

  const out: string[] = ["# Career library (the only source of facts)"];
  const p = library.profile;
  if (p) {
    out.push("## Person", ...[line("Name", p.fullName), line("Headline", p.headline), line("Location", p.location)].filter((x): x is string => Boolean(x)));
  }

  out.push("## Roles (newest first)");
  for (const role of library.roles.filter(visible)) {
    out.push(
      `[${roleAlias.get(role.id)}] ${role.title} — ${role.employer} | ${formatDates(role.start, role.end, role.isCurrent)}${role.location ? ` | ${role.location}` : ""} | fact: ${role.factStatus} | SaaS: ${role.isSaas ? "yes" : "no"}`,
    );
    if (role.summary) out.push(`  summary: ${role.summary}`);
    for (const a of shared.filter((item) => item.roleId === role.id)) out.push(describeAchievement(a));
  }
  const loose = shared.filter((a) => !a.roleId || !roleAlias.has(a.roleId));
  if (loose.length) {
    out.push("## Achievements not tied to a role (projects, volunteering, other)");
    for (const a of loose) out.push(describeAchievement(a));
  }

  const skillList = library.skills.filter(visible);
  if (skillList.length) {
    out.push("## Skills and tools", ...skillList.map((s) => `- ${s.name} (${s.category}, fact: ${s.factStatus})`));
  }
  const creds = library.credentials.filter(visible);
  if (creds.length) {
    out.push("## Education, certifications, awards", ...creds.map((c) => `- ${c.kind}: ${c.name}${c.issuer ? `, ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""} (fact: ${c.factStatus})`));
  }

  return { text: out.join("\n"), roleAlias, achievementAlias, roleByAlias, achievementByAlias, shared };
}

/** Maps Claude's aliases back to ids, dropping any it invented. */
export function resolveAliases(aliases: string[], map: Map<string, { id: string }>): string[] {
  const ids = new Set<string>();
  for (const alias of aliases) {
    const item = map.get(alias.trim().toUpperCase());
    if (item) ids.add(item.id);
  }
  return [...ids];
}
