import { Card, FactBadge } from "@/components/ui";
import type { Credential } from "@/lib/ai/library";
import { CREDENTIAL_KINDS, CREDENTIAL_KIND_LABELS } from "@/lib/career/labels";
import { createCredentialAction, deleteCredentialAction, updateCredentialAction } from "./actions";
import { Disclosure, FactStatusField, SelectField, TextField } from "./fields";
import { DeleteButton, VerifyButton } from "./item-controls";
import { StickyForm, StickySubmit } from "./sticky-form";

const KIND_OPTIONS = CREDENTIAL_KINDS.map((value) => ({ value, label: CREDENTIAL_KIND_LABELS[value] }));

function CredentialFields({ credential }: { credential?: Credential }) {
  return (
    <div className="grid gap-3">
      {credential ? <input type="hidden" name="id" value={credential.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Type" name="kind" defaultValue={credential?.kind ?? "education"} options={KIND_OPTIONS} />
        <TextField label="Name" name="name" defaultValue={credential?.name} placeholder="B.S. Exercise Science" required />
        <TextField label="Issuer" name="issuer" defaultValue={credential?.issuer} placeholder="School or organization" />
        <TextField label="Date" name="date" defaultValue={credential?.date} placeholder="2018" />
      </div>
      <TextField label="Detail" name="detail" defaultValue={credential?.detail} placeholder="Honors, focus, license number…" />
      <FactStatusField defaultValue={credential?.factStatus ?? "verified"} className="sm:max-w-xs" />
    </div>
  );
}

export function CredentialsCard({ credentials }: { credentials: Credential[] }) {
  return (
    <Card title="Education, certifications and awards">
      {credentials.length ? (
        <ul className="grid gap-3">
          {credentials.map((credential) => (
            <li key={credential.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{credential.name}</p>
                  <p className="text-sm break-words text-muted-foreground">
                    {[CREDENTIAL_KIND_LABELS[credential.kind], credential.issuer, credential.date].filter(Boolean).join(" · ")}
                  </p>
                  {credential.detail ? <p className="mt-1 text-sm">{credential.detail}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FactBadge status={credential.factStatus} />
                  <VerifyButton kind="credential" id={credential.id} status={credential.factStatus} />
                </div>
              </div>
              <Disclosure summary="Edit" className="mt-2">
                <StickyForm action={updateCredentialAction} className="grid gap-3">
                  <CredentialFields credential={credential} />
                  <div>
                    <StickySubmit>Save</StickySubmit>
                  </div>
                </StickyForm>
                <div className="mt-3 border-t border-border pt-3">
                  <DeleteButton action={deleteCredentialAction} id={credential.id} confirm={`Delete ${credential.name}?`} />
                </div>
              </Disclosure>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      )}
      <Disclosure summary="Add education, a certification or an award" className="mt-4 border-t border-border pt-4">
        <StickyForm action={createCredentialAction} className="grid gap-3" resetOnSuccess>
          <CredentialFields />
          <div>
            <StickySubmit>Add</StickySubmit>
          </div>
        </StickyForm>
      </Disclosure>
    </Card>
  );
}
