/**
 * The one rule that decides who gets in: the configured owner email, and only
 * once the auth provider has verified that the person controls it. Neon Auth
 * accepts unverified sign-ups, so a matching address alone is not enough.
 */
export function isOwner(email: unknown, emailVerified: unknown, ownerEmail: string | undefined): boolean {
  if (typeof email !== "string" || !ownerEmail) return false;
  return emailVerified === true && email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}
