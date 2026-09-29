import { FACT_OPTIONS } from "@/components/ui";
import type { Achievement, Role } from "@/lib/ai/library";
import type { ActionResult } from "@/lib/action-result";
import { metricPrompts } from "@/lib/career/achievements";
import { DEFAULT_METRIC_PROMPTS } from "@/lib/career/labels";
import { FactStatusField, SelectField, TextArea, TextField } from "../profile/fields";
import { StickyForm, StickySubmit } from "../profile/sticky-form";
import { MetricPrompt } from "./achievement-card";

const BLANK_METRIC_ROWS = 3;

function MetricRows({ achievement }: { achievement?: Achievement }) {
  const rows = [...(achievement?.metrics ?? []), ...Array.from({ length: BLANK_METRIC_ROWS }, () => null)];
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Numbers</legend>
      <p className="text-xs text-muted-foreground">Only numbers you can back up. Blank rows are ignored; clear a row to remove it.</p>
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-2 text-xs font-medium text-muted-foreground sm:grid">
        <span>What it measures</span>
        <span>Number</span>
        <span>Unit</span>
        <span>Status</span>
      </div>
      {rows.map((m, i) => (
        <div
          key={i}
          className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] sm:border-0 sm:p-0"
        >
          <input className="input col-span-2 sm:col-span-1" name="metricLabel" defaultValue={m?.label ?? ""} placeholder="What it measures" aria-label={`Number ${i + 1}: what it measures`} />
          <input className="input" name="metricValue" defaultValue={m?.value ?? ""} placeholder="Number" inputMode="decimal" aria-label={`Number ${i + 1}: value`} />
          <input className="input" name="metricUnit" defaultValue={m?.unit ?? ""} placeholder="%, members…" aria-label={`Number ${i + 1}: unit`} />
          <select className="input col-span-2 sm:col-span-1" name="metricStatus" defaultValue={m?.status ?? "verified"} aria-label={`Number ${i + 1}: fact status`}>
            {FACT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </fieldset>
  );
}

export function AchievementForm({ roles, achievement, defaultRoleId, action, submitLabel }: {
  roles: Role[];
  achievement?: Achievement;
  defaultRoleId?: string;
  action: (state: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
}) {
  const roleOptions = [{ value: "", label: "No role (project, volunteering, other)" }, ...roles.map((r) => ({ value: r.id, label: `${r.title} — ${r.employer}` }))];
  const prompts = achievement ? metricPrompts(achievement) : [];
  return (
    <StickyForm action={action} className="grid gap-5">
      {achievement ? <input type="hidden" name="id" value={achievement.id} /> : null}

      <div className="grid gap-3">
        <SelectField label="Role" name="roleId" defaultValue={achievement?.roleId ?? defaultRoleId ?? ""} options={roleOptions} />
        <TextField label="Headline" name="headline" defaultValue={achievement?.headline} placeholder="Built a new-member onboarding program" required hint="Short and plain. Under 12 words is best." />
        <TextArea label="What you did" name="action" defaultValue={achievement?.action} placeholder="Designed and ran a four-week onboarding program…" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Whom it served" name="audience" defaultValue={achievement?.audience} placeholder="New members, client employers…" />
          <TextField label="Scale" name="scale" defaultValue={achievement?.scale} placeholder="250 members, 12 sites…" />
          <TextField label="Worked with" name="collaborators" defaultValue={achievement?.collaborators} placeholder="HR, front desk, sales…" />
          <TextField label="Tools" name="tools" defaultValue={achievement?.tools.join(", ")} placeholder="Mindbody, Excel" hint="Separate with commas." />
        </div>
        <TextArea label="Outcome" name="outcome" rows={2} defaultValue={achievement?.outcome} placeholder="What changed because of it." />
      </div>

      <div className="grid gap-3">
        {achievement ? (
          <MetricPrompt prompts={prompts} />
        ) : (
          <p className="text-xs text-muted-foreground">Numbers that usually help: {DEFAULT_METRIC_PROMPTS.join(", ")}. Leave them out if you don&apos;t have them.</p>
        )}
        <MetricRows achievement={achievement} />
        <TextField
          label="Numbers to find"
          name="missingMetrics"
          defaultValue={achievement?.missingMetrics.join(", ")}
          placeholder="participation, retention"
          hint="Numbers you'd like to add later. Shown as reminders; never filled in for you."
        />
      </div>

      <div className="grid gap-3">
        <TextField
          label="Tags"
          name="tags"
          defaultValue={achievement?.tags.join(", ")}
          placeholder="program ownership, onboarding"
          hint="For example: program ownership, stakeholder management, client adoption, onboarding, retention, coaching."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FactStatusField defaultValue={achievement?.factStatus ?? "verified"} />
          <TextArea label="Evidence note" name="evidenceNote" rows={2} defaultValue={achievement?.evidenceNote} placeholder="Where this can be checked: a report, a review, an email." />
        </div>
        {achievement?.sourceQuote ? (
          <div className="text-sm">
            <p className="font-medium">From your resume</p>
            <blockquote className="mt-1 border-l-2 border-border pl-3 break-words text-muted-foreground">{achievement.sourceQuote}</blockquote>
          </div>
        ) : null}
      </div>

      <div>
        <StickySubmit>{submitLabel}</StickySubmit>
      </div>
    </StickyForm>
  );
}
