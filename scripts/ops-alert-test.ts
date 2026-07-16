/**
 * ops:alert-test - DRY-RUN the external operational alert channel.
 *
 *   npm run ops:alert-test [-- "a note"]
 *
 * Sends ONE synthetic alert through the external channel only (the same
 * ALERT_WEBHOOK_URL path production alerts use) - no admin outbox, no audit.
 * Reports whether a channel is configured and whether it accepted the
 * message. Never crashes; a delivery failure is reported, not thrown.
 */
import "dotenv/config";

async function main() {
  const note = process.argv.slice(2).join(" ") || "cli dry-run";
  const { sendTestOpsAlert } = await import("../src/lib/services/provider-resilience");
  const r = await sendTestOpsAlert(note);

  console.log(JSON.stringify({ channelConfigured: r.channelConfigured, delivered: r.delivered }));
  if (!r.channelConfigured) {
    console.log("No external channel configured (set ALERT_WEBHOOK_URL). Nothing was sent.");
  } else if (r.delivered) {
    console.log("Delivered a test alert to the external ops channel.");
  } else {
    console.log("Channel configured but delivery FAILED (check the webhook URL / network).");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`ops:alert-test crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
