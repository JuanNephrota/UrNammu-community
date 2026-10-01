/**
 * Who may sign in through an SSO provider, and who bootstraps the first ADMIN.
 *
 * Both decisions are pure so they can be unit-tested; auth.ts supplies the
 * database facts (does the account exist, is there an active admin yet).
 */

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function allowedSignInDomains(env: Record<string, string | undefined> = process.env): string[] {
  return parseList(env.ALLOWED_SIGN_IN_DOMAINS);
}

export function initialAdminEmail(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  return value || null;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export type SsoSignInDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Existing accounts are governed by their status alone, so turning the
 * allowlist on never locks out someone an admin already provisioned. A *new*
 * account is created only for an allowlisted domain (or the bootstrap admin);
 * with no allowlist configured in production, none are created at all.
 */
export function decideSsoSignIn(input: {
  provider: string;
  email: string;
  emailVerified: boolean | undefined;
  accountExists: boolean;
  isProduction: boolean;
  allowedDomains: string[];
  initialAdmin: string | null;
}): SsoSignInDecision {
  const email = input.email.toLowerCase();

  // Google asserts email_verified; an unverified address must never be trusted
  // to match an allowlisted domain. Entra has no such claim on the ID token.
  if (input.provider === "google" && input.emailVerified === false) {
    return { allowed: false, reason: "unverified-email" };
  }

  if (input.accountExists) return { allowed: true };
  if (input.initialAdmin && email === input.initialAdmin) return { allowed: true };

  if (input.allowedDomains.length > 0) {
    return input.allowedDomains.includes(emailDomain(email))
      ? { allowed: true }
      : { allowed: false, reason: "domain-not-allowed" };
  }

  // No allowlist: keep the open behaviour outside production (local dev, demo
  // seeds) but refuse to mint accounts for arbitrary strangers in production.
  return input.isProduction
    ? { allowed: false, reason: "no-allowlist-configured" }
    : { allowed: true };
}

/** The bootstrap admin is promoted only while no active ADMIN exists. */
export function shouldPromoteInitialAdmin(input: {
  email: string;
  initialAdmin: string | null;
  activeAdminCount: number;
}): boolean {
  return (
    input.initialAdmin !== null &&
    input.email.toLowerCase() === input.initialAdmin &&
    input.activeAdminCount === 0
  );
}
