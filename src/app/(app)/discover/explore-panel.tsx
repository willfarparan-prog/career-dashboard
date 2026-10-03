import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice } from "@/components/ui";
import type { CareerDirection, FitReview } from "@/lib/discover/explore-types";
import { suggestDirectionsAction } from "./actions";
import { SearchForm, type SourceOption } from "./search-form";

export function EvidenceLinks({ achievementIds, roleIds }: { achievementIds: string[]; roleIds: string[] }) {
  return <span className="inline-flex flex-wrap gap-2">
    {achievementIds.map((id, i) => <Link key={id} href={`/achievements/${id}`} className="text-primary underline">Achievement {i + 1}</Link>)}
    {roleIds.length ? <Link href="/profile" className="text-primary underline">Career roles</Link> : null}
  </span>;
}

export function ExplorePanel({ directions, stale, minimum, location, sources, ai, hasExperience }: {
  directions: CareerDirection[]; stale: boolean; minimum: number | null; location: string; sources: SourceOption[]; ai: boolean; hasExperience: boolean;
}) {
  return <Card title="Explore other careers" description="Find a different kind of desk-based work using the experience you already have.">
    <div className="space-y-3 text-sm">
      <p>Office, hybrid or remote · No quota-driven sales or hands-on coaching · Short upskilling first, open to less than eight months · Future pay and advancement</p>
      <p>{minimum ? `Your minimum: $${minimum.toLocaleString("en-US")} per year.` : "Set your minimum pay to filter out clearly underpaid postings."} <Link href="/profile" className="text-primary underline">Edit pay and location preferences</Link></p>
      <p className="text-xs text-muted-foreground">Explore searches run only when you press Refresh Explore. Suggestions and fit reviews use Claude and count toward your daily AI budget.</p>
      {!hasExperience ? <Notice tone="warn">Add a <Link href="/profile" className="underline">role</Link> or <Link href="/achievements" className="underline">achievement</Link> before requesting personalized directions.</Notice> : ai ? (
        <ActionForm action={suggestDirectionsAction}><SubmitButton pending="Finding career directions…">{directions.length ? "Suggest fresh career directions" : "Suggest career directions"}</SubmitButton></ActionForm>
      ) : <Notice tone="warn">Claude is unavailable. Existing suggestions and saved searches remain available.</Notice>}
      {stale ? <Notice tone="warn">Your library or preferences changed. These suggestions may be outdated; request fresh directions before relying on them.</Notice> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {directions.map((direction) => <article key={direction.query} className="min-w-0 space-y-2 break-words rounded-md border border-border p-3">
          <h3 className="font-semibold">{direction.title}</h3>
          <p>{direction.work}</p><p className="text-muted-foreground">{direction.difference}</p>
          <h4 className="font-semibold">Experience to build on</h4>
          <ul className="list-disc space-y-1 pl-4">{direction.strengths.map((s, i) => <li key={i}>{s.text} <EvidenceLinks {...s} /></li>)}</ul>
          <p><strong>Gaps:</strong> {direction.gaps.join(" · ") || "Verify the requirements in each posting."}</p>
          <p><strong>Tentative preparation:</strong> {direction.trainingMonths == null ? "Time unknown. " : `About ${direction.trainingMonths} months. `}{direction.preparation}</p>
          <p><strong>Possible progression to research:</strong> {direction.progression}</p>
          <p className="text-xs text-muted-foreground">Pay and advancement depend on the actual job. This is a direction to explore, not a qualification or salary guarantee.</p>
          <details><summary className="cursor-pointer font-semibold text-primary">Add search — review first</summary>
            <div className="mt-3"><SearchForm mode="explore" sources={sources} defaults={{ query: direction.query, location, terms: direction.terms }} /></div>
          </details>
        </article>)}
      </div>
    </div>
  </Card>;
}

export function FitReviewDetails({ review, stale }: { review: FitReview; stale: boolean }) {
  return <details className="mt-2 break-words rounded-md border border-border p-3 text-xs">
    <summary className="cursor-pointer font-semibold text-primary">Your fit review{stale ? " — outdated" : ""}</summary>
    <div className="mt-2 space-y-2">
      {stale ? <Notice tone="warn">The posting, your library, or preferences changed. Run Check my fit again before relying on this review.</Notice> : null}
      <p>{review.summary}</p>
      <h4 className="font-semibold">Transferable strengths</h4>
      {review.strengths.length ? <ul className="list-disc space-y-2 pl-4">{review.strengths.map((s, i) => <li key={i}>{s.text} <EvidenceLinks {...s} /><blockquote className="mt-1 border-l-2 border-border pl-2">{s.postingQuote}</blockquote></li>)}</ul> : <p>No sufficiently supported strengths established in this review.</p>}
      <h4 className="font-semibold">Gaps to check</h4>
      {review.gaps.length ? <ul className="list-disc pl-4">{review.gaps.map((g, i) => <li key={i}>{g.text}<blockquote className="border-l-2 border-border pl-2">{g.postingQuote}</blockquote></li>)}</ul> : <p>No quoted gaps established; this does not confirm eligibility.</p>}
      <p><strong>Tentative preparation:</strong> {review.trainingMonths == null ? "Time unknown. " : `About ${review.trainingMonths} months. `}{review.preparation}</p>
      {review.trainingMonths != null && review.trainingMonths >= 8 ? <Notice tone="warn">This estimate exceeds your preference for less than eight months of preparation.</Notice> : null}
      <p><strong>Work type ({review.workType.assessment}):</strong> {review.workType.explanation}</p>
      {review.workType.postingQuote ? <blockquote className="border-l-2 border-border pl-2">{review.workType.postingQuote}</blockquote> : null}
      <h4 className="font-semibold">Advancement signals in this posting</h4>
      {review.growthSignals.length ? review.growthSignals.map((g, i) => <p key={i}>{g.text}<q className="block pl-2">{g.postingQuote}</q></p>) : <p>Employer advancement and future pay are unconfirmed.</p>}
      <p><strong>Possible career progression, separate from this employer:</strong> {review.careerPossibilities}</p>
      <h4 className="font-semibold">Still unknown</h4><ul className="list-disc pl-4">{review.unknowns.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  </details>;
}
