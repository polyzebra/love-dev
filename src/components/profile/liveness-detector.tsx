"use client";

import { useEffect, useState } from "react";
import { FaceLivenessDetectorCore } from "@aws-amplify/ui-react-liveness";
import "@aws-amplify/ui-react/styles.css";

/**
 * AWS Face Liveness capture leaf (TASK 4) - NO Cognito. This module is
 * loaded ONLY via next/dynamic from liveness-capture.tsx, so the heavy
 * Amplify SDK code-splits off every other route.
 *
 * Credentials come from our OWNER-SCOPED capture handle (STS AssumeRole,
 * scoped to StartFaceLivenessSession only). The sessionId + temp creds
 * are transient (capture stream only), never persisted to URL/storage/
 * logs, and confer no authority - result consumption stays flowId-bound.
 */
export function LivenessDetector({
  flowId,
  onComplete,
  onError,
  onUnavailable,
}: {
  flowId: string;
  onComplete: () => void;
  /** Raw FaceLivenessDetectorCore error state (LivenessErrorState) so the parent
   *  can distinguish a pre-capture failure from a real capture failure. */
  onError: (errorState: string) => void;
  onUnavailable: () => void;
}) {
  const [handle, setHandle] = useState<
    | {
        sessionId: string;
        region: string;
        credentials: {
          accessKeyId: string;
          secretAccessKey: string;
          sessionToken: string;
          expiration: string;
        };
      }
    | null
    | "error"
  >(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/verification/liveness/${flowId}/capture`);
        if (!res.ok) {
          if (alive) setHandle("error");
          return;
        }
        const body = (await res.json()) as { data?: typeof handle };
        if (alive) setHandle((body.data as typeof handle) ?? "error");
      } catch {
        if (alive) setHandle("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [flowId]);

  useEffect(() => {
    if (handle === "error") onUnavailable();
  }, [handle, onUnavailable]);

  if (!handle || handle === "error") return null;

  return (
    <FaceLivenessDetector
      sessionId={handle.sessionId}
      region={handle.region}
      config={{
        // credentialProvider is called ONCE at flow start (no refresh) -
        // the STS TTL covers the whole capture.
        credentialProvider: async () => ({
          accessKeyId: handle.credentials.accessKeyId,
          secretAccessKey: handle.credentials.secretAccessKey,
          sessionToken: handle.credentials.sessionToken,
          expiration: new Date(handle.credentials.expiration),
        }),
      }}
      onAnalysisComplete={async () => onComplete()}
      // Surface the LivenessErrorState so the parent maps CAMERA_ACCESS_ERROR,
      // RUNTIME_ERROR, SERVER_ERROR etc. to the correct pre-capture state instead
      // of blindly calling it a lighting/movement capture failure (L9.3).
      onError={(err) => onError((err as unknown as { state?: string })?.state ?? "RUNTIME_ERROR")}
      // NO disableStartScreen: the built-in "Get ready / Begin check" start screen
      // provides the USER GESTURE iOS Safari requires to start the camera stream.
      // Auto-starting on mount (detached from the tap) throws CAMERA_ACCESS_ERROR
      // on iOS before any preview renders - the L9.3 root cause.
    />
  );
}

// Alias kept explicit so the Core variant is unmistakable in the tree.
const FaceLivenessDetector = FaceLivenessDetectorCore;
