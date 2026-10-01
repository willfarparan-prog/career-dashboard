"use client";

import { useActionState, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, FACT_OPTIONS, Notice } from "@/components/ui";
import type { FactStatus, StoryFormat } from "@/db/schema";
import { createStoryAction, draftStoryAction, updateStoryAction, type DraftStoryResult } from "../actions";

type Values = {
  title: string;
  achievementId: string;
  format: StoryFormat;
  situation: string;
  task: string;
  action: string;
  result: string;
  body: string;
  competencies: string[];
  factStatus: FactStatus;
};

const EMPTY: Values = { title: "", achievementId: "", format: "star", situation: "", task: "", action: "", result: "", body: "", competencies: [], factStatus: "needs_confirmation" };

const STAR_FIELDS: Array<{ name: "situation" | "task" | "action" | "result"; label: string; hint: string; rows: number }> = [
  { name: "situation", label: "Situation", hint: "Where you were and what was going on. One or two sentences.", rows: 2 },
  { name: "task", label: "Task", hint: "What you were responsible for.", rows: 2 },
  { name: "action", label: "Action", hint: "What you personally did, step by step. The longest part.", rows: 5 },
  { name: "result", label: "Result", hint: "What changed: a number if you have one, and what you learned.", rows: 3 },
];

export function StoryEditor({ story, achievements, competencies, initialAchievementId, aiReady }: {
  story?: Values & { id: string };
  achievements: Array<{ id: string; headline: string }>;
  competencies: Array<{ key: string; label: string; narrative: boolean }>;
  initialAchievementId?: string;
  aiReady: boolean;
}) {
  const [values, setValues] = useState<Values>(story ?? { ...EMPTY, achievementId: initialAchievementId ?? "" });
  const [format, setFormat] = useState<StoryFormat>(values.format);
  const [version, setVersion] = useState(0);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);

  // Drafting fills the form from Claude's draft; nothing is saved until Save.
  const [draftState, draftAction, drafting] = useActionState(async (previous: DraftStoryResult | null, formData: FormData) => {
    const result = await draftStoryAction(previous, formData);
    if (result.ok) {
      setValues((current) => ({
        ...current,
        title: result.draft.title,
        achievementId: result.achievementId,
        format: "star",
        situation: result.draft.situation,
        task: result.draft.task,
        action: result.draft.action,
        result: result.draft.result,
        competencies: result.draft.competencies,
        factStatus: "needs_confirmation",
      }));
      setFormat("star");
      setOpenQuestions(result.draft.openQuestions);
      setVersion((v) => v + 1);
    }
    return result;
  }, null);

  const narrative = competencies.filter((c) => c.narrative);
  const behavioral = competencies.filter((c) => !c.narrative);

  return (
    <div className="space-y-4">
      {aiReady && achievements.length ? (
        <Card title="Draft from an achievement" description="Claude turns one achievement into a STAR story using only what the achievement says. You edit it before saving.">
          <form action={draftAction} className="flex flex-wrap items-end gap-2">
            <label className="field min-w-[14rem] flex-1">
              <span>Achievement</span>
              <select className="input" name="achievementId" defaultValue={values.achievementId}>
                <option value="">Pick one…</option>
                {achievements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.headline}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={drafting} aria-busy={drafting} className="inline-flex h-8 items-center rounded-[0.25rem] border border-input bg-card px-4 text-[0.8125rem] font-semibold text-primary hover:bg-muted disabled:opacity-50">
              {drafting ? "Drafting…" : "Draft with Claude"}
            </button>
          </form>
          {draftState && !draftState.ok ? (
            <p role="alert" className="mt-2 text-sm text-bad">
              {draftState.error}
            </p>
          ) : null}
          {draftState?.ok ? (
            <div className="mt-3">
              <Notice tone="warn">
                Draft filled in below as <strong>needs confirmation</strong>. Read it as an interviewer would, fix anything that isn&apos;t exactly true, then save.
                {openQuestions.length ? (
                  <>
                    <span className="mt-1 block font-medium">To make it stronger, answer:</span>
                    <ul className="list-disc pl-5">
                      {openQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Notice>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <ActionForm action={story ? updateStoryAction : createStoryAction} className="grid gap-4">
          <div key={version} className="grid gap-4">
            {story ? <input type="hidden" name="id" value={story.id} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span>Title</span>
                <input className="input" name="title" defaultValue={values.title} placeholder="Rebuilt onboarding for new members" required />
              </label>
              <label className="field">
                <span>Based on achievement</span>
                <select className="input" name="achievementId" defaultValue={values.achievementId}>
                  <option value="">None</option>
                  {achievements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.headline}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="grid gap-1.5">
              <legend className="text-xs font-semibold text-muted-foreground">Format</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="format" value="star" checked={format === "star"} onChange={() => setFormat("star")} className="accent-primary" />
                  STAR story
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="format" value="free" checked={format === "free"} onChange={() => setFormat("free")} className="accent-primary" />
                  Free-form answer (e.g. &quot;Tell me about yourself&quot;)
                </label>
              </div>
            </fieldset>

            {format === "star" ? (
              STAR_FIELDS.map((f) => (
                <label key={f.name} className="field">
                  <span>{f.label}</span>
                  <textarea className="input" name={f.name} rows={f.rows} defaultValue={values[f.name]} />
                  <small className="text-xs text-muted-foreground">{f.hint}</small>
                </label>
              ))
            ) : (
              <label className="field">
                <span>Answer</span>
                <textarea className="input" name="body" rows={8} defaultValue={values.body} />
                <small className="text-xs text-muted-foreground">Aim for 60–90 seconds spoken, about 130–200 words.</small>
              </label>
            )}

            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold text-muted-foreground">Answers these questions</legend>
              {[
                { label: "Openers", list: narrative },
                { label: "Behavioral", list: behavioral },
              ].map((group) => (
                <div key={group.label}>
                  <p className="text-xs text-muted-foreground">{group.label}</p>
                  <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                    {group.list.map((c) => (
                      <label key={c.key} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="competencies" value={c.key} defaultChecked={values.competencies.includes(c.key)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>

            <label className="field sm:max-w-xs">
              <span>Fact status</span>
              <select className="input" name="factStatus" defaultValue={values.factStatus}>
                {FACT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <SubmitButton pending="Saving…">{story ? "Save" : "Save story"}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
