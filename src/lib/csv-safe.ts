/**
 * Spreadsheet-safe CSV fields. Excel and Sheets evaluate a cell that starts
 * with = + - @ (or a tab/CR that some versions skip over), so a discovered
 * tool or vendor named `=HYPERLINK(...)` turns an export into a payload. Such
 * cells get a leading apostrophe, which spreadsheets render as plain text.
 * Plain numbers ("-5", "+1.5") are left alone so numeric columns stay numeric.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

/** Neutralize formulas, then apply RFC 4180 quoting. */
export function csvField(value: string): string {
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
