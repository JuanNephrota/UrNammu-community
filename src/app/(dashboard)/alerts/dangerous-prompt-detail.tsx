"use client";

import { useMemo, useState } from "react";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Copy, Check, Fingerprint } from "lucide-react";

/**
 * Investigation-oriented view for a dangerous_prompt alert. Renders:
 *   - Per-rule breakdown (which rule fired, at what severity, with which signals)
 *   - The sanitized prompt excerpt with the matched substrings inline-highlighted
 *   - A toggle to expand from short excerpt to the longer sanitized text
 *   - Copy-to-clipboard on signals and excerpt for evidence capture
 *   - Cross-surface correlation: "Seen N times across …" when the same prompt
 *     (by salted hash) recurred while the alert was open, and the other alerts
 *     that carry the same hash
 *
 * Backward-compatible: if `ruleMatches` or `fullExcerpt` are missing (historical
 * alerts written before the per-rule metadata shipped), falls back to the flat
 * `categories` / `matchedSignals` / `excerpt` legacy fields; alerts without a
 * hash simply omit the correlation block.
 */

type RuleMatch = {
  key: string;
  label: string;
  severity: "critical" | "warning";
  signals: string[];
};

/** Another alert carrying the same prompt hash — plain data, server-formatted. */
export type RelatedPromptAlertView = {
  id: string;
  title: string;
  severity: string;
  status: string;
  createdAtLabel: string;
  provider: string | null;
  userEmail: string | null;
  occurrences: number;
};

type Props = {
  categories?: string[];
  ruleKeys?: string[];
  matchedSignals?: string[];
  ruleMatches?: RuleMatch[];
  excerpt?: string | null;
  fullExcerpt?: string | null;
  promptHash?: string | null;
  occurrences?: number;
  surfaces?: string[];
  actors?: string[];
  relatedAlerts?: RelatedPromptAlertView[];
};

const SURFACE_LABELS: Record<string, string> = {
  proxy: "API proxy",
  azure_proxy: "API proxy (Azure)",
  claude_code: "Claude Code",
  cursor: "Cursor",
};

function surfaceLabel(surface: string): string {
  return SURFACE_LABELS[surface] ?? surface;
}

const CRITICAL_RULE_KEYS = new Set([
  "secret_extraction",
  "data_exfiltration",
  "malware_or_phishing",
  "sensitive_data_in_prompt",
]);

/**
 * Given a text and the matched signal substrings, return a list of segments
 * where each segment is either plain text or a highlighted match. Handles
 * overlapping/duplicate signals by finding all occurrences of any signal and
 * merging overlaps into a single highlighted span.
 */
function splitHighlights(
  text: string,
  signals: string[]
): Array<{ text: string; highlighted: boolean; ruleKey?: string }> {
  if (!signals.length) return [{ text, highlighted: false }];

  const lower = text.toLowerCase();
  const spans: Array<{ start: number; end: number }> = [];
  for (const signal of signals) {
    if (!signal) continue;
    const needle = signal.toLowerCase();
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      spans.push({ start: idx, end: idx + signal.length });
      idx = lower.indexOf(needle, idx + 1);
    }
  }

  if (spans.length === 0) return [{ text, highlighted: false }];

  // Merge overlapping spans.
  spans.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const span of merged) {
    if (cursor < span.start) {
      segments.push({ text: text.slice(cursor, span.start), highlighted: false });
    }
    segments.push({ text: text.slice(span.start, span.end), highlighted: true });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }
  return segments;
}

