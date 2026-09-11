import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrosswalkIndex,
  computeOrgFrameworkCoverage,
  computeSystemFrameworkCoverage,
  type CoverageControl,
  type CoverageMapping,
} from "./framework-coverage";

const controls: CoverageControl[] = [
  { id: "nist-g1", framework: "NIST_AI_RMF", code: "GOVERN 1", title: "Policies", category: "Govern", sortOrder: 10 },
  { id: "nist-g2", framework: "NIST_AI_RMF", code: "GOVERN 2", title: "Accountability", category: "Govern", sortOrder: 20 },
  { id: "iso-a22", framework: "ISO_42001", code: "A.2.2", title: "AI policy", category: "A.2", sortOrder: 10 },
  { id: "iso-a32", framework: "ISO_42001", code: "A.3.2", title: "Roles", category: "A.3", sortOrder: 20 },
  { id: "iso-a33", framework: "ISO_42001", code: "A.3.3", title: "Concerns", category: "A.3", sortOrder: 30 },
  { id: "eu-17", framework: "EU_AI_ACT", code: "Art. 17", title: "QMS", category: "Ch III", sortOrder: 10 },
];

const crosswalk = buildCrosswalkIndex([
  { fromControlId: "nist-g1", toControlId: "iso-a22" },
  { fromControlId: "nist-g1", toControlId: "eu-17" },
  { fromControlId: "nist-g2", toControlId: "iso-a32" },
]);

