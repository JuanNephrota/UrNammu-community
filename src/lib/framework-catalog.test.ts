import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_FRAMEWORKS,
  FRAMEWORK_CATALOG,
  FRAMEWORK_CROSSWALK,
  assertCatalogIntegrity,
  controlKey,
  isCatalogFramework,
} from "./framework-catalog";

test("catalog is internally consistent", () => {
  assert.doesNotThrow(() => assertCatalogIntegrity());
});

test("every catalog framework has controls, and every control has content", () => {
  for (const framework of CATALOG_FRAMEWORKS) {
    const controls = FRAMEWORK_CATALOG.filter((c) => c.framework === framework);
    assert.ok(controls.length > 0, `${framework} has no controls`);
    for (const control of controls) {
      assert.ok(control.code.trim().length > 0, `${framework} control missing code`);
      assert.ok(control.title.trim().length > 0, `${control.code} missing title`);
      assert.ok(control.description.trim().length > 40, `${control.code} description too short`);
      assert.ok(control.category.trim().length > 0, `${control.code} missing category`);
      assert.ok(control.sortOrder > 0, `${control.code} sortOrder must be positive`);
    }
    // sortOrder is unique within a framework so the UI has a stable order.
    const orders = new Set(controls.map((c) => c.sortOrder));
    assert.equal(orders.size, controls.length, `${framework} has duplicate sortOrder values`);
  }
});

test("well-known anchors exist so the EU AI Act wizard and docs can rely on them", () => {
  const keys = new Set(FRAMEWORK_CATALOG.map((c) => controlKey(c.framework, c.code)));
  for (const expected of [
    "EU_AI_ACT::Art. 5",
    "EU_AI_ACT::Art. 9",
    "EU_AI_ACT::Art. 14",
    "EU_AI_ACT::Art. 26",
    "EU_AI_ACT::Art. 27",
    "EU_AI_ACT::Art. 50",
    "EU_AI_ACT::Art. 53",
    "NIST_AI_RMF::GOVERN 1",
    "NIST_AI_RMF::MANAGE 4",
    "ISO_42001::A.2.2",
    "ISO_42001::A.10.4",
    "SOC2::CC1",
    "SOC2::P8",
    "COLORADO_AI::CO-2",
    "COLORADO_AI::CO-5",
    "NEW_YORK_AI::NY-2",
    "NEW_YORK_AI::NY-4",
  ]) {
    assert.ok(keys.has(expected), `missing ${expected}`);
  }
});

test("every framework is linked to at least one other through the crosswalk", () => {
  // Coverage inheritance is one hop. The core frameworks form a full mesh;
  // jurisdiction-specific ones only need to connect to something.
  const linked = (a: string, b: string) =>
    FRAMEWORK_CROSSWALK.some(
      (xw) =>
        (xw.from.framework === a && xw.to.framework === b) ||
        (xw.from.framework === b && xw.to.framework === a)
    );
  const core = ["EU_AI_ACT", "NIST_AI_RMF", "ISO_42001", "SOC2"] as const;
  for (const a of core) for (const b of core) if (a !== b) assert.ok(linked(a, b), `no crosswalk between ${a} and ${b}`);
  for (const a of CATALOG_FRAMEWORKS) {
    assert.ok(CATALOG_FRAMEWORKS.some((b) => b !== a && linked(a, b)), `${a} has no crosswalk`);
  }
});

test("isCatalogFramework rejects CUSTOM and junk", () => {
  assert.equal(isCatalogFramework("EU_AI_ACT"), true);
  assert.equal(isCatalogFramework("CUSTOM"), false);
  assert.equal(isCatalogFramework("nope"), false);
});
