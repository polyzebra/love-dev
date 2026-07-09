/**
 * Honest, small blocklist of well-known disposable email providers.
 * This is a speed bump, not a fortress - a determined abuser will find
 * an unlisted domain. Callers must respond NEUTRALLY (same 200 as a
 * successful send) so the list is never enumerable from the outside.
 */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "10minemail.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmail.dev",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "mailnesia.com",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "mohmal.com",
  "spamgourmet.com",
  "mytemp.email",
  "burnermail.io",
  "emailondeck.com",
  "moakt.com",
  "tmpmail.org",
  "mail-temp.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop();
  if (!domain) return false;
  // Match the domain and any subdomain of a listed domain
  return (
    DISPOSABLE_DOMAINS.has(domain) ||
    [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`))
  );
}
