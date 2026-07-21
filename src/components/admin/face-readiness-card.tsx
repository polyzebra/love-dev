import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFaceReadiness } from "@/lib/services/face-readiness";

/**
 * READ-ONLY admin card: AWS Face Liveness production readiness. Server
 * component - reads the canonical resolvers directly, renders booleans + safe
 * names only. No secrets, no credentials, no biometric data, no raw env values.
 */
function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <CheckCircle2 className="text-success size-4" aria-label="ready" />
      ) : (
        <XCircle className="text-muted-foreground size-4" aria-label="not ready" />
      )}
    </div>
  );
}

export function FaceReadinessCard() {
  const r = getFaceReadiness();
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">AWS Face Liveness — readiness</CardTitle>
        <Badge variant={r.deployReady ? "default" : "secondary"}>
          {r.deployReady ? "Technically ready" : "Not ready"}
        </Badge>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label={`Provider: ${r.provider}`} ok={r.isFaceMatchConfigured} />
        <Row label="Liveness enabled" ok={r.livenessEnabled} />
        <Row label="STS streaming configured" ok={r.streamingConfigured} />
        <Row label="Collection configured" ok={r.collectionConfigured} />
        <Row label={`Region: ${r.region}`} ok={r.region.length > 0} />
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">Kill switch</span>
          {r.killSwitchActive ? (
            <Badge variant="destructive">ENGAGED</Badge>
          ) : (
            <MinusCircle className="text-muted-foreground/50 size-4" aria-label="off" />
          )}
        </div>
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">Rollout cohort</span>
          <span className="tabular-nums">{r.rolloutPercent}%</span>
        </div>
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">Environment</span>
          <span>{r.environment}</span>
        </div>
        <Row label="Compliance gate satisfied" ok={r.legalGate.ok} />
        {!r.legalGate.ok && r.legalGate.missing.length > 0 && (
          <div className="text-muted-foreground/80 pt-2 text-xs">
            Awaiting (non-secret env keys): {r.legalGate.missing.join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
