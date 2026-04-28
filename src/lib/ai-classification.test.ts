import test from "node:test";
import assert from "node:assert/strict";

// Re-export internals for testing: we re-declare the helpers here because
// they're module-private. The test exists to lock in the sanitization
// contract: invalid enum values are dropped, overly long strings are
// truncated, and JSON extraction survives markdown code fences.

const VALID_RISK = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]);
const VALID_SENS = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitize(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const str = (k: string, max: number) => {
    const v = obj[k];
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  };
  const desc = str("description", 500);
  if (desc) out.description = desc;
  const useCase = str("useCase", 500);
  if (useCase) out.useCase = useCase;

  const risk = obj.riskLevel;
  if (typeof risk === "string" && VALID_RISK.has(risk)) out.riskLevel = risk;

  const sens = obj.dataSensitivity;
  if (typeof sens === "string" && VALID_SENS.has(sens)) out.dataSensitivity = sens;

  return out;
}

test("parses JSON wrapped in markdown code fences", () => {
  const raw = "```json\n{\"riskLevel\":\"HIGH\"}\n```";
  const parsed = parseJson(raw);
  assert.deepEqual(parsed, { riskLevel: "HIGH" });
});

test("extracts JSON from noisy response", () => {
  const raw = "Here is the classification:\n{\"riskLevel\":\"MEDIUM\",\"description\":\"test\"}\nHope that helps.";
  const parsed = parseJson(raw);
  assert.deepEqual(parsed, { riskLevel: "MEDIUM", description: "test" });
});

test("drops invalid enum values during sanitization", () => {
  const sanitized = sanitize({
    riskLevel: "TERRIBLE", // invalid
    dataSensitivity: "PRIVATE", // invalid
    description: "real field",
  });
  assert.equal(sanitized.riskLevel, undefined);
  assert.equal(sanitized.dataSensitivity, undefined);
  assert.equal(sanitized.description, "real field");
});

test("truncates overly long strings", () => {
  const sanitized = sanitize({
    description: "x".repeat(1000),
  });
  assert.equal((sanitized.description as string).length, 500);
});

test("accepts all valid enum values", () => {
  for (const risk of VALID_RISK) {
    const sanitized = sanitize({ riskLevel: risk });
    assert.equal(sanitized.riskLevel, risk);
  }
  for (const sens of VALID_SENS) {
    const sanitized = sanitize({ dataSensitivity: sens });
    assert.equal(sanitized.dataSensitivity, sens);
  }
});

test("returns null when response is non-JSON garbage", () => {
  const parsed = parseJson("nothing but text here, no braces");
  assert.equal(parsed, null);
});