function SignalChip({ signal }: { signal: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={() => {
        void navigator.clipboard.writeText(signal).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="group inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-0.5 font-mono text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
    >
      <span>{signal}</span>
      {copied ? (
        <Check className="h-3 w-3 text-[var(--success)]" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-70" />
      )}
    </button>
  );
}

export function DangerousPromptDetail({
  categories = [],
  ruleKeys = [],
  matchedSignals = [],
  ruleMatches,
  excerpt,
  fullExcerpt,
  promptHash,
  occurrences = 1,
  surfaces = [],
  actors = [],
  relatedAlerts = [],
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [excerptCopied, setExcerptCopied] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);

  const repeated = occurrences > 1;
  const showCorrelation = !!promptHash && (repeated || relatedAlerts.length > 0);

  // Reconstruct per-rule grouping from legacy flat fields when ruleMatches
  // is absent on older alert records.
  const effectiveRuleMatches: RuleMatch[] = useMemo(() => {
    if (ruleMatches && ruleMatches.length > 0) return ruleMatches;
    return categories.map((label, i) => ({
      key: ruleKeys[i] ?? `legacy_${i}`,
      label,
      severity: CRITICAL_RULE_KEYS.has(ruleKeys[i] ?? "") ? "critical" : "warning",
      signals: [],
    }));
  }, [ruleMatches, categories, ruleKeys]);

  const displayExcerpt = expanded ? fullExcerpt ?? excerpt ?? null : excerpt ?? null;
  const canExpand = !!fullExcerpt && !!excerpt && fullExcerpt.length > excerpt.length;

  // Collect all signals across all rules for inline highlighting of the excerpt.
  const allSignals = useMemo(() => {
    if (effectiveRuleMatches.some((rm) => rm.signals.length > 0)) {
      return effectiveRuleMatches.flatMap((rm) => rm.signals);
    }
    return matchedSignals; // legacy fallback
  }, [effectiveRuleMatches, matchedSignals]);

  const segments = useMemo(
    () => (displayExcerpt ? splitHighlights(displayExcerpt, allSignals) : []),
    [displayExcerpt, allSignals]
  );

  return (
    <div className="space-y-4">
      {/* Cross-surface correlation */}
      {showCorrelation && (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-3.5 w-3.5 text-[var(--accent)]" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                Same prompt, other sightings
              </p>
            </div>
            <button
              type="button"
              title="Copy prompt hash"
              onClick={() => {
                void navigator.clipboard.writeText(promptHash ?? "").then(() => {
                  setHashCopied(true);
                  setTimeout(() => setHashCopied(false), 1200);
                });
              }}
              className="flex items-center gap-1 font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              {promptHash?.slice(0, 12)}…
              {hashCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>

          {repeated && (
            <p className="text-sm text-[var(--text-primary)]">
              Seen <span className="font-semibold">{occurrences}</span> times
              {surfaces.length > 0 && (
                <>
                  {" "}across{" "}
                  <span className="text-[var(--text-secondary)]">
                    {surfaces.map(surfaceLabel).join(", ")}
                  </span>
                </>
              )}
              {actors.length > 0 && (
                <span className="text-[var(--text-muted)]">
                  {" "}· {actors.length === 1 ? "1 person" : `${actors.length} people`}
                </span>
              )}
            </p>
          )}

          {actors.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {actors.map((actor) => (
                <span
                  key={actor}
                  className="rounded border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                >
                  {actor}
                </span>
              ))}
            </div>
          )}

          {relatedAlerts.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                Other alerts with this prompt ({relatedAlerts.length})
              </p>
              <ul className="space-y-1">
                {relatedAlerts.map((related) => (
                  <li key={related.id}>
                    <a
                      href={`#alert-${related.id}`}
                      className="flex flex-wrap items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-[var(--bg-elevated)]"
                    >
                      <Badge variant={riskBadgeVariant(related.severity)}>{related.severity}</Badge>
                      <Badge variant={statusBadgeVariant(related.status)}>{related.status}</Badge>
                      <span className="text-[var(--text-muted)]">{related.createdAtLabel}</span>
                      {related.provider && (
                        <span className="text-[var(--text-secondary)]">{related.provider}</span>
                      )}
                      {related.userEmail && (
                        <span className="text-[var(--text-muted)]">{related.userEmail}</span>
                      )}
                      {related.occurrences > 1 && (
                        <span className="text-[var(--text-faint)]">×{related.occurrences}</span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Per-rule breakdown */}
      {effectiveRuleMatches.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Triggered Rules ({effectiveRuleMatches.length})
          </p>
          <div className="space-y-2">
            {effectiveRuleMatches.map((rule) => (
              <div
                key={rule.key}
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={rule.severity === "critical" ? "critical" : "warning"}>
                      {rule.severity}
                    </Badge>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {rule.label}
                    </span>
                  </div>
                  <code className="text-[10px] text-[var(--text-faint)]">{rule.key}</code>
                </div>
                {rule.signals.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                      Matched on
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {rule.signals.map((signal, i) => (
                        <SignalChip key={`${rule.key}-${i}`} signal={signal} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Highlighted excerpt */}
      {displayExcerpt && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Prompt Excerpt (sanitized)
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const text = fullExcerpt ?? excerpt ?? "";
                  void navigator.clipboard.writeText(text).then(() => {
                    setExcerptCopied(true);
                    setTimeout(() => setExcerptCopied(false), 1200);
                  });
                }}
                className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)]"
                title="Copy full excerpt"
              >
                {excerptCopied ? (
                  <>
                    <Check className="h-3 w-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy
                  </>
                )}
              </button>
              {canExpand && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto px-2 py-0.5 text-[10px]"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="mr-1 h-3 w-3" /> Collapse
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-1 h-3 w-3" /> Show full
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
          <pre
            className={`rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-words overflow-y-auto ${
              expanded ? "max-h-96" : "max-h-32"
            }`}
          >
            {segments.length > 0
              ? segments.map((seg, i) =>
                  seg.highlighted ? (
                    <mark
                      key={i}
                      className="rounded px-0.5"
                      style={{
                        background: "rgba(239, 68, 68, 0.2)",
                        color: "var(--text-primary)",
                        boxShadow: "inset 0 -1px 0 rgba(239, 68, 68, 0.6)",
                      }}
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )
              : displayExcerpt}
          </pre>
        </div>
      )}
    </div>
  );
}
