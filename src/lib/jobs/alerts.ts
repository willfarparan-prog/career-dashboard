import type { ApplicationStatus } from "@/db/schema";
import { todayIso } from "@/lib/applications/dates";
import { jobCompany, jobTitle, normalizeText, type PostingStatus } from "./format";

/*
 * Alerts are hints, not blockers: a possible duplicate, a posting that may
 * have gone stale, or one the owner marked closed. Pure so they're testable.
 */

export const STALE_AFTER_DAYS = 45;

/** An application at or past this point means the owner already applied. */
const APPLIED: ApplicationStatus[] = ["applied", "interview", "offer", "rejected"];
/** Staleness only matters before the owner applies. */
const NOT_YET_APPLIED: ApplicationStatus[] = ["saved", "drafting", "ready"];

export type AlertJob = {
  id: string;
  company: string;
  title: string;
  requisitionId: string;
  deadline: string;
  capturedAt: Date;
  postingStatus: PostingStatus;
  applicationStatus: ApplicationStatus | null;
};

export type JobAlert = {
  kind: "duplicate" | "stale" | "closed";
  /** Short badge text. */
  label: string;
  message: string;
  relatedJobId?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function companyTitleKey(job: Pick<AlertJob, "company" | "title">) {
  const company = normalizeText(job.company);
  const title = normalizeText(job.title);
  return company && title ? `${company}|${title}` : "";
}

const describe = (job: AlertJob) => `${jobTitle(job)} at ${jobCompany(job)}`;

export function jobAlerts(job: AlertJob, allJobs: AlertJob[], now = new Date()): JobAlert[] {
  const alerts: JobAlert[] = [];
  const others = allJobs.filter((other) => other.id !== job.id);

  const req = job.requisitionId.trim().toLowerCase();
  const sameReq = req ? others.find((other) => other.requisitionId.trim().toLowerCase() === req) : undefined;
  if (sameReq) {
    alerts.push({ kind: "duplicate", label: "Possible duplicate", message: `Same requisition ID as ${describe(sameReq)}.`, relatedJobId: sameReq.id });
  } else {
    const key = companyTitleKey(job);
    const applied = key ? others.find((other) => other.applicationStatus && APPLIED.includes(other.applicationStatus) && companyTitleKey(other) === key) : undefined;
    if (applied) alerts.push({ kind: "duplicate", label: "Possible duplicate", message: `You already applied to this role (${applied.applicationStatus}).`, relatedJobId: applied.id });
  }

  if (job.postingStatus === "closed") {
    alerts.push({ kind: "closed", label: "Closed", message: "You marked this posting closed." });
    return alerts;
  }
  if (job.postingStatus === "stale") {
    alerts.push({ kind: "stale", label: "Stale", message: "You marked this posting stale." });
    return alerts;
  }

  const beforeApplying = !job.applicationStatus || NOT_YET_APPLIED.includes(job.applicationStatus);
  if (!beforeApplying) return alerts;
  if (job.deadline && job.deadline < todayIso(now)) {
    alerts.push({ kind: "stale", label: "Possibly stale", message: `The deadline (${job.deadline}) has passed.` });
  } else {
    const age = Math.floor((now.getTime() - job.capturedAt.getTime()) / DAY_MS);
    if (age > STALE_AFTER_DAYS) alerts.push({ kind: "stale", label: "Possibly stale", message: `Saved ${age} days ago. Check it's still open.` });
  }
  return alerts;
}
