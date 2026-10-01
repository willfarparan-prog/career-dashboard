import { Award, ExternalLink } from "lucide-react";
import Link from "next/link";
import { AutoSubmitSelect } from "@/app/(app)/jobs/[id]/auto-submit-select";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui";
import type { LearningStatus } from "@/db/schema";
import type { LearningResource } from "@/content/learn/types";
import { resourceKey, type Progress } from "@/lib/learn/progress";
import { glossaryTerm } from "@/lib/learn/terms";
import { addCertificateAction, setProgressAction } from "./actions";

/** A one-click toggle: sets `status` on the item, or clears it if already set. */
export function ProgressToggle({ itemKey, current, status, label, doneLabel }: {
  itemKey: string;
  current: LearningStatus | undefined;
  status: LearningStatus;
  label: string;
  doneLabel: string;
}) {
  const on = current === status;
  return (
    <ActionForm action={setProgressAction}>
      <input type="hidden" name="key" value={itemKey} />
      <input type="hidden" name="status" value={on ? "" : status} />
      <SubmitButton variant={on ? "ghost" : "secondary"} size="sm" pending="Saving…">
        {on ? `✓ ${doneLabel}` : label}
      </SubmitButton>
    </ActionForm>
  );
}

/** A glossary term as a chip that links to its definition. */
export function TermChip({ termKey }: { termKey: string }) {
  const term = glossaryTerm(termKey);
  if (!term) return null;
  return (
    <Link
      href={`/learn/glossary#term-${term.key}`}
      title={term.definition}
      className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
    >
      {term.term}
    </Link>
  );
}

const RESOURCE_OPTIONS = [
  { value: "", label: "Not started" },
  { value: "learning", label: "In progress" },
  { value: "done", label: "Done" },
];

export function ResourceItem({ resource, progress }: { resource: LearningResource; progress: Progress }) {
  const key = resourceKey(resource.key);
  const status = progress.get(key);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[14rem] flex-1">
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {resource.title}
            <ExternalLink aria-hidden size={12} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <p className="text-xs text-muted-foreground">{[resource.provider, resource.effort].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {resource.certificate ? (
            <Badge tone="info">
              <Award aria-hidden size={11} /> Certificate
            </Badge>
          ) : null}
          {/* Keyed on the saved status so the select shows it after the form resets. */}
          <ActionForm key={status ?? "none"} action={setProgressAction}>
            <input type="hidden" name="key" value={key} />
            <AutoSubmitSelect name="status" label={`Progress on ${resource.title}`} defaultValue={status ?? ""} options={RESOURCE_OPTIONS} />
          </ActionForm>
        </div>
      </div>
      <p className="mt-1 text-sm">{resource.why}</p>
      <p className="mt-1 text-xs text-muted-foreground">Cost: {resource.cost}</p>
      {resource.certificate && status === "done" ? (
        <ActionForm action={addCertificateAction} className="mt-2">
          <input type="hidden" name="resource" value={resource.key} />
          <SubmitButton variant="secondary" size="sm" pending="Adding…">
            Add to my credentials
          </SubmitButton>
        </ActionForm>
      ) : null}
    </li>
  );
}
