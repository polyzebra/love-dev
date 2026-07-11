import { redirect } from "next/navigation";

/** Alias - the violations live on the account status page. */
export default function AccountViolationsPage() {
  redirect("/account/status");
}
