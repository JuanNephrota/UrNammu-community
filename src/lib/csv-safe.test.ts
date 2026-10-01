import test from "node:test";
import assert from "node:assert/strict";
import { csvField, neutralizeFormula } from "./csv-safe";

test("formula starters are neutralized", () => {
  for (const v of ['=HYPERLINK("x")', "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
    assert.equal(neutralizeFormula(v), `'${v}`, JSON.stringify(v));
  }
});

test("plain numbers and ordinary text are untouched", () => {
  for (const v of ["-5", "+1.5", "42", "hello", "a=b", ""]) {
    assert.equal(neutralizeFormula(v), v, JSON.stringify(v));
  }
});

test("csvField neutralizes and still quotes", () => {
  assert.equal(csvField('=A1,"x"'), `"'=A1,""x"""`);
  assert.equal(csvField("plain"), "plain");
});
