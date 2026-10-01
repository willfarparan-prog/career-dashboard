import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";
import { getDatabase } from "@/db";
import { GUIDES, isGuidePath } from "@/content/learn/guides";
import { RESOURCES } from "@/content/learn/resources";
import { GUIDE_SECTION_LABELS, type FieldGuide, type GuidePath, type GuideSection } from "@/content/learn/types";
import { requireViewer } from "@/lib/auth/owner";
import { guideKey, listProgress, type Progress } from "@/lib/learn/progress";
import { glossaryTerm } from "@/lib/learn/terms";
import { ProgressToggle, ResourceItem, TermChip } from "../parts";

type Params = Promise<{ path: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { path } = await params;
  return { title: isGuidePath(path) ? `${GUIDES[path].title} · Learn` : "Learn" };
}

export default async function GuidePage({ params }: { params: Params }) {
  const [{ path }, { userId }] = await Promise.all([params, requireViewer()]);
  if (!isGuidePath(path)) notFound();
  const guide = GUIDES[path];
  const db = getDatabase();
  const progress: Progress = db ? await listProgress(db, userId) : new Map();
  const resources = RESOURCES.filter((resource) => resource.paths.includes(path));

  const section = (key: GuideSection, children: ReactNode, description?: string) => (
    <Section key={key} guide={path} section={key} progress={progress} description={description}>
      {children}
    </Section>
  );

  return (
    <>
      <PageHeader title={guide.title} description={guide.oneLiner} back={{ href: "/learn", label: "Learn" }} />
      <div className="space-y-4">
        <Card title="Start here this week">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {guide.firstSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>

        {section(
          "day",
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {guide.dayInTheLife.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>,
        )}

        {section("workflow", <Workflow guide={guide} />, "The stages a customer moves through, what you produce at each, and where you've done the same thing as a coach.")}

        {section(
          "metrics",
          <dl className="divide-y divide-border">
            {guide.metrics.map((metric) => {
              const term = glossaryTerm(metric.term);
              return (
                <div key={metric.term} className="py-2.5">
                  <dt className="text-sm font-semibold">
                    <TermChip termKey={metric.term} />
                  </dt>
                  <dd className="mt-1 text-sm">{term?.definition}</dd>
                  <dd className="mt-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Why it matters: </span>
                    {metric.whyItMatters}
                  </dd>
                </div>
              );
            })}
          </dl>,
        )}

        {section(
          "tools",
          <ul className="divide-y divide-border">
            {guide.tools.map((tool) => (
              <li key={tool.name} className="py-2.5 text-sm">
                <p className="font-semibold">{tool.name}</p>
                <p className="text-xs text-muted-foreground">{tool.category}</p>
                <p className="mt-1">{tool.note}</p>
              </li>
            ))}
          </ul>,
          "You don't need all of these. Know what each category is for, and get hands-on with one CRM.",
        )}

        {section(
          "interviews",
          <ol className="space-y-3">
            {guide.interviewLoop.map((round, index) => (
              <li key={round.name} className="text-sm">
                <p className="font-semibold">
                  {index + 1}. {round.name}
                </p>
                <p className="mt-0.5">{round.what}</p>
                <p className="mt-0.5 text-muted-foreground">
                  <span className="font-medium text-foreground">Tip: </span>
                  {round.tip}
                </p>
              </li>
            ))}
          </ol>,
          "A typical loop. Companies vary, so ask the recruiter what each round covers.",
        )}

        {section(
          "switcher",
          <dl className="space-y-3">
            {guide.switcherConcerns.map((item) => (
              <div key={item.concern} className="text-sm">
                <dt className="font-semibold">{item.concern}</dt>
                <dd className="mt-0.5">{item.answer}</dd>
              </div>
            ))}
          </dl>,
          "Honest answers only: the app's resume rules apply in the room too.",
        )}

        {section(
          "translation",
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">In coaching</th>
                  <th scope="col" className="py-1.5 font-semibold">In their words</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {guide.translation.map((row) => (
                  <tr key={row.coaching}>
                    <td className="py-1.5 pr-3 align-top">{row.coaching}</td>
                    <td className="py-1.5 align-top font-medium">{row.business}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          "Use their words only where your experience genuinely matches.",
        )}

        {resources.length ? (
          <Card title="Courses for this path">
            <ul className="divide-y divide-border">
              {resources.map((resource) => (
                <ResourceItem key={resource.key} resource={resource} progress={progress} />
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Section({ guide, section, progress, description, children }: { guide: GuidePath; section: GuideSection; progress: Progress; description?: string; children: ReactNode }) {
  const key = guideKey(guide, section);
  return (
    <Card
      title={GUIDE_SECTION_LABELS[section]}
      description={description}
      actions={<ProgressToggle itemKey={key} current={progress.get(key)} status="done" label="Mark understood" doneLabel="Understood" />}
    >
      {children}
    </Card>
  );
}

function Workflow({ guide }: { guide: FieldGuide }) {
  return (
    <ol className="space-y-4">
      {guide.workflow.map((stage, index) => (
        <li key={stage.name} className="rounded-md border border-border p-3">
          <p className="text-sm font-semibold">
            <span className="text-muted-foreground tabular-nums">{index + 1}.</span> {stage.name}
          </p>
          <p className="mt-1 text-sm">{stage.what}</p>
          <p className="mt-1.5 text-sm">
            <span className="font-medium">You produce: </span>
            {stage.artifacts.join(", ")}
          </p>
          <p className="mt-1.5 rounded-md bg-info-soft px-2.5 py-1.5 text-sm">
            <span className="font-medium">As a coach: </span>
            {stage.coachingAnalog}
          </p>
          {stage.terms.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Terms">
              {stage.terms.map((key) => (
                <li key={key}>
                  <TermChip termKey={key} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
