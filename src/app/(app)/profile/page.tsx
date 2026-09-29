import type { Metadata } from "next";
import Link from "next/link";
import { getDatabase } from "@/db";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { requireViewer } from "@/lib/auth/owner";
import { listAchievements } from "@/lib/career/achievements";
import { listCredentials } from "@/lib/career/credentials";
import { getProfile } from "@/lib/career/profile";
import { listRoles } from "@/lib/career/roles";
import { listSkills } from "@/lib/career/skills";
import { CredentialsCard } from "./credentials-card";
import { RolesCard } from "./roles-card";
import { ContactCard, SearchCard } from "./settings-cards";
import { SkillsCard } from "./skills-card";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { userId } = await requireViewer();
  const db = getDatabase();
  const header = (
    <PageHeader
      title="Profile"
      description="Your contact details, what you're looking for, and the facts every resume is built from."
      actions={
        <>
          <ButtonLink href="/profile/import" variant="secondary">
            Import a resume
          </ButtonLink>
          <ButtonLink href="/achievements" variant="secondary">
            Achievements
          </ButtonLink>
        </>
      }
    />
  );
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet. Set DATABASE_URL to start your library.</Notice>
      </>
    );
  }

  const [profile, roles, credentials, skills, achievements] = await Promise.all([
    getProfile(db, userId),
    listRoles(db, userId),
    listCredentials(db, userId),
    listSkills(db, userId),
    listAchievements(db, userId),
  ]);
  const achievementCounts = new Map<string, number>();
  for (const a of achievements) if (a.roleId) achievementCounts.set(a.roleId, (achievementCounts.get(a.roleId) ?? 0) + 1);
  const unconfirmed = [...roles, ...credentials, ...skills].filter((item) => item.factStatus === "needs_confirmation").length;
  const unconfirmedAchievements = achievements.filter((a) => a.factStatus === "needs_confirmation").length;

  return (
    <>
      {header}
      <div className="grid gap-5">
        {unconfirmed || unconfirmedAchievements ? (
          <Notice tone="warn">
            {unconfirmed ? `${unconfirmed === 1 ? "1 item below needs" : `${unconfirmed} items below need`} confirmation. Check each one and mark it verified. ` : null}
            {unconfirmedAchievements ? (
              <Link href="/achievements?status=needs_confirmation" className="font-medium underline">
                {unconfirmedAchievements === 1 ? "1 achievement needs" : `${unconfirmedAchievements} achievements need`} confirmation{unconfirmed ? " too" : ""}.
              </Link>
            ) : null}
          </Notice>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-2">
          <ContactCard profile={profile} />
          <SearchCard profile={profile} />
        </div>
        <RolesCard roles={roles} achievementCounts={achievementCounts} />
        <CredentialsCard credentials={credentials} />
        <SkillsCard skills={skills} />
      </div>
    </>
  );
}
