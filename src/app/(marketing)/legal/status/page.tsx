import { redirect } from "next/navigation";

// L4.3 - System Status is not a public page. Tirvea has no public status
// system yet (no incident history, uptime, component monitoring, RSS, or
// subscriptions) and status.tirvea.com does not exist. Rather than expose a
// placeholder or a dead domain, the route is retained but redirects to the
// Legal Centre. When a real status product ships it belongs on a Company/Trust
// surface (e.g. a hosted status page at status.tirvea.com), not in Legal -
// replace this redirect with the real page then.
export default function StatusPage() {
  redirect("/legal");
}
