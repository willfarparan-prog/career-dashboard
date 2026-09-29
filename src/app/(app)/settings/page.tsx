import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Notice, PageHeader, buttonClass } from "@/components/ui";
import { requireDatabase } from "@/db";
import { DEFAULT_MODEL, configuredModel, dailyBudgetUsd } from "@/lib/ai/models";
import { aiConfigured, fakeMode } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { formatUsd } from "@/lib/overview/format";
import { spendSummary } from "@/lib/overview/spend";
import { countStoredImportText, getPrivacySettings } from "@/lib/settings/privacy";
import { clearImportTextAction, deleteEverythingAction, savePrivacyAction } from "./actions";

export const metadata = { title: "Settings" };

function Toggle({ name, label, description, defaultChecked }: { name: string; label: string; description: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/60">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  const { userId } = await requireViewer();
  const db = requireDatabase();
  const [privacy, storedImports, spend] = await Promise.all([getPrivacySettings(db, userId), countStoredImportText(db, userId), spendSummary(db, userId)]);

  const fake = fakeMode();
  const connected = aiConfigured();
  const model = configuredModel();
  const budget = dailyBudgetUsd();

  return (
    <>
      <PageHeader title="Settings" description="Privacy, your Claude connection, and your data." />

      <div className="space-y-6">
        <Card title="Privacy" description="What Claude sees and what this app keeps.">
          <ActionForm action={savePrivacyAction} className="space-y-3">
            <Toggle
              name="sendPrivateToClaude"
              label="Send private facts to Claude"
              description="Off: anything you mark Private stays out of every Claude request. On: Claude can see it, but it still won't appear on a resume unless you approve it."
              defaultChecked={privacy.sendPrivateToClaude}
            />
            <Toggle
              name="keepImportText"
              label="Keep imported resume text"
              description="Off: the original text of an imported resume is deleted after you review the import. On: it's kept so you can look back at it."
              defaultChecked={privacy.keepImportText}
            />
            <SubmitButton pending="Saving…">Save privacy settings</SubmitButton>
          </ActionForm>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="min-w-0 text-sm text-muted-foreground">
              {storedImports
                ? `${storedImports} ${storedImports === 1 ? "import still has" : "imports still have"} the original resume text stored.`
                : "No imported resume text is stored."}
            </p>
            <ActionForm action={clearImportTextAction}>
              <SubmitButton variant="secondary" size="sm" pending="Clearing…" confirm="Delete the stored text of every import? What you already reviewed stays in your library.">
                Clear stored import text now
              </SubmitButton>
            </ActionForm>
          </div>
        </Card>

        <Card
          title="Claude"
          actions={fake ? <Badge tone="warn">Fake mode</Badge> : connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="bad">Not connected</Badge>}
        >
          {fake ? (
            <Notice tone="warn">Fake mode is on (AI_FAKE=1): Claude returns canned answers and nothing is billed. It only works in local development.</Notice>
          ) : !connected ? (
            <Notice tone="bad">Claude isn&apos;t connected yet, so importing, analyzing and drafting won&apos;t work.</Notice>
          ) : null}

          <dl className="mt-3 divide-y divide-border">
            <Row label="Model">
              <span className="font-mono text-xs">{model}</span>
              {model === DEFAULT_MODEL ? <span className="font-normal text-muted-foreground"> (default)</span> : null}
            </Row>
            <Row label="Daily budget">
              {formatUsd(budget)} <span className="font-normal text-muted-foreground">· {formatUsd(spend.today)} used today</span>
            </Row>
          </dl>

          <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">To connect Claude or change these</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                In Vercel, open this project → <span className="text-foreground">Settings → Environment Variables</span>.
              </li>
              <li>
                Add <code className="font-mono text-xs text-foreground">ANTHROPIC_API_KEY</code> (from the Anthropic Console). Optional:{" "}
                <code className="font-mono text-xs text-foreground">CLAUDE_MODEL</code> (e.g. claude-sonnet-5-5 costs about half) and{" "}
                <code className="font-mono text-xs text-foreground">AI_DAILY_BUDGET_USD</code> (default 5).
              </li>
              <li>Redeploy so the new values take effect.</li>
            </ol>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Anthropic doesn&apos;t use API data to train its models by default. Review how long your data is retained in the Anthropic Console under your
            organization&apos;s privacy settings.
          </p>
        </Card>

        <Card title="Your data">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-muted-foreground">Download everything this app stores for you as one JSON file, including the saved copies of every application.</p>
            <a href="/api/data-export" download className={buttonClass("secondary")}>
              Export everything
            </a>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-bad">Delete everything</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently deletes your profile, library, jobs, drafts, cover letters, applications, saved copies and Claude history. Your sign-in stays. This
              can&apos;t be undone, so export first if you might want it.
            </p>
            <ActionForm action={deleteEverythingAction} className="mt-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="field w-full max-w-xs">
                  <span>Type DELETE to confirm</span>
                  <input className="input" name="confirm" autoComplete="off" spellCheck={false} placeholder="DELETE" pattern="DELETE" required />
                </label>
                <SubmitButton variant="danger" pending="Deleting…" confirm="Delete everything? This can't be undone.">
                  Delete everything
                </SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
