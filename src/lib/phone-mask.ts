/**
 * Mask a verified number for display: keep the dial code and the last
 * three digits, hide the rest. "+353861234333" -> "+353 ••• ••• 333".
 * Shared by the settings sign-in-methods page and the admin user panel -
 * only the masked string should reach non-ADMIN eyes.
 */
/**
 * Mask an email for display: first two local characters + domain.
 * "info@tirvea.com" -> "in••@tirvea.com". Same display-only purpose as
 * maskPhone; used by the admin auth-diagnostics page.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}${"•".repeat(Math.max(1, local.length - keep.length))}${email.slice(at)}`;
}

export function maskPhone(e164: string, dialCode: string | null): string {
  const dial = dialCode && e164.startsWith(dialCode) ? dialCode : e164.slice(0, 4);
  const national = e164.slice(dial.length);
  if (national.length <= 3) return `${dial} ${national}`;
  const masked = "•".repeat(national.length - 3) + national.slice(-3);
  const groups: string[] = [];
  for (let end = masked.length; end > 0; end -= 3) {
    groups.unshift(masked.slice(Math.max(0, end - 3), end));
  }
  return `${dial} ${groups.join(" ")}`;
}
