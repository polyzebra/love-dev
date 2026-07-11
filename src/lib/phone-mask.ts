/**
 * Mask a verified number for display: keep the dial code and the last
 * three digits, hide the rest. "+353861234333" -> "+353 ••• ••• 333".
 * Shared by the settings sign-in-methods page and the admin user panel -
 * only the masked string should reach non-ADMIN eyes.
 */
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
