import { redirect } from "next/navigation";

/**
 * /settings/security is an alias in the route map - the real page lives
 * at /settings/sign-in-methods.
 */
export default function SecuritySettingsPage() {
  redirect("/settings/sign-in-methods");
}
