import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Notice, PageHeader, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { importSourceLabel, listImports, type ImportListItem } from "@/lib/career/imports";
import { getProfile } from "@/lib/career/profile";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import a resume" };

// Reading a resume with Claude can take a while; this also covers the page's server actions.
export const maxDuration = 300;

const STATUS: Record<ImportListItem["status"], { tone: "warn" | "ok" | "neutral" | "bad"; label: string }> = {
  pending: { tone: "warn", label: "Waiting for review" },
  reviewed: { tone: "ok", label: "Added" },
  discarded: { tone: "neutral", label: "Discarded" },
  failed: { tone: "bad", label: "Failed" },
};

function counts(item: ImportListItem) {
  if (!item.counts) return null;
  const { roles, achievements, skills } = item.counts;
  return `${roles} ${roles === 1 ? "role" : "roles"} · ${achievements} ${achievements === 1 ? "achievement" : "achievements"} · ${skills} ${skills === 1 ? "skill" : "skills"}`;
}

export default async function ImportPage() {
  const { userId } = await requireViewer();
  const db = getDatabase();
  const [imports, profile] = db ? await Promise.all([listImports(db, userId), getProfile(db, userId)]) : [[], null];
  const ready = aiConfigured() && Boolean(db);

  return (
    <>
      <PageHeader
        title="Import a resume"
        description="Claude reads your resume and proposes roles, achievements and skills. Nothing is added until you review it."
        back={{ href: "/profile", label: "Profile" }}
      />
      <div className="grid gap-5">
        {!db ? <Notice tone="warn">No database is connected yet. Set DATABASE_URL first.</Notice> : null}
        {!aiConfigured() ? <Notice tone="warn">Claude isn&apos;t connected yet. Add ANTHROPIC_API_KEY to import a resume.</Notice> : null}

        <Card title="Your resume">
          <ImportForm disabled={!ready} />
        </Card>

        <p className="text-xs text-muted-foreground">
          {profile?.keepImportText
            ? "You've chosen to keep resume text after review. Change this in Settings."
            : "The resume text is deleted once you've reviewed or discarded the import. Change this in Settings."}
        </p>

        <Card title="Past imports">
          {imports.length ? (
            <ul className="divide-y divide-border">
              {imports.map((item) => {
                const status = STATUS[item.status];
                const summary = counts(item);
                return (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{importSourceLabel(item)}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(item.createdAt)}
                        {summary ? ` · ${summary}` : ""}
                      </p>
                      {item.status === "failed" && item.error ? <p className="mt-1 text-sm break-words text-bad">{item.error}</p> : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {item.status !== "failed" ? (
                        <Link href={`/profile/import/${item.id}`} className="text-sm font-medium text-primary hover:underline">
                          {item.status === "pending" ? "Review" : "View"}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
