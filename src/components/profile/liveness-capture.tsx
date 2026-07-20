"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LIVENESS_COPY, type LivenessCaptureState } from "@/lib/verification-presentation";
import dynamic from "next/dynamic";
import { LEGAL_ROUTES } from "@/lib/legal/routes";

// Heavy AWS Amplify SDK: dynamically imported so it never ships to other
// routes (TASK 4). Mounted only during an active capture.
const LivenessDetector = dynamic(
  () => import("@/components/profile/liveness-detector").then((m) => m.LivenessDetector),
  { ssr: false },
);

/**
 * Video-selfie liveness capture (Phase 23). Loaded via next/dynamic from
 * the verification card ONLY, so no biometric-capture code ships to
 * unrelated routes.
 *
 * PRIVACY: the capture stream is handed to the provider SDK; nothing is
 * written to localStorage / sessionStorage / IndexedDB / service-worker
 * caches, nothing is sent to analytics, and no frames pass through
 * Tirvea's servers. Only an opaque flowId lives in component state - it
 * is never written to the URL, storage, history or analytics (C-1).
 *
 * Vendor SDK integration (TASK 1) - NO Cognito. Documented drop-in
 * (needs `npm i @aws-amplify/ui-react-liveness aws-amplify` + a real human
 * capture to test - unavailable in CI). Mount FaceLivenessDetectorCore
 * with a credentialProvider fed by our OWNER-SCOPED capture handle, which
 * returns short-lived STS AssumeRole credentials (Supabase stays the only
 * auth provider; AWS creds are minted server-side, scoped to
 * StartFaceLivenessSession, and issued per-capture to the flow owner):
 *
 *   const { FaceLivenessDetectorCore } = await import("@aws-amplify/ui-react-liveness");
 *   const h = (await fetch(`/api/verification/liveness/${flowId}/capture`).then(r=>r.json())).data;
 *   <FaceLivenessDetectorCore
 *     sessionId={h.sessionId}
 *     region={h.region}
 *     config={{ credentialProvider: async () => ({
 *       accessKeyId: h.credentials.accessKeyId,
 *       secretAccessKey: h.credentials.secretAccessKey,
 *       sessionToken: h.credentials.sessionToken,
 *       expiration: new Date(h.credentials.expiration),
 *     }) }}
 *     onAnalysisComplete={async () => setState("liveness_processing")}
 *     onError={() => setState("capture_failed")} />
 *
 * The sessionId + STS creds are transient (capture stream only), never
 * placed in URL/storage/logs, and confer no authority - result
 * consumption stays flowId-bound. Until the detector mounts, this renders
 * the full state machine + capture handoff so states, a11y, consent,
 * retry and degradation stay exercisable.
 */
export function LivenessCapture({
  consentVersion,
  onDone,
  startLabel,
}: {
  consentVersion: string;
  onDone?: () => void;
  /** Label for the consent+start button (defaults to "Agree & start"). The
   *  /auth/liveness entry page passes "Start Face Verification" (Phase C/M). */
  startLabel?: string;
}) {
  const router = useRouter();
  // No session/flow id is ever placed in the URL, storage or history
  // (C-1 req 8). The opaque flowId lives only in component state; a
  // refresh restarts the flow rather than leaking an identifier.
  const [state, setState] = useState<LivenessCaptureState>("consent_required");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the session while it is in flight. Cleared on unmount.
  useEffect(() => {
    if (!flowId || (state !== "liveness_processing" && state !== "capture_submitted")) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/verification/liveness/${flowId}`);
        if (!res.ok) {
          if (alive) setState("provider_unavailable");
          return;
        }
        const body = (await res.json()) as { data?: { state?: string } };
        if (!alive) return;
        const next = body.data?.state;
        if (next === "checking_profile_photos") {
          onDone?.();
          router.refresh();
        } else if (next === "session_not_found") {
          setState("capture_failed");
        } else if (next === "capture_failed") {
          setState("capture_failed");
        } else if (next === "provider_unavailable") {
          setState("provider_unavailable");
        }
      } catch {
        if (alive) setState("provider_unavailable");
      }
    };
    pollRef.current = setInterval(poll, 3000);
    void poll();
    return () => {
      alive = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [flowId, state, router, onDone]);

  async function startCapture() {
    setBusy(true);
    try {
      // Camera permission first - explicit guidance beats a silent failure.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop()); // provider SDK reopens it
      } catch {
        setState("camera_permission_required");
        return;
      }
      const res = await fetch("/api/verification/liveness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consentVersion }),
      });
      if (res.status === 503) {
        setState("provider_unavailable");
        return;
      }
      if (!res.ok) {
        setState("capture_failed");
        return;
      }
      const body = (await res.json()) as { data: { flowId: string } };
      setFlowId(body.data.flowId);
      setState("capture_submitted");
    } finally {
      setBusy(false);
    }
  }

  const copy = LIVENESS_COPY[state];
  const canStart =
    state === "consent_required" ||
    state === "capture_ready" ||
    state === "capture_failed" ||
    state === "camera_permission_required";

  return (
    <div ref={liveRef} role="status" aria-live="polite" className="glass rounded-3xl p-5">
      <div className="flex items-start gap-3.5">
        <span className="glass-chip flex size-11 shrink-0 items-center justify-center rounded-full">
          <Camera className="text-gold size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-medium tracking-tight">{copy.title}</p>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{copy.body}</p>

          {flowId && (state === "capture_submitted" || state === "liveness_processing") && (
            <div className="mt-3">
              <LivenessDetector
                flowId={flowId}
                onComplete={() => setState("liveness_processing")}
                onFailed={() => setState("capture_failed")}
                onUnavailable={() => setState("provider_unavailable")}
              />
            </div>
          )}

          {state === "consent_required" && (
            <div className="bg-foreground/5 text-muted-foreground mt-3 flex items-start gap-3 rounded-2xl p-4 text-sm leading-relaxed">
              <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Your video selfie is captured and checked by our verification partner (AWS) in the
                EU. From it, a{" "}
                <span className="text-foreground font-medium">
                  face reference is created and stored by our partner
                </span>{" "}
                so we can confirm your profile photos are you - now and when you add new ones.
                Tirvea itself never holds your face images, video or biometric templates; we store
                only an opaque reference. The reference is kept while your verification is valid
                (see the{" "}
                <a href={LEGAL_ROUTES.biometricData} className="underline">
                  Biometric data notice
                </a>
                ) and deleted when you withdraw consent or delete your account. By continuing you
                give explicit consent to this biometric check.
                {/* [PLACEHOLDER - exact retention period + audit-image behavior pending counsel/DPIA] */}
              </p>
            </div>
          )}

          {canStart && (
            <Button
              size="sm"
              className="mt-4 rounded-full px-5"
              disabled={busy}
              onClick={startCapture}
            >
              {state === "capture_failed" || state === "camera_permission_required" ? (
                <>
                  <RefreshCw className="size-4" aria-hidden="true" /> Try again
                </>
              ) : state === "consent_required" ? (
                (startLabel ?? "Agree & start")
              ) : (
                "Start check"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
