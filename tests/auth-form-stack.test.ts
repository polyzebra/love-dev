/**
 * Static layout-contract tests for the compact auth forms. No server
 * needed - these read the source and pin the decisions that reversed
 * the old "CTA near the thumb" design:
 *   npx tsx tests/auth-form-stack.test.ts
 *
 * 1. No stretch mechanics anywhere in the auth step tree: the card is
 *    content-driven, so mt-auto / justify-between / min-h-*dvh (and the
 *    old sm:min-h-105 floor) must never come back to a className.
 * 2. AuthFormStack owns the rhythm tokens (label->input 8px, error only
 *    when present, field->CTA 28px at EVERY width, CTA->footnote 16px)
 *    and every step lays out through it - zero per-screen values.
 * 3. The spec'd footnotes exist ("We only use your email...", SMS rates).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const AUTH_DIR = join(import.meta.dirname, "..", "src", "components", "auth");

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** Comments may NAME the banned patterns (they document the reversal). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function read(file: string): string {
  return readFileSync(join(AUTH_DIR, file), "utf8");
}

const files = readdirSync(AUTH_DIR).filter((f) => f.endsWith(".tsx"));

// CountryCodeSheet is a fixed-height OVERLAY (bottom sheet with an
// internal scroll list), not part of the card's layout flow - viewport
// sizing is the point of a sheet. Everything else is the step tree.
const STEP_TREE = files.filter((f) => f !== "CountryCodeSheet.tsx");

const BANNED: Array<[string, RegExp]> = [
  ["mt-auto", /\bmt-auto\b/],
  ["justify-between", /\bjustify-between\b/],
  ["min-h-*dvh", /min-h-\[?\d+(?:\.\d+)?dvh\]?/],
  ["fixed min-h card floor (min-h-105)", /\bmin-h-105\b/],
];

console.log("auth step tree has no stretch mechanics");
for (const file of STEP_TREE) {
  check(`${file} is content-driven`, () => {
    const code = stripComments(read(file));
    for (const [label, pattern] of BANNED) {
      assert.ok(
        !pattern.test(code),
        `${file} reintroduces ${label} - the auth card must grow with content, ` +
          "never stretch to push the CTA down (see AuthFormStack.tsx).",
      );
    }
  });
}

console.log("AuthFormStack owns the rhythm");
const stack = read("AuthFormStack.tsx");
check("field cluster is 8px (space-y-2: label->input, input->error)", () => {
  assert.match(stack, /FIELD_CLUSTER = "space-y-2"/);
});
check("field/error -> CTA is 28px via ONE width-independent token (mt-7)", () => {
  assert.match(stack, /CTA_GAP = "mt-7"/);
  // No sm:/md:/lg: variant may fork the gap by viewport.
  assert.ok(
    !/(?:sm|md|lg|xl):mt-/.test(stack),
    "the CTA gap must be the same token at all widths",
  );
});
check("CTA -> footnote is 16px (mt-4)", () => {
  assert.match(stack, /FOOTNOTE_GAP = "mt-4"/);
});
check("status layer costs 0px while empty", () => {
  assert.ok(stack.includes("[&:not(:empty)]:mt-4"));
});

console.log("every step lays out through the shared stack");
const STACK_USERS = [
  "EmailInputStep.tsx",
  "EmailCodeStep.tsx",
  "PhoneLoginInput.tsx",
  "PhoneLoginCode.tsx",
  "PhoneInputStep.tsx",
  "PhoneCodeStep.tsx",
  "AgeConfirmStep.tsx",
  "LegalConsentStep.tsx",
  "RecoveryOptions.tsx",
];
for (const file of STACK_USERS) {
  check(`${file} uses AuthFormStack`, () => {
    const code = read(file);
    assert.ok(code.includes('from "@/components/auth/AuthFormStack"'), `${file} must import it`);
    assert.ok(code.includes("<AuthFormStack"), `${file} must render it`);
  });
}

console.log("spec'd copy is in place");
check("email step carries the anti-spam footnote", () => {
  assert.ok(
    read("EmailInputStep.tsx").includes(
      "We only use your email to sign you in - never to spam you.",
    ),
  );
});
check("phone steps carry the SMS-rates footnote", () => {
  for (const file of ["PhoneLoginInput.tsx", "PhoneInputStep.tsx"]) {
    assert.ok(read(file).includes("Standard SMS rates may apply."), file);
  }
});
check("shells document the reversal of the thumb-CTA design", () => {
  for (const file of ["AuthShell.tsx", "LoginStepShell.tsx"]) {
    assert.match(read(file), /REVERSED/i, `${file} must explain why there is no stretch`);
  }
});

// ---------------------------------------------------------------------------
// No blank loading states (regression pins for the white-pill/card bug)
// ---------------------------------------------------------------------------

check("a pending CTA always shows spinner PLUS visible text, never a bare spinner", () => {
  const btn = read("AuthSubmitButton.tsx");
  assert.match(btn, /pendingLabel/);
  assert.match(btn, /aria-busy=\{pending\}/);
  for (const file of [
    "EmailInputStep.tsx",
    "PhoneInputStep.tsx",
    "PhoneLoginInput.tsx",
    "EmailAttachStep.tsx",
  ]) {
    assert.match(read(file), /pendingLabel="Sending code\.\.\."/, file);
  }
});

check("routed auth Suspense boundaries always render a meaningful fallback", () => {
  const APP = join(import.meta.dirname, "..", "src", "app", "(auth)");
  for (const page of [
    join(APP, "login", "email", "verify", "page.tsx"),
    join(APP, "login", "phone", "verify", "page.tsx"),
    join(APP, "auth", "phone-code", "page.tsx"),
  ]) {
    const src = readFileSync(page, "utf8");
    assert.match(src, /<Suspense fallback=\{<AuthStepFallback/, page);
  }
  const fallback = read("AuthStepFallback.tsx");
  assert.match(fallback, /animate-spin/);
  assert.match(fallback, /Opening verification\.\.\./);
});

check("the brand button never paints as a blank pill (solid fallback under the gradient)", () => {
  const button = readFileSync(
    join(import.meta.dirname, "..", "src", "components", "ui", "button.tsx"),
    "utf8",
  );
  assert.match(button, /bg-primary bg-linear-160/, "solid color must underlie the gradient");
  assert.match(button, /appearance-none/, "no native control chrome on iOS Safari");
});

console.log(`\n${passed} checks passed`);
