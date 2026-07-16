/**
 * face:rehearsal - PREPARE (do not auto-run) a controlled internal
 * rehearsal of the face-verification layer.
 *
 *   npm run face:rehearsal                 gate check + print the plan
 *   npm run face:rehearsal -- --json       machine-readable gate report
 *   npm run face:rehearsal -- --simulate --subject <id> --cover-subject <id>
 *                                          headless mock-provider dry-run of
 *                                          the full 14-step journey (non-prod)
 *   npm run face:rehearsal -- --cleanup --subject <id> --cover-subject <id>
 *                                          restore rehearsal subjects
 *   npm run face:rehearsal -- --evidence reports/rehearsal-<date>.json
 *                                          write an evidence record of a run
 *
 * REFUSES (exit 3) whenever any of the eight hard gates is unmet - the whole
 * point is that a rehearsal cannot start from an unprepared environment. It
 * NEVER enables production, NEVER sets the legal gate for you, and NEVER
 * prints a secret or a raw biometric identifier.
 *
 * Exit codes: 0 ready/ok - 2 crash - 3 gates unmet / not ready - 4 run had a
 * failing step.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const JSON_ONLY = has("--json");

async function main() {
  const { evaluateRehearsalGates, simulateRehearsalJourney, cleanupRehearsal, REHEARSAL_JOURNEY } =
    await import("../src/lib/services/face-rehearsal");

  const gates = evaluateRehearsalGates();

  // ---- cleanup: allowed regardless of gate state (it only tears down) ----
  if (has("--cleanup")) {
    const ids = [val("--subject"), val("--cover-subject")].filter(Boolean) as string[];
    if (ids.length === 0) {
      console.error("--cleanup needs --subject <id> [--cover-subject <id>]");
      process.exit(2);
    }
    const result = await cleanupRehearsal({ subjectIds: ids });
    console.log(JSON.stringify(result, null, JSON_ONLY ? 0 : 2));
    process.exit(0);
  }

  // ---- gate report (always shown) ----
  if (JSON_ONLY && !has("--simulate")) {
    console.log(JSON.stringify(gates));
  } else {
    console.log("Internal rehearsal - hard gate check\n");
    for (const g of gates.gates) {
      console.log(`  [${g.ok ? "PASS" : "FAIL"}] ${g.title}\n         ${g.detail}`);
    }
    console.log(
      `\n  => ${gates.ready ? "ALL GATES PASS - ready to rehearse" : "NOT READY - rehearsal refused"}`,
    );
  }

  if (!gates.ready) {
    if (!JSON_ONLY) {
      console.log("\nThe rehearsal cannot run until every gate passes. Fix the FAILs above.");
    }
    process.exit(3);
  }

  // ---- plan (default when ready and not simulating) ----
  if (!has("--simulate")) {
    if (!JSON_ONLY) {
      console.log("\nPlanned internal-only journey (not executed):");
      for (const s of REHEARSAL_JOURNEY) console.log(`  ${String(s.step).padStart(2)}. ${s.title}`);
      console.log("\nRun with --simulate (non-prod, mock provider) to dry-run the journey,");
      console.log("or follow docs/FACE-REHEARSAL.md to drive the operator-led AWS rehearsal.");
    }
    process.exit(0);
  }

  // ---- simulate: headless mock-provider dry-run of the full journey ----
  const subject = val("--subject");
  const cover = val("--cover-subject");
  if (!subject || !cover) {
    console.error("--simulate needs --subject <id> and --cover-subject <id>");
    process.exit(2);
  }
  const actor = val("--actor") || subject;
  const run = await simulateRehearsalJourney({
    subjectId: subject,
    coverSubjectId: cover,
    actorId: actor,
  });

  if (JSON_ONLY) {
    console.log(JSON.stringify(run));
  } else {
    console.log("\nSimulated journey (mock provider):");
    for (const s of run.steps) {
      console.log(`  [${s.status}] ${String(s.step).padStart(2)}. ${s.title} - ${s.note}`);
    }
    console.log(
      `\n  => ${run.ok ? "JOURNEY OK" : "JOURNEY FAILED"} | biometric-safe: ${run.biometricSafe}`,
    );
  }

  const evidencePath = val("--evidence");
  if (evidencePath) {
    // Stamp time HERE (the module stays clock-free/testable); the evidence
    // record carries only normalized status - never a biometric identifier.
    const evidence = {
      kind: "face-rehearsal-evidence",
      recordedAt: new Date().toISOString(),
      environment: run.environment,
      provider: run.provider,
      mode: run.mode,
      gates: gates.gates.map((g) => ({ id: g.id, title: g.title, ok: g.ok })),
      steps: run.steps,
      ok: run.ok,
      biometricSafe: run.biometricSafe,
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    if (!JSON_ONLY) console.log(`\nEvidence written to ${evidencePath}`);
  }

  process.exit(run.ok ? 0 : 4);
}

main().catch((error) => {
  console.error(`face:rehearsal crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
