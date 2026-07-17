import type { Metadata } from "next";

export const metadata: Metadata = { title: "System Status" };

export default function StatusPage() {
  return (
    <>
      <h1>System Status</h1>
      <p>
        Live availability and incident history for Tirvea are published on our dedicated status page.
        The full status experience is being finalised.
      </p>
      <p>
        <a href="https://status.tirvea.com">status.tirvea.com</a>
      </p>
    </>
  );
}
