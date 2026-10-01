#!/usr/bin/env node
/**
 * Guards the pure modules that are copied by hand between the Next.js app and
 * the Azure Functions proxy (`ai-proxy/`), which cannot import from the app.
 * Each pair must be byte-identical, optionally after skipping a fixed header
 * on the proxy copy.
 *
 * Run: node scripts/check-mirror-drift.mjs   (also wired into CI)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MIRRORS = [
  { app: "src/lib/model-pricing.ts", proxy: "ai-proxy/src/lib/pricing.ts" },
  { app: "src/lib/proxy-providers.ts", proxy: "ai-proxy/src/lib/proxy-providers.ts" },
  { app: "src/lib/prompt-hash.ts", proxy: "ai-proxy/src/lib/prompt-hash.ts" },
  { app: "src/lib/regex-safety.ts", proxy: "ai-proxy/src/lib/regex-safety.ts" },
  {
    app: "src/lib/caller-fingerprint.ts",
    proxy: "ai-proxy/src/lib/caller-fingerprint.ts",
    proxyHeaderLines: 2,
  },
  {
    app: "src/lib/mcp-tool-governance.ts",
    proxy: "ai-proxy/src/lib/mcp-tool-governance.ts",
    // The proxy copy opens with a two-line "MIRROR of ..." banner.
    proxyHeaderLines: 2,
  },
  {
    app: "src/lib/agent-runtime-gate.ts",
    proxy: "ai-proxy/src/lib/agent-runtime-gate.ts",
    proxyHeaderLines: 2,
  },
  {
    app: "src/lib/human-review-triggers.ts",
    proxy: "ai-proxy/src/lib/human-review-triggers.ts",
    proxyHeaderLines: 2,
  },
  {
    app: "src/lib/review-fingerprint.ts",
    proxy: "ai-proxy/src/lib/review-fingerprint.ts",
    proxyHeaderLines: 2,
  },
];

const errors = [];
for (const { app, proxy, proxyHeaderLines = 0 } of MIRRORS) {
  let appSrc;
  let proxySrc;
  try {
    appSrc = readFileSync(join(root, app), "utf8");
    proxySrc = readFileSync(join(root, proxy), "utf8");
  } catch (err) {
    errors.push(`${app} ↔ ${proxy}: ${err.message}`);
    continue;
  }
  const proxyBody = proxySrc.split("\n").slice(proxyHeaderLines).join("\n");
  if (appSrc !== proxyBody) {
    const appLines = appSrc.split("\n");
    const proxyLines = proxyBody.split("\n");
    let line = 0;
    while (line < appLines.length && appLines[line] === proxyLines[line]) line++;
    errors.push(
      `${app} ↔ ${proxy}: differ at ${app}:${line + 1} (proxy line ${line + 1 + proxyHeaderLines})`
    );
  }
}

if (errors.length) {
  console.error("Mirror drift detected between the app and ai-proxy copies:\n");
  for (const err of errors) console.error(`  ✗ ${err}`);
  console.error("\nCopy the app file over the proxy copy (keeping the proxy banner where one exists).");
  process.exit(1);
}
console.log(`Mirror drift check passed: ${MIRRORS.length} mirrored modules identical.`);
