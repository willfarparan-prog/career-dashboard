/** Opens the local PGlite sandbox when running `next dev` with CAREER_LOCAL_DB. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development" || !process.env.CAREER_LOCAL_DB) return;
  const [{ openSandbox }, { setSandboxDatabase }] = await Promise.all([import("./db/sandbox"), import("./db")]);
  const { db } = await openSandbox(process.env.CAREER_LOCAL_DB);
  setSandboxDatabase(db);
  console.log(`[career] Using the local sandbox database at ${process.env.CAREER_LOCAL_DB} (Neon is untouched)`);
}
