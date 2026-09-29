import Link from "next/link";
import { Badge, Card, EmptyState, FactBadge } from "@/components/ui";
import type { Role } from "@/lib/ai/library";
import { EMPLOYMENT_TYPES, formatRange } from "@/lib/career/labels";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "./actions";
import { CheckboxField, Disclosure, FactStatusField, SelectField, TextArea, TextField } from "./fields";
import { DeleteButton, VerifyButton } from "./item-controls";
import { StickyForm, StickySubmit } from "./sticky-form";

const TYPE_OPTIONS = [{ value: "", label: "Not set" }, ...EMPLOYMENT_TYPES.map((value) => ({ value, label: value }))];

function RoleFields({ role }: { role?: Role }) {
  const typeOptions = role?.employmentType && !EMPLOYMENT_TYPES.some((t) => t === role.employmentType) ? [...TYPE_OPTIONS, { value: role.employmentType, label: role.employmentType }] : TYPE_OPTIONS;
  return (
    <div className="grid gap-3">
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Employer" name="employer" defaultValue={role?.employer} required />
        <TextField label="Exact title" name="title" defaultValue={role?.title} required hint="As it appeared, not upgraded." />
        <TextField label="Start" name="start" defaultValue={role?.start} placeholder="2021-03" hint="YYYY-MM or YYYY" />
        <TextField label="End" name="end" defaultValue={role?.end} placeholder="2023-08" hint="Leave blank if current." />
      </div>
      <CheckboxField label="I work here now" name="isCurrent" defaultChecked={role?.isCurrent ?? false} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Location" name="location" defaultValue={role?.location} placeholder="Tampa, FL or Remote" />
        <SelectField label="Employment type" name="employmentType" defaultValue={role?.employmentType ?? ""} options={typeOptions} />
      </div>
      <TextArea label="Summary" name="summary" rows={2} defaultValue={role?.summary} placeholder="One or two plain sentences about the role." />
      <CheckboxField
        label="SaaS company"
        name="isSaas"
        defaultChecked={role?.isSaas ?? false}
        hint="Only roles marked SaaS let a resume claim SaaS experience."
      />
      <FactStatusField defaultValue={role?.factStatus ?? "verified"} className="sm:max-w-xs" />
    </div>
  );
}

function RoleItem({ role, achievementCount }: { role: Role; achievementCount: number }) {
  const dates = formatRange(role.start, role.end, role.isCurrent);
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{role.title}</p>
          <p className="text-sm break-words text-muted-foreground">{[role.employer, dates, role.location, role.employmentType].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role.isSaas ? <Badge tone="info">SaaS</Badge> : null}
          <FactBadge status={role.factStatus} />
          <VerifyButton kind="role" id={role.id} status={role.factStatus} />
        </div>
      </div>
      {role.summary ? <p className="mt-2 text-sm">{role.summary}</p> : null}
      <p className="mt-2 text-sm">
        <Link href={`/achievements?role=${role.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
          {achievementCount === 1 ? "1 achievement" : `${achievementCount} achievements`}
        </Link>
      </p>
      <Disclosure summary="Edit" className="mt-2">
        <StickyForm action={updateRoleAction} className="grid gap-3">
          <RoleFields role={role} />
          <div>
            <StickySubmit>Save role</StickySubmit>
          </div>
        </StickyForm>
        <div className="mt-3 border-t border-border pt-3">
          <DeleteButton action={deleteRoleAction} id={role.id} label="Delete role" confirm={`Delete ${role.title} at ${role.employer}? Its achievements stay, without a role.`} />
        </div>
      </Disclosure>
    </li>
  );
}

export function RolesCard({ roles, achievementCounts }: { roles: Role[]; achievementCounts: Map<string, number> }) {
  return (
    <Card title="Roles" description="Every job, exactly as titled. Achievements hang off these.">
      {roles.length ? (
        <ul className="grid gap-3">
          {roles.map((role) => (
            <RoleItem key={role.id} role={role} achievementCount={achievementCounts.get(role.id) ?? 0} />
          ))}
        </ul>
      ) : (
        <EmptyState title="No roles yet">Add your jobs below, or import a resume to fill them in.</EmptyState>
      )}
      <Disclosure summary="Add a role" open={!roles.length} className="mt-4 border-t border-border pt-4">
        <StickyForm action={createRoleAction} className="grid gap-3" resetOnSuccess>
          <RoleFields />
          <div>
            <StickySubmit>Add role</StickySubmit>
          </div>
        </StickyForm>
      </Disclosure>
    </Card>
  );
}