function mapping(overrides: Partial<CoverageMapping> & Pick<CoverageMapping, "controlId">): CoverageMapping {
  return {
    id: `m-${overrides.controlId}-${overrides.aiSystemId ?? "s1"}`,
    aiSystemId: "s1",
    status: "COMPLIANT",
    evidence: "ok",
    assessedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

test("crosswalk index is undirected and ignores self-links", () => {
  const index = buildCrosswalkIndex([
    { fromControlId: "a", toControlId: "b" },
    { fromControlId: "c", toControlId: "c" },
  ]);
  assert.deepEqual(Array.from(index.get("a") ?? []), ["b"]);
  assert.deepEqual(Array.from(index.get("b") ?? []), ["a"]);
  assert.equal(index.has("c"), false);
});

test("direct mapping wins and is reported with its evidence", () => {
  const result = computeSystemFrameworkCoverage({
    framework: "ISO_42001",
    controls,
    crosswalk,
    mappings: [mapping({ controlId: "iso-a22", status: "PARTIALLY_COMPLIANT", evidence: "policy drafted" })],
  });
  const row = result.rows.find((r) => r.control.code === "A.2.2")!;
  assert.equal(row.status, "PARTIALLY_COMPLIANT");
  assert.equal(row.source, "direct");
  assert.equal(row.evidence, "policy drafted");
  assert.equal(result.summary.partiallyCompliant, 1);
  // Partial does not count toward coverage.
  assert.equal(result.summary.coveragePct, 0);
  assert.equal(result.summary.assessedPct, Math.round((1 / 3) * 100));
});

test("compliant control in one framework is inherited by its crosswalked peers", () => {
  const result = computeSystemFrameworkCoverage({
    framework: "ISO_42001",
    controls,
    crosswalk,
    mappings: [mapping({ controlId: "nist-g1" })],
  });
  const a22 = result.rows.find((r) => r.control.code === "A.2.2")!;
  assert.equal(a22.status, "INHERITED");
  assert.equal(a22.source, "crosswalk");
  assert.deepEqual(a22.inheritedFrom.map((c) => c.code), ["GOVERN 1"]);
  const a32 = result.rows.find((r) => r.control.code === "A.3.2")!;
  assert.equal(a32.status, "NOT_ASSESSED");
  assert.equal(a32.source, "none");
  assert.equal(result.summary.inherited, 1);
  assert.equal(result.summary.coveragePct, 33);

  // The EU article linked to the same NIST control inherits too.
  const eu = computeSystemFrameworkCoverage({
    framework: "EU_AI_ACT",
    controls,
    crosswalk,
    mappings: [mapping({ controlId: "nist-g1" })],
  });
  assert.equal(eu.rows[0].status, "INHERITED");
  assert.equal(eu.summary.coveragePct, 100);
});

test("inheritance requires COMPLIANT, not partial, and never chains", () => {
  // NIST GOVERN 1 partial -> ISO A.2.2 should NOT inherit.
  const partial = computeSystemFrameworkCoverage({
    framework: "ISO_42001",
    controls,
    crosswalk,
    mappings: [mapping({ controlId: "nist-g1", status: "PARTIALLY_COMPLIANT" })],
  });
  assert.equal(partial.rows.find((r) => r.control.code === "A.2.2")!.status, "NOT_ASSESSED");

  // ISO A.2.2 compliant -> NIST GOVERN 1 inherits, but EU Art. 17 (linked only
  // to GOVERN 1, not to A.2.2) must not inherit through the intermediate hop.
  const chained = computeSystemFrameworkCoverage({
    framework: "EU_AI_ACT",
    controls,
    crosswalk,
    mappings: [mapping({ controlId: "iso-a22" })],
  });
  assert.equal(chained.rows[0].status, "NOT_ASSESSED");
});

test("an explicit non-compliant direct mapping overrides inheritance", () => {
  const result = computeSystemFrameworkCoverage({
    framework: "ISO_42001",
    controls,
    crosswalk,
    mappings: [
      mapping({ controlId: "nist-g1" }),
      mapping({ controlId: "iso-a22", status: "NON_COMPLIANT", evidence: "gap" }),
    ],
  });
  const a22 = result.rows.find((r) => r.control.code === "A.2.2")!;
  assert.equal(a22.status, "NON_COMPLIANT");
  assert.equal(a22.source, "direct");
  assert.equal(result.summary.nonCompliant, 1);
});

test("a NOT_ASSESSED placeholder row still allows inheritance and keeps its mapping id", () => {
  const result = computeSystemFrameworkCoverage({
    framework: "ISO_42001",
    controls,
    crosswalk,
    mappings: [
      mapping({ controlId: "nist-g1" }),
      mapping({ id: "placeholder", controlId: "iso-a22", status: "NOT_ASSESSED", evidence: null }),
    ],
  });
  const a22 = result.rows.find((r) => r.control.code === "A.2.2")!;
  assert.equal(a22.status, "INHERITED");
  assert.equal(a22.mappingId, "placeholder");
});

test("legacy free-text mappings (no controlId) are ignored by coverage", () => {
  const result = computeSystemFrameworkCoverage({
    framework: "NIST_AI_RMF",
    controls,
    crosswalk,
    mappings: [mapping({ controlId: null })],
  });
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.notAssessed, 2);
});

test("org roll-up only counts systems with a direct mapping in the framework", () => {
  const org = computeOrgFrameworkCoverage({
    framework: "ISO_42001",
    controls,
    crosswalk,
    mappings: [
      // s1: assessed against ISO directly, 2 of 3 satisfied (one direct, one inherited)
      mapping({ aiSystemId: "s1", controlId: "iso-a32" }),
      mapping({ aiSystemId: "s1", controlId: "nist-g1" }),
      // s2: only NIST mappings -> would inherit ISO A.2.2 but is not "in scope"
      mapping({ aiSystemId: "s2", controlId: "nist-g1" }),
      // s3: ISO non-compliant everywhere assessed
      mapping({ aiSystemId: "s3", controlId: "iso-a22", status: "NON_COMPLIANT" }),
    ],
  });
  assert.equal(org.systemsInScope, 2);
  assert.equal(org.controlCount, 3);
  const s1 = org.perSystem.find((p) => p.aiSystemId === "s1")!.summary;
  assert.equal(s1.coveragePct, 67);
  const s3 = org.perSystem.find((p) => p.aiSystemId === "s3")!.summary;
  assert.equal(s3.coveragePct, 0);
  assert.equal(org.avgCoveragePct, Math.round((67 + 0) / 2));
  assert.equal(org.controlsSatisfiedSomewhere, 2);
  const a22 = org.perControl.find((c) => c.control.code === "A.2.2")!;
  assert.equal(a22.satisfiedSystems, 1); // s1 inherited
  assert.equal(a22.assessedSystems, 1); // s3 direct non-compliant
});

test("empty framework yields zero percentages rather than NaN", () => {
  const org = computeOrgFrameworkCoverage({ framework: "SOC2", controls, crosswalk, mappings: [] });
  assert.equal(org.avgCoveragePct, 0);
  assert.equal(org.controlCount, 0);
  const sys = computeSystemFrameworkCoverage({ framework: "SOC2", controls, crosswalk, mappings: [] });
  assert.equal(sys.summary.coveragePct, 0);
  assert.equal(sys.summary.assessedPct, 0);
});
