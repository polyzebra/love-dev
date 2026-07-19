/**
 * Global operating-scope consistency (unit, no DB). Proves the Legal Centre no
 * longer implies Ireland/UK are the only operating regions, that the Irish
 * company facts and Explore categories are untouched, and that no unsupported
 * "worldwide" claim was introduced.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGAL_COMPANY } from "../src/lib/legal/registry";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const hub = readFileSync("src/app/(marketing)/legal/page.tsx", "utf8");
const registry = readFileSync("src/lib/legal/registry.ts", "utf8");
const taxonomy = readFileSync("src/lib/discovery/taxonomy.ts", "utf8");

function main() {
  console.log("1. Legal Centre no longer states Ireland/UK are the only operating regions");
  check("'Operating regions' label and jurisdictions list are gone", () => {
    assert.ok(!hub.includes("Operating regions"), "removed 'Operating regions' label");
    assert.ok(!hub.includes("jurisdictions"), "no jurisdictions render in the hub");
    assert.ok(
      !registry.includes('jurisdictions: ["Ireland"'),
      "no Ireland/UK jurisdictions config remains",
    );
  });
  check("shows 'Platform availability' + an international statement", () => {
    assert.ok(hub.includes("Platform availability"), "new 'Platform availability' label");
    assert.ok(!hub.includes("Operating availability"), "no stale 'Operating availability' label");
    assert.ok(hub.includes("availabilityStatement"), "renders the config statement");
    const s = LEGAL_COMPANY.availabilityStatement.toLowerCase();
    assert.ok(s.includes("international"), "states it is international");
    assert.ok(/vary depending on your country or region/.test(s), "varies by country/region");
    assert.ok(/irish company/.test(s), "names the Irish company (domicile vs availability)");
  });

  console.log("2. Irish company details remain intact");
  check("entity / CRO / registrar / registered office unchanged", () => {
    assert.equal(LEGAL_COMPANY.entity, "WiseWave Limited");
    assert.equal(LEGAL_COMPANY.companyNumber, "762171");
    assert.ok(LEGAL_COMPANY.registrar.includes("Ireland"), "registrar names Ireland");
    const addr = LEGAL_COMPANY.address.join(", ");
    assert.ok(addr.includes("A91 AP2V") && addr.includes("Ireland"), "registered office intact");
  });

  console.log("3. Explore categories are unchanged data-driven groupings (not territories)");
  check("International / Irish / UK discovery categories still present", () => {
    for (const id of ["international", "irish", "uk"]) {
      assert.ok(taxonomy.includes(`id: "${id}"`), `${id} discovery category present`);
    }
  });

  console.log("4. No unsupported Ireland/UK-only or worldwide claim on the hub");
  check("no Ireland/UK-only availability claim in the hub source", () => {
    assert.ok(!/only\b[^.]{0,40}(Ireland|United Kingdom|\bUK\b)/i.test(hub), "no 'only ... Ireland/UK'");
    assert.ok(!/\bIreland\b\s*(and|·|&)\s*(the\s*)?(United Kingdom|UK)\b/i.test(hub), "no 'Ireland and UK'");
  });
  check("no unsupported 'available worldwide' / 'global coverage' claim introduced", () => {
    const s = LEGAL_COMPANY.availabilityStatement.toLowerCase();
    assert.ok(!/available worldwide|global coverage|available in every country/.test(s));
    assert.ok(!/available worldwide|global coverage|available in every country/i.test(hub));
  });

  console.log(`\n${passed} checks passed`);
}

main();
