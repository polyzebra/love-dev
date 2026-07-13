"use client";

import { useEffect, useState } from "react";
import type { CountryCode, MetadataJson, PhoneNumber } from "libphonenumber-js/core";

/**
 * Lazy phone formatter/parser (Phase 0J). The 40 KB-gzip libphonenumber
 * metadata used to be STATICALLY imported by four auth components, which
 * duplicated the blob into four route bundles and put it on the phone
 * screens' first load. Now it loads once, on demand, into one shared
 * chunk.
 *
 * Same build discipline as countries.ts/phone-flow.ts: the CORE build +
 * an explicit metadata import - the bundled builds (min/max) resolve
 * their metadata through an ESM/CJS interop shim that breaks outside
 * Next's static graph (it hands AsYouType `{ default: ... }`).
 *
 *  - usePhoneTools() starts the fetch on mount and re-renders when ready
 *    (formatting upgrades within ~100ms; until then inputs show plain
 *    digits and prefills show the raw number - no layout shift)
 *  - submit paths await loadPhoneTools() so VALIDATION never runs
 *    without the real parser
 */

export type PhoneTools = {
  /** As-you-type national formatting for one country. */
  formatAsYouType: (digits: string, iso: string) => string;
  /** Full parse; optional default country for national input. */
  parsePhone: (text: string, iso?: string) => PhoneNumber | undefined;
};

let tools: PhoneTools | null = null;
let promise: Promise<PhoneTools> | null = null;

export function loadPhoneTools(): Promise<PhoneTools> {
  promise ??= Promise.all([
    import("libphonenumber-js/core"),
    import("libphonenumber-js/metadata.min.json"),
  ]).then(([core, metadataModule]) => {
    const metadata = ((metadataModule as { default?: unknown }).default ??
      metadataModule) as MetadataJson;
    tools = {
      formatAsYouType: (digits, iso) =>
        digits ? new core.AsYouType(iso as CountryCode, metadata).input(digits) : "",
      parsePhone: (text, iso) =>
        iso
          ? core.parsePhoneNumberFromString(text, iso as CountryCode, metadata)
          : core.parsePhoneNumberFromString(text, metadata),
    };
    return tools;
  });
  return promise;
}

export function phoneToolsNow(): PhoneTools | null {
  return tools;
}

export function usePhoneTools(): PhoneTools | null {
  const [ready, setReady] = useState<PhoneTools | null>(phoneToolsNow);
  useEffect(() => {
    if (!ready) {
      let cancelled = false;
      void loadPhoneTools().then((t) => {
        if (!cancelled) setReady(t);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [ready]);
  return ready;
}
