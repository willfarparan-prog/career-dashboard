import type { SalaryProvenance } from "@/db/schema";

type Pay = { salaryMin: number | null; salaryMax: number | null; salaryProvenance?: SalaryProvenance; salaryText: string };
export function payEligibility(lead: Pay, minimum: number | null) {
  if (lead.salaryProvenance === "estimated" || /estimate|predicted/i.test(lead.salaryText)) return { excluded: false, label: "Estimated pay — verify with employer" };
  if (lead.salaryProvenance !== "disclosed" || (lead.salaryMin == null && lead.salaryMax == null)) return { excluded: false, label: "Pay unconfirmed — verify with employer" };
  if (!minimum) return { excluded: false, label: "Set your minimum pay" };
  // A minimum-only figure is open-ended, not a ceiling.
  if (lead.salaryMax != null && lead.salaryMax < minimum) return { excluded: true, label: "Disclosed pay below your minimum" };
  if (lead.salaryMin != null && lead.salaryMin >= minimum) return { excluded: false, label: "Disclosed pay meets your minimum" };
  return { excluded: false, label: lead.salaryMax == null ? "Pay ceiling unknown — verify" : "Range reaches your minimum — verify offer" };
}

/** Conservative rules: job duties, not stray mentions of sales teams or staff coaching. */
export function workEligibility(lead: { title: string; description: string }) {
  const title = lead.title.toLowerCase();
  if (/\b(account executive|sales representative|sales development|business development representative|sales consultant|sales agent|sales manager|sales specialist|inside sales|sales associate|sdr|bdr)\b/.test(title)) return { excluded: true, label: "Sales role" };
  if (/\b(personal trainer|fitness instructor|sports coach|athletic coach|strength coach|tennis coach|swim instructor)\b/.test(title)) return { excluded: true, label: "Hands-on coaching role" };
  if (/\b(field technician|field service|construction worker|delivery driver|warehouse|landscaper)\b/.test(title)) return { excluded: true, label: "Field or physical work" };
  const sentences = lead.description.toLowerCase().split(/[.!?\n]+/).filter((s) => !/\b(no|not|without|never)\b/.test(s));
  if (sentences.some((s) => /\b(you will|you must|responsib|meet|achieve|carry|own)\b/.test(s) && /\b(sales quota|sales targets|cold call|cold calling)\b/.test(s))) return { excluded: true, label: "Quota-driven sales duties" };
  if (sentences.some((s) => /\b(you will|you must|required to)\b/.test(s) && /\b(conduct|lead|teach|deliver)\b.{0,40}\b(fitness classes|personal training|sports coaching)\b/.test(s))) return { excluded: true, label: "Hands-on coaching duties" };
  const desk = sentences.some((s) => /\b(desk.based|office.based|computer.based|administrative duties)\b/.test(s));
  return { excluded: false, label: desk ? "Desk-work signal in posting" : "Check work type" };
}

export function exploreEligibility(lead: Pay & { title: string; description: string }, minimum: number | null) {
  const pay = payEligibility(lead, minimum);
  const work = workEligibility(lead);
  return { excluded: pay.excluded || work.excluded, pay: pay.label, work: work.label };
}
