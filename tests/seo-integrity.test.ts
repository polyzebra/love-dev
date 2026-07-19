/**
 * SEO integrity governance (L7.2, Phase I/J). CI FAILS if the canonical-URL
 * contract regresses:
 *   - metadataBase must use the ONE canonical site URL (siteUrl()), never
 *     NEXT_PUBLIC_APP_URL and never a localhost literal (SEO-1);
 *   - no metadata producer may read NEXT_PUBLIC_APP_URL;
 *   - every JSON-LD URL (item/url/logo/image/@id/sameAs) must be ABSOLUTE -
 *     no root-relative "/..." (SEO-2).
 * Pure source-contract; no DB, no env.
 *   npx tsx tests/seo-integrity.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const read = (p: string) => readFileSync(p, "utf8");

// Files that PRODUCE page metadata / SEO URLs.
const METADATA_FILES = [
  "src/app/layout.tsx",
  "src/lib/marketing/seo.ts",
  "src/lib/legal/seo.ts",
  "src/app/sitemap.ts",
  "src/app/robots.ts",
];
// Files that emit JSON-LD structured data.
const JSONLD_FILES = [
  "src/app/(marketing)/about/page.tsx",
  "src/components/legal/legal-chrome.tsx",
  "src/components/legal/legal-document.tsx",
  "src/lib/legal/seo.ts",
];

function main() {
  // ---- SEO-1: metadataBase uses the one canonical siteUrl() ---------------
  check("metadataBase is derived from siteUrl() (not NEXT_PUBLIC_APP_URL / localhost)", () => {
    const layout = read("src/app/layout.tsx");
    assert.ok(
      /metadataBase:\s*new URL\(\s*siteUrl\(\)\s*\)/.test(layout),
      "metadataBase must be new URL(siteUrl())",
    );
    // The CODE line (has the `metadataBase:` key), not the surrounding comment.
    const line = layout.split("\n").find((l) => /metadataBase:/.test(l)) ?? "";
    assert.ok(!/localhost/.test(line), "metadataBase must not contain a localhost literal");
    assert.ok(!/NEXT_PUBLIC_APP_URL/.test(line), "metadataBase must not read NEXT_PUBLIC_APP_URL");
  });

  check("no metadata producer reads process.env.NEXT_PUBLIC_APP_URL", () => {
    const offenders = METADATA_FILES.filter((f) =>
      /process\.env\.NEXT_PUBLIC_APP_URL/.test(read(f)),
    );
    assert.deepEqual(
      offenders,
      [],
      "metadata must use siteUrl(); APP_URL is not a metadata source",
    );
  });

  // ---- SEO-2: all JSON-LD URLs are absolute -------------------------------
  check("no JSON-LD emits a root-relative URL (item/url/logo/image/@id/sameAs)", () => {
    // A relative value looks like `item: "/legal"` / `url: "/about"`. Absolute
    // values start with http or are template-built from siteUrl()/legalOrigin.
    const rel = /(item|url|logo|image|"@id"|sameAs):\s*["']\/[a-zA-Z]/;
    const offenders: string[] = [];
    for (const f of JSONLD_FILES) {
      const src = read(f);
      for (const [i, l] of src.split("\n").entries()) {
        if (/^\s*(\*|\/\/)/.test(l)) continue;
        if (rel.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim()}`);
      }
    }
    assert.deepEqual(offenders, [], "JSON-LD URLs must be absolute (siteUrl()/legalAbsoluteUrl)");
  });

  check("the legal breadcrumb JSON-LD builds items from the canonical origin", () => {
    const chrome = read("src/components/legal/legal-chrome.tsx");
    // The BreadcrumbList block must template its items off siteUrl() (legalOrigin),
    // and must NOT ship the old relative literals.
    assert.ok(/const legalOrigin = siteUrl\(\)/.test(chrome), "legalOrigin from siteUrl()");
    assert.ok(/item: `\$\{legalOrigin\}/.test(chrome), "breadcrumb items are absolute");
    assert.ok(
      !/item:\s*["']\/(legal)?["']/.test(chrome),
      "no relative breadcrumb item literals remain",
    );
  });

  console.log(`\n${passed} checks passed`);
}

main();
