"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LIVENESS_COPY, type LivenessCaptureState } from "@/lib/verification-presentation";

/**
 * Video-selfie liveness capture (Phase 23). Loaded via next/dynamic from
 * the verification card ONLY, so no biometric-capture code ships to
 * unrelated routes.
 *
 * PRIVACY: the capture stream is handed to the provider SDK; nothing is
 * written to localStorage / sessionStorage / IndexedDB / service-worker
 * caches, nothing is sent to analytics, and no frames pass through
 * Tirvea's servers. Only the opaque session id lives in component state
 * (and, for refresh-safety, in the URL hash - never storage).
 *
 * Vendor SDK: the real AWS Amplify FaceLivenessDetector mounts here when
 * the dependency ships (deliberately NOT added yet - see the PRR gate:
 * bundle + DPA must land together). Until then this renders the full
 * state machine with a capture handoff that calls the session endpoints,
 * so states, a11y, consent, retry and degradation are all exercisable.
 */
export function LivenessCapture({
  consentVersion,
  onDone,
}: {
  consentVersion: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  // Route restoration after refresh: the session id rides the URL hash
  // (opaque, non-biometric) - never browser storage. Read once as the
  // INITIAL state so the mount effect never needs to setState.
  const restored =
    typeof window !== "undefined" ? /liveness=([A-Za-z0-9_-]+)/.exec(window.location.hash) : null;
  const [state, setState] = useState<LivenessCaptureState>(
    restored ? "liveness_processing" : "consent_required",
  );
  const [sessionId, setSessionId] = useState<string | null>(restored?.[1] ?? null);
  const [busy, setBusy] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the session while it is in flight. Cleared on unmount.
  useEffect(() => {
    if (!sessionId || (state !== "liveness_processing" && state !== "capture_submitted")) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/verification/liveness/${sessionId}`);
        if (!res.ok) {
          if (alive) setState("provider_unavailable");
          return;
        }
        const body = (await res.json()) as { data?: { state?: string } };
        if (!alive) return;
        const next = body.data?.state;
        if (next === "checking_profile_photos") {
          window.location.hash = "photo-verification";
          onDone?.();
          router.refresh();
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
  }, [sessionId, state, router, onDone]);

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
      const body = (await res.json()) as { data: { sessionId: string } };
      setSessionId(body.data.sessionId);
      // Refresh-safe: opaque id in the hash, nothing in storage.
      window.location.hash = `liveness=${body.data.sessionId}`;
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

          {state === "consent_required" && (
            <div className="bg-foreground/5 text-muted-foreground mt-3 flex items-start gap-3 rounded-2xl p-4 text-sm leading-relaxed">
              <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Your video selfie is captured and checked by our verification partner in the EU.
                Tirvea receives only the result -{" "}
                <span className="text-foreground font-medium">
                  we never store your face data or the video
                </span>
                . By continuing you consent to this biometric check. You can withdraw consent and
                delete your face data at any time from Settings.
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
}
