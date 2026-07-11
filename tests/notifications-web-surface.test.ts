/**
 * Static contract tests for the web/native notification split. No server
 * needed - these read the source and pin the decisions:
 *   npx tsx tests/notifications-web-surface.test.ts
 *
 * 1. The notifications hub is channels-only: Email/Push/SMS rows, no
 *    IN-APP section, no Sounds/Vibrations toggles, no test buttons.
 * 2. The web sound/vibration layer is gone: no sound module, no wav
 *    asset, no `new Audio(` / `navigator.vibrate` anywhere in the
 *    notification code paths (interaction-events.ts is gesture haptics,
 *    deliberately out of scope).
 * 3. The OS owns push sound/vibration: neither the payload builders nor
 *    the service worker mention a `silent` flag.
 * 4. inAppSounds/inAppVibrations stay native-only: kept in the Prisma
 *    schema and the PATCH schema, never rendered by any web page.
 * 5. The platform abstraction exists and reports web => sounds/haptics
 *    not configurable, and the push setup card consumes it.
 * 6. What must survive, survives: presence heartbeat + message polling.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** Comments may NAME banned things (they document the removal). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "");
}

function read(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

/** All files under dir (recursive) matching the extension filter. */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log("notifications hub is channels-only");
// ---------------------------------------------------------------------------

const hub = read("src", "app", "(app)", "settings", "notifications", "page.tsx");

check("hub renders the Email, Push and SMS channel rows", () => {
  for (const label of ['label: "Email"', 'label: "Push"', 'label: "SMS"']) {
    assert.ok(hub.includes(label), `hub page must keep ${label}`);
  }
});

check("hub has no IN-APP section, Sounds/Vibrations rows or test buttons", () => {
  for (const banned of [
    /in-app/i,
    /\bSounds\b/,
    /\bVibrations?\b/i,
    /Play test sound/i,
    /Test vibration/i,
  ]) {
    assert.ok(!banned.test(hub), `hub page must not contain ${banned}`);
  }
});

check("hub never touches the native-only settings fields", () => {
  assert.ok(!hub.includes("inAppSounds") && !hub.includes("inAppVibrations"));
  assert.ok(!hub.includes("getUserSettings"), "channels-only page needs no settings read");
});

// ---------------------------------------------------------------------------
console.log("web sound/vibration layer is gone");
// ---------------------------------------------------------------------------

check("removed files stay removed", () => {
  for (const gone of [
    "src/components/settings/in-app-feedback.tsx",
    "src/lib/notifications/sound.ts",
    "public/sounds/message.wav",
  ]) {
    assert.ok(!existsSync(join(ROOT, gone)), `${gone} must not exist`);
  }
});

check("no new Audio( / navigator.vibrate in notification code paths", () => {
  const files = [
    ...walk(join(ROOT, "src", "lib", "notifications"), [".ts", ".tsx"]),
    ...walk(join(ROOT, "src", "components", "settings"), [".ts", ".tsx"]),
    ...walk(join(ROOT, "src", "app", "(app)", "settings", "notifications"), [".tsx"]),
    join(ROOT, "src", "components", "app", "chat-thread.tsx"),
    join(ROOT, "src", "lib", "services", "notify.ts"),
    join(ROOT, "src", "lib", "services", "push.ts"),
    join(ROOT, "public", "sw.js"),
  ];
  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(!code.includes("new Audio("), `${file} must not construct Audio`);
    assert.ok(!code.includes("navigator.vibrate"), `${file} must not vibrate`);
    assert.ok(!/notifications\/sound/.test(code), `${file} must not import the old sound module`);
  }
});

// ---------------------------------------------------------------------------
console.log("the OS owns push sound/vibration");
// ---------------------------------------------------------------------------

check("service worker passes no silent option to showNotification", () => {
  const sw = stripComments(read("public", "sw.js"));
  assert.ok(!/\bsilent\b/.test(sw), "sw.js must not read or set `silent`");
});

check("push payload builders never set a silent flag", () => {
  for (const file of ["notify.ts", "push.ts"]) {
    const code = stripComments(read("src", "lib", "services", file));
    assert.ok(!/\bsilent\s*[:=]/.test(code), `${file} must not build a silent flag`);
    assert.ok(!code.includes("inAppSounds"), `${file} must not read inAppSounds`);
  }
});

// ---------------------------------------------------------------------------
console.log("native-only fields kept, not exposed");
// ---------------------------------------------------------------------------

check("Prisma schema keeps inAppSounds/inAppVibrations (rule A: no drops)", () => {
  const schema = read("prisma", "schema.prisma");
  assert.ok(schema.includes("inAppSounds"));
  assert.ok(schema.includes("inAppVibrations"));
});

check("settingsPatchSchema still accepts them for a future native PATCH", () => {
  const settings = stripComments(read("src", "lib", "services", "settings.ts"));
  assert.ok(/inAppVibrations:\s*z\.boolean\(\)/.test(settings));
  assert.ok(/inAppSounds:\s*z\.boolean\(\)/.test(settings));
});

check("no web page/component renders the native-only fields", () => {
  const files = [
    ...walk(join(ROOT, "src", "app"), [".ts", ".tsx"]),
    ...walk(join(ROOT, "src", "components"), [".ts", ".tsx"]),
  ];
  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(
      !code.includes("inAppSounds") && !code.includes("inAppVibrations"),
      `${file} must not consume the native-only settings fields`,
    );
  }
});

// ---------------------------------------------------------------------------
console.log("platform abstraction");
// ---------------------------------------------------------------------------

check("platform.ts reports web => sounds/haptics not configurable", () => {
  const platform = read("src", "lib", "notifications", "platform.ts");
  assert.ok(platform.includes("getPlatformNotificationCapabilities"));
  assert.ok(platform.includes('platform: "web"'));
  assert.ok(/notificationSoundsConfigurable:\s*false/.test(platform));
  assert.ok(/hapticsConfigurable:\s*false/.test(platform));
});

check("push setup consumes the platform capabilities for gating", () => {
  const setup = read("src", "components", "settings", "push-setup.tsx");
  assert.ok(setup.includes("getPlatformNotificationCapabilities"));
  assert.ok(setup.includes("pushSupported"));
});

check("no Capacitor packages are installed (documentation-only path)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(!Object.keys(all).some((name) => name.includes("capacitor")));
  assert.ok(existsSync(join(ROOT, "docs", "NOTIFICATIONS-NATIVE.md")));
});

// ---------------------------------------------------------------------------
console.log("what must survive, survives");
// ---------------------------------------------------------------------------

check("chat thread keeps the presence heartbeat and message polling", () => {
  const thread = read("src", "components", "app", "chat-thread.tsx");
  assert.ok(thread.includes("/api/presence/heartbeat"));
  assert.ok(thread.includes("HEARTBEAT_INTERVAL_MS"));
  assert.ok(thread.includes("POLL_INTERVAL_MS"));
  assert.ok(thread.includes("setMessages"), "visual new-message updates stay");
});

check("service worker keeps showNotification + click routing", () => {
  const sw = read("public", "sw.js");
  assert.ok(sw.includes("showNotification"));
  assert.ok(sw.includes("notificationclick"));
  assert.ok(sw.includes("pushsubscriptionchange"));
});

console.log(`\nAll ${passed} checks passed.`);
