"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LIVENESS_COPY, type LivenessCaptureState } from "@/lib/verification-presentation";
import dynamic from "next/dynamic";
import { LEGAL_ROUTES } from "@/lib/legal/routes";
import { LivenessFullscreen } from "@/components/profile/liveness-fullscreen";

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
}: {
  consentVersion: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  // No session/flow id is ever placed in the URL, storage or history
  // (C-1 req 8). The opaque flowId lives only in component state; a
  // refresh restarts the flow rather than leaking an identifier.
  const [state, setState] = useState<LivenessCaptureState>("consent_required");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Advisory flag: the result is taking longer than usual (still within the
  // hard deadline). Purely cosmetic - the deadline below is what bounds it.
  const [takingLong, setTakingLong] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bounded result processing (L9.4): poll only while the server says PROCESSING,
  // and never spin forever. After ADVISORY_MS show "taking longer"; after
  // DEADLINE_MS stop and show a terminal retry state (result_timeout).
  const POLL_INTERVAL_MS = 3000;
  const ADVISORY_MS = 20_000;
  const DEADLINE_MS = 60_000;

  // Poll the session ONLY once a real capture has completed and analysis is
  // running (liveness_processing). We must NOT poll during capture_submitted:
  // that is the AWS start screen + live capture, and a GetFaceLivenessSessionResults
  // poll against a not-yet-finished session could replace the capture UI with an
  // error card mid-flow. onAnalysisComplete transitions us here when capture ends.
  useEffect(() => {
    if (!flowId || state !== "liveness_processing") return;
    let alive = true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const poll = async () => {
      // Hard terminal deadline: never leave a permanent spinner. An AWS result
      // that is still not ready by DEADLINE_MS ends in a retryable timeout.
      const elapsed = Date.now() - startedAt;
      if (elapsed >= DEADLINE_MS) {
        if (alive) setState("result_timeout");
        return;
      }
      if (elapsed >= ADVISORY_MS && alive) setTakingLong(true);
      try {
        const res = await fetch(`/api/verification/liveness/${flowId}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          if (alive) setState("provider_unavailable");
          return;
        }
        const body = (await res.json()) as { data?: { state?: string } };
        if (!alive) return;
        const next = body.data?.state;
        // Terminal states stop the poll; only "liveness_processing" keeps it going.
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
        // next === "liveness_processing" (or unknown) -> keep polling until the
        // deadline; the elapsed check above guarantees termination.
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (alive) setState("provider_unavailable");
      }
    };
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    void poll();
    return () => {
      alive = false;
      controller.abort(); // cancel any in-flight request from this attempt
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [flowId, state, router, onDone]);

  async function startCapture() {
    setBusy(true);
    // A retry must always begin a FRESH session - drop any stale flowId so the
    // poll effect and detector can never reuse a spent/never-created session.
    setFlowId(null);
    setTakingLong(false);
    try {
      // We do NOT pre-acquire the camera here. FaceLivenessDetectorCore owns
      // camera acquisition + the permission prompt through its own start screen,
      // within a user gesture (the "Begin check" tap) that iOS Safari requires.
      // A pre-probe that grabs then releases the camera detaches that gesture and
      // makes the detector fail on iOS (L9.3). Permission denial now surfaces as
      // the detector's CAMERA_ACCESS_ERROR, mapped to camera_permission_required.
      let res: Response;
      try {
        res = await fetch("/api/verification/liveness", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consentVersion }),
        });
      } catch {
        // The request never reached the server (offline / DNS / CORS). The
        // camera never ran, so this is a NETWORK error, not a liveness failure.
        setState("network_error");
        return;
      }
      // Provider dormant or degraded - the layer answers 503 without touching
      // the user's state.
      if (res.status === 503) {
        setState("provider_unavailable");
        return;
      }
      // ANY other non-ok (409/422/429/5xx) is a start-time failure BEFORE the
      // AWS camera runs. It must NOT read as "lighting or movement"
      // (capture_failed) - that copy is reserved for a real capture attempt.
      if (!res.ok) {
        setState("start_failed");
        return;
      }
      const body = (await res.json()) as { data: { flowId: string } };
      // Defensive: a 200 with no flowId means no AWS session exists to run.
      // Treat it as a start failure, never as a capture (lighting) failure.
      if (!body?.data?.flowId) {
        setState("start_failed");
        return;
      }
      setFlowId(body.data.flowId);
      setState("capture_submitted");
    } finally {
      setBusy(false);
    }
  }

  // Map FaceLivenessDetectorCore's LivenessErrorState to the right client state.
  // "lighting or movement" (capture_failed) is reserved for errors that can only
  // occur AFTER a real capture UI ran; pre-capture errors get their own honest
  // states so a failure right after the permission prompt is never mislabelled.
  function handleDetectorError(errorState: string): void {
    switch (errorState) {
      case "CAMERA_ACCESS_ERROR":
        setState("camera_permission_required");
        return;
      case "DEFAULT_CAMERA_NOT_FOUND_ERROR":
      case "CAMERA_FRAMERATE_ERROR":
        setState("camera_stream_failed");
        return;
      case "SERVER_ERROR":
      case "CONNECTION_TIMEOUT":
        setState("aws_stream_start_failed");
        return;
      // Mid-capture failures - the AWS UI ran and the check couldn't complete.
      // Only here is the "lighting or movement" copy accurate.
      case "TIMEOUT":
      case "FRESHNESS_TIMEOUT":
      case "FACE_DISTANCE_ERROR":
      case "MULTIPLE_FACES_ERROR":
      case "MOBILE_LANDSCAPE_ERROR":
        setState("capture_failed");
        return;
      // RUNTIME_ERROR and anything unrecognised are pre-capture component
      // failures by default - never claim lighting/movement without evidence.
      default:
        setState("liveness_component_failed");
    }
  }

  // Closing the full-screen capture aborts the attempt and returns to the inline
  // card (which restores body scroll + the bottom nav). Retry mints a fresh session.
  function handleClose(): void {
    setState("consent_required");
    setFlowId(null);
    setTakingLong(false);
  }

  const copy = LIVENESS_COPY[state];
  const canStart =
    state === "consent_required" ||
    state === "capture_ready" ||
    state === "capture_failed" ||
    state === "result_timeout" ||
    state === "camera_stream_failed" ||
    state === "liveness_component_failed" ||
    state === "aws_stream_start_failed" ||
    state === "start_failed" ||
    state === "network_error" ||
    state === "camera_permission_required";

  // Active capture (get-ready + camera + processing) renders in a focused
  // full-screen layer on all devices so the AWS UI never overlaps the bottom
  // nav or the iPhone status bar; other states stay as the inline card.
  const isFullscreen = state === "capture_submitted" || state === "liveness_processing";
  const inner = (
    <div
      ref={liveRef}
      role="status"
      aria-live="polite"
      className={isFullscreen ? "outline-none" : "glass rounded-3xl p-5"}
    >
      <div className="flex items-start gap-3.5">
        <span className="glass-chip flex size-11 shrink-0 items-center justify-center rounded-full">
          <Camera className="text-gold size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-medium tracking-tight">{copy.title}</p>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{copy.body}</p>
          {takingLong && state === "liveness_processing" && (
            <p className="text-muted-foreground/80 mt-1 text-sm leading-relaxed" aria-live="polite">
              This is taking longer than usual…
            </p>
          )}

          {flowId && (state === "capture_submitted" || state === "liveness_processing") && (
            <div className="mt-3">
              <LivenessDetector
                flowId={flowId}
                onComplete={() => setState("liveness_processing")}
                onError={handleDetectorError}
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
              {state === "capture_failed" ||
              state === "result_timeout" ||
              state === "camera_stream_failed" ||
              state === "liveness_component_failed" ||
              state === "aws_stream_start_failed" ||
              state === "start_failed" ||
              state === "network_error" ||
              state === "camera_permission_required" ? (
                <>
                  <RefreshCw className="size-4" aria-hidden="true" /> Try again
                </>
              ) : state === "consent_required" ? (
                "Agree & start"
              ) : (
                "Start check"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (isFullscreen) {
    const step = state === "liveness_processing" ? "Checking your video" : "Get ready";
    return (
      <LivenessFullscreen title={copy.title} step={step} onClose={handleClose}>
        {inner}
      </LivenessFullscreen>
    );
  }
  return inner;
}
