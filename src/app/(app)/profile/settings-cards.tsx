import { Card } from "@/components/ui";
import type { Profile } from "@/lib/ai/library";
import { FIT_WEIGHT_KEYS, FIT_WEIGHT_LABELS, TARGET_ROLE_OPTIONS } from "@/lib/career/labels";
import { fitWeightsOf } from "@/lib/career/profile";
import { saveContactAction, saveSearchSettingsAction } from "./actions";
import { CheckboxField, SelectField, TextArea, TextField } from "./fields";
import { StickyForm, StickySubmit } from "./sticky-form";

const WEIGHT_OPTIONS = [0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 0 ? "0 – ignore" : n === 5 ? "5 – most" : String(n) }));

export function ContactCard({ profile }: { profile: Profile | null }) {
  return (
    <Card title="Contact details" description="The header of every resume.">
      <StickyForm action={saveContactAction} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Full name" name="fullName" defaultValue={profile?.fullName} autoComplete="name" />
          <TextField label="Headline" name="headline" defaultValue={profile?.headline} placeholder="Coach and program lead" />
          <TextField label="Email" name="email" type="email" defaultValue={profile?.email} autoComplete="email" />
          <TextField label="Phone" name="phone" type="tel" defaultValue={profile?.phone} autoComplete="tel" />
        </div>
        <TextField label="Location" name="location" defaultValue={profile?.location} placeholder="Tampa, FL" />
        <TextArea label="Links" name="links" rows={2} defaultValue={profile?.links.join("\n")} placeholder="linkedin.com/in/you" hint="One per line." />
        <div>
          <StickySubmit>Save contact details</StickySubmit>
        </div>
      </StickyForm>
    </Card>
  );
}

export function SearchCard({ profile }: { profile: Profile | null }) {
  const targets = new Set(profile?.targetRoles ?? ["customer_success", "implementation", "account_management", "employer_wellbeing"]);
  const weights = fitWeightsOf(profile);
  return (
    <Card title="Job search" description="What you're aiming for. Used to rank and tailor.">
      <StickyForm action={saveSearchSettingsAction} className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Target roles</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TARGET_ROLE_OPTIONS.map((option) => (
              <CheckboxField key={option.value} label={option.label} name="targetRoles" value={option.value} defaultChecked={targets.has(option.value)} />
            ))}
          </div>
        </fieldset>
        <TextField label="Target locations" name="targetLocations" defaultValue={profile?.targetLocations.join(", ")} placeholder="San Francisco, Remote, Tampa" hint="Separate with commas." />
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <TextField
            label="Minimum pay"
            name="compMin"
            inputMode="numeric"
            defaultValue={profile?.compMin ?? ""}
            placeholder="85000"
            hint="Yearly, in US dollars."
          />
          <CheckboxField label="Open to remote" name="remoteOk" defaultChecked={profile?.remoteOk ?? true} className="sm:pb-6" />
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">What matters most</legend>
          <p className="text-xs text-muted-foreground">How much each factor counts when ranking jobs.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FIT_WEIGHT_KEYS.map((key) => (
              <SelectField key={key} label={FIT_WEIGHT_LABELS[key]} name={`weight_${key}`} defaultValue={String(weights[key])} options={WEIGHT_OPTIONS} />
            ))}
          </div>
        </fieldset>
        <div>
          <StickySubmit>Save search settings</StickySubmit>
        </div>
      </StickyForm>
    </Card>
  );
}
