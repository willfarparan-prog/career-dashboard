import { Card, FactBadge } from "@/components/ui";
import type { Skill } from "@/lib/ai/library";
import { SKILL_CATEGORIES, SKILL_CATEGORY_LABELS } from "@/lib/career/labels";
import { addSkillAction, deleteSkillAction, updateSkillAction } from "./actions";
import { Disclosure, FactStatusField, SelectField, TextField } from "./fields";
import { DeleteButton, VerifyButton } from "./item-controls";
import { StickyForm, StickySubmit } from "./sticky-form";

const CATEGORY_OPTIONS = SKILL_CATEGORIES.map((value) => ({ value, label: SKILL_CATEGORY_LABELS[value] }));
const GROUP_TITLES = { skill: "Skills", tool: "Tools", domain: "Domains" } as const;

function SkillRow({ skill }: { skill: Skill }) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium break-words">{skill.name}</span>
        <div className="flex flex-wrap items-center gap-2">
          <FactBadge status={skill.factStatus} />
          <VerifyButton kind="skill" id={skill.id} status={skill.factStatus} />
        </div>
      </div>
      <Disclosure summary="Edit" className="mt-1">
        <StickyForm action={updateSkillAction} className="grid gap-3">
          <input type="hidden" name="id" value={skill.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Name" name="name" defaultValue={skill.name} required />
            <SelectField label="Kind" name="category" defaultValue={skill.category} options={CATEGORY_OPTIONS} />
            <FactStatusField defaultValue={skill.factStatus} />
          </div>
          <div>
            <StickySubmit size="sm">Save</StickySubmit>
          </div>
        </StickyForm>
        <div className="mt-3">
          <DeleteButton action={deleteSkillAction} id={skill.id} confirm={`Delete ${skill.name}?`} />
        </div>
      </Disclosure>
    </li>
  );
}

export function SkillsCard({ skills }: { skills: Skill[] }) {
  const groups = SKILL_CATEGORIES.map((category) => ({ category, items: skills.filter((s) => s.category === category) })).filter((g) => g.items.length);
  return (
    <Card title="Skills and tools" description="Only list what you can back up. Duplicates are ignored.">
      {groups.length ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {groups.map((group) => (
            <section key={group.category} className="min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground">{GROUP_TITLES[group.category]}</h3>
              <ul className="divide-y divide-border">
                {group.items.map((skill) => (
                  <SkillRow key={skill.id} skill={skill} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No skills yet.</p>
      )}
      <StickyForm action={addSkillAction} className="mt-4 border-t border-border pt-4" resetOnSuccess>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
          <TextField label="Add a skill" name="name" placeholder="Stakeholder management" required />
          <SelectField label="Kind" name="category" defaultValue="skill" options={CATEGORY_OPTIONS} />
          <FactStatusField />
          <div className="sm:pt-6">
            <StickySubmit>Add</StickySubmit>
          </div>
        </div>
      </StickyForm>
    </Card>
  );
}
