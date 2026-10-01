/** Link to the practice page with a question (and optionally its competency and job) filled in. */
export function practiceHref(question: string, options: { competency?: string | null; jobId?: string | null } = {}) {
  const params = new URLSearchParams({ q: question });
  if (options.competency) params.set("competency", options.competency);
  if (options.jobId) params.set("job", options.jobId);
  return `/interview/practice?${params}`;
}
