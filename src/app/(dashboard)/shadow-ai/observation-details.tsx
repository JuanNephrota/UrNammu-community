"use client";

import { useState } from "react";
import { Clock, Users, KeyRound, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatDepartmentRollup, type DepartmentRollup } from "@/lib/directory-identity";

const PREVIEW_LIMIT = 5;

/**
 * Structured observation detail for a discovered tool: when it was first and
 * last seen, which users were observed, and which OAuth scopes were granted.
 * Renders nothing when the row carries none of these (e.g. legacy rows from
 * before these columns existed, or manual reports).
 */
export function ObservationDetails({
  firstSeenAt,
  lastSeenAt,
  userEmails,
  scopes,
  departmentRollup,
}: {
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  userEmails?: string[] | null;
  scopes?: string[] | null;
  /** Users grouped by directory department (from the identity-provider directory sync). */
  departmentRollup?: DepartmentRollup | null;
}) {
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [showScopes, setShowScopes] = useState(false);

  const emails = userEmails ?? [];
  const scopeList = scopes ?? [];
  const hasWindow = Boolean(firstSeenAt || lastSeenAt);

  if (!hasWindow && emails.length === 0 && scopeList.length === 0) return null;

  const visibleEmails = showAllUsers ? emails : emails.slice(0, PREVIEW_LIMIT);
  const hiddenEmailCount = emails.length - visibleEmails.length;
  const departmentLabel =
    departmentRollup && departmentRollup.entries.length > 0
      ? formatDepartmentRollup(departmentRollup)
      : null;

  return (
    <div className="space-y-1.5 text-xs">
      {hasWindow && (
        <p className="flex items-center gap-1.5 text-[var(--text-faint)]">
          <Clock className="h-3 w-3 shrink-0" />
          <span>
            {firstSeenAt && <>First seen {formatDate(firstSeenAt)}</>}
            {firstSeenAt && lastSeenAt && <> &middot; </>}
            {lastSeenAt && <>Last seen {formatDate(lastSeenAt)}</>}
          </span>
        </p>
      )}

      {emails.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[var(--text-faint)]">
            <Users className="h-3 w-3 shrink-0" />
            {emails.length} user{emails.length === 1 ? "" : "s"}:
          </span>
          {visibleEmails.map((email) => (
            <code
              key={email}
              className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
            >
              {email}
            </code>
          ))}
          {hiddenEmailCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllUsers(true)}
              className="text-[11px] text-[var(--accent)] hover:underline"
            >
              +{hiddenEmailCount} more
            </button>
          )}
          {showAllUsers && emails.length > PREVIEW_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllUsers(false)}
              className="text-[var(--text-faint)] text-[11px] hover:underline"
            >
              show fewer
            </button>
          )}
        </div>
      )}

      {departmentLabel && (
        <p
          className="flex items-center gap-1.5 text-[var(--text-faint)]"
          title={
            departmentRollup && departmentRollup.unmatched > 0
              ? `${departmentRollup.unmatched} user${departmentRollup.unmatched === 1 ? "" : "s"} not matched to a directory department`
              : "Users by department, from the identity-provider directory sync"
          }
        >
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="text-[var(--text-secondary)]">{departmentLabel}</span>
          {departmentRollup && departmentRollup.unmatched > 0 && (
            <span>· {departmentRollup.unmatched} unmatched</span>
          )}
        </p>
      )}

      {scopeList.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowScopes((value) => !value)}
            aria-expanded={showScopes}
            className="flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
          >
            {showScopes ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <KeyRound className="h-3 w-3 shrink-0" />
            {scopeList.length} OAuth scope{scopeList.length === 1 ? "" : "s"}
          </button>
          {showScopes && (
            <ul className="ml-4 space-y-0.5">
              {scopeList.map((scope) => (
                <li key={scope}>
                  <code className="break-all text-[11px] text-[var(--text-secondary)]">{scope}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
