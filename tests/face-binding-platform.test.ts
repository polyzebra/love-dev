/**
 * Epic 2 (unit, no DB): the binding platform's pure surface - canonical
 * transition rules, the provider registry (dormant + override), method
 * resolution, provider-agnostic events, and worker isolation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canTransition,
  bindingMethodFromEnv,
  getBindingProvider,
  setBindingProviderOverride,
  resetBindingProviders,
  BindingEvent,
} from "../src/lib/services/face-binding";
import { FakeBindingProvider } from "./support/fake-binding-provider";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const env = process.env as Record<string, string | undefined>;

function main() {
  check("canonical transitions: only the documented paths are legal", () => {
    // happy path
    assert.equal(canTransition("NOT_BOUND", "BINDING_REQUIRED"), true);
    assert.equal(canTransition("BINDING_REQUIRED", "BINDING_IN_PROGRESS"), true);
    assert.equal(canTransition("BINDING_IN_PROGRESS", "BOUND"), true);
    assert.equal(canTransition("BINDING_IN_PROGRESS", "MANUAL_REVIEW"), true);
    assert.equal(canTransition("BINDING_IN_PROGRESS", "BINDING_FAILED"), true);
    assert.equal(canTransition("MANUAL_REVIEW", "BOUND"), true);
    // rotation / withdrawal
    assert.equal(canTransition("BOUND", "NOT_BOUND"), true);
    assert.equal(canTransition("BOUND", "CONSENT_WITHDRAWN"), true);
    assert.equal(canTransition("CONSENT_WITHDRAWN", "NOT_BOUND"), true);
    // idempotent re-assert
    assert.equal(canTransition("BOUND", "BOUND"), true);
  });

  check("illegal transitions are rejected", () => {
    assert.equal(canTransition("NOT_BOUND", "BOUND"), false, "cannot skip to BOUND");
    assert.equal(canTransition("BINDING_REQUIRED", "BOUND"), false, "must pass IN_PROGRESS");
    assert.equal(canTransition("BOUND", "BINDING_IN_PROGRESS"), false, "no backward to progress");
    assert.equal(canTransition("BINDING_FAILED", "BOUND"), false);
    assert.equal(canTransition("NOT_BOUND", "MANUAL_REVIEW"), false);
  });

  check("method resolution from env (dormant default = UNKNOWN)", () => {
    const saved = env.FACE_BINDING_METHOD;
    delete env.FACE_BINDING_METHOD;
    assert.equal(bindingMethodFromEnv(), "UNKNOWN", "unset -> UNKNOWN");
    env.FACE_BINDING_METHOD = "human_review";
    assert.equal(bindingMethodFromEnv(), "HUMAN_REVIEW");
    env.FACE_BINDING_METHOD = "STRIPE_COMPARE";
    assert.equal(bindingMethodFromEnv(), "STRIPE_SELFIE_COMPARE", "alias maps to schema method");
    env.FACE_BINDING_METHOD = "PROVIDER_NATIVE";
    assert.equal(bindingMethodFromEnv(), "PROVIDER_NATIVE");
    env.FACE_BINDING_METHOD = "nonsense";
    assert.equal(bindingMethodFromEnv(), "UNKNOWN");
    if (saved === undefined) delete env.FACE_BINDING_METHOD;
    else env.FACE_BINDING_METHOD = saved;
  });

  check("registry is dormant: no real provider resolves; only a test override does", () => {
    resetBindingProviders();
    assert.equal(getBindingProvider("UNKNOWN"), null);
    assert.equal(getBindingProvider("HUMAN_REVIEW"), null, "no provider registered (dormant)");
    assert.equal(getBindingProvider("STRIPE_SELFIE_COMPARE"), null);
    assert.equal(getBindingProvider("PROVIDER_NATIVE"), null);
    const fake = new FakeBindingProvider({ method: "HUMAN_REVIEW" });
    setBindingProviderOverride("HUMAN_REVIEW", fake);
    assert.equal(getBindingProvider("HUMAN_REVIEW"), fake, "override resolves");
    resetBindingProviders();
    assert.equal(getBindingProvider("HUMAN_REVIEW"), null, "reset clears it");
  });

  check("events are canonical + provider-agnostic (no vendor names)", () => {
    const names = Object.values(BindingEvent);
    assert.equal(names.length, 8);
    for (const n of names)
      assert.ok(!/stripe|aws|persona/i.test(n), `event ${n} is vendor-neutral`);
    assert.ok(names.includes("binding_succeeded") && names.includes("binding_review_requested"));
  });

  check("worker isolation: face-verification never imports the binding platform/providers", () => {
    const worker = readFileSync("src/lib/services/face-verification.ts", "utf8");
    assert.ok(!/face-binding/.test(worker), "worker does not import face-binding");
    // The binding platform imports NO vendor adapter (business logic is
    // provider-agnostic; it only depends on the FaceBindingProvider contract).
    const platform = readFileSync("src/lib/services/face-binding.ts", "utf8");
    assert.ok(!/from ["']@\/lib\/services\/aws-/.test(platform), "no aws adapter import");
    assert.ok(!/from ["']@\/lib\/(services\/)?stripe/.test(platform), "no stripe adapter import");
    assert.ok(
      !/from ["']@\/lib\/services\/photo-verification/.test(platform),
      "no identity-provider import",
    );
  });

  console.log(`\n${passed} checks passed`);
}

main();
