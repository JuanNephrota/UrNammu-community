"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  Check,
  CircleAlert,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Users,
  UserX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export type DirectorySyncSourceId = "google_workspace" | "microsoft_365";

export interface DirectorySyncCardData {
  source: DirectorySyncSourceId;
  label: string;
  configured: boolean;
  /** Effective enabled flag (saved value, env fallback, or built-in default false). */
  enabled: boolean;
  /** Effective interval in hours (default 24). */
  intervalHours: number;
  nextDueAt: string | null;
  skippedReason: string | null;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    counts: {
      fetched: number;
      created: number;
      updated: number;
      deactivated: number;
      usersSuspended: number;
      pages: number;
      truncated: boolean;
    } | null;
  } | null;
  people: { active: number; deactivated: number };
}

const INTERVAL_OPTIONS = [6, 12, 24, 48, 168];

const SOURCE_HELP: Record<
  DirectorySyncSourceId,
  { credentials: string; permission: string; short: string }
> = {
  google_workspace: {
    short: "Google Workspace",
    credentials: "Reuses the Google Workspace service account and admin email from Settings → Shadow AI.",
    permission:
      "The service account's domain-wide delegation grant must include https://www.googleapis.com/auth/admin.directory.user.readonly.",
  },
  microsoft_365: {
    short: "Microsoft 365",
    credentials: "Reuses the Microsoft 365 tenant app (tenant ID, client ID, client secret) from Settings → Shadow AI.",
    permission: "The app registration needs the Microsoft Graph application permission User.Read.All with admin consent.",
  },
};

/**
 * One card per identity source: enabled toggle, interval, last run summary,
 * people counts, and a Sync now button. Settings are saved through
 * PUT /api/settings as `directory_sync_<source>_enabled` /
 * `directory_sync_<source>_interval_hours`; Sync now calls
 * POST /api/directory-sync and refreshes the page.
 */
export function DirectorySyncSettings({
  sources,
  includeGuests: initialIncludeGuests,
}: {
  sources: DirectorySyncCardData[];
  includeGuests: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--accent)]" />
          Directory sync
        </CardTitle>
        <CardDescription>
          Pull the people directory from your identity provider so Usage by Person folds email aliases onto one
          person, names and departments stop being hand-typed, Shadow AI can roll users up by department, and
          leavers are suspended here and flagged if they keep using AI. Both syncs are off until you enable them.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        {sources.map((source) => (
          <DirectorySourceCard key={source.source} data={source} initialIncludeGuests={initialIncludeGuests} />
        ))}
      </CardContent>
    </Card>
  );
}

function DirectorySourceCard({
  data,
  initialIncludeGuests,
}: {
  data: DirectorySyncCardData;
  initialIncludeGuests: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(data.enabled);
  const [intervalHours, setIntervalHours] = useState(data.intervalHours);
  const [includeGuests, setIncludeGuests] = useState(initialIncludeGuests);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const help = SOURCE_HELP[data.source];
  const dirty =
    enabled !== data.enabled ||
    intervalHours !== data.intervalHours ||
    (data.source === "microsoft_365" && includeGuests !== initialIncludeGuests);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const updates: Record<string, string | null> = {
        [`directory_sync_${data.source}_enabled`]: enabled ? "true" : "false",
        [`directory_sync_${data.source}_interval_hours`]: String(intervalHours),
      };
      if (data.source === "microsoft_365") {
        updates.directory_sync_include_guests = includeGuests ? "true" : "false";
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setMessage({ ok: true, text: "Saved." });
        router.refresh();
      } else {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          msg = text || msg;
        }
        setMessage({ ok: false, text: `Failed to save: ${msg}` });
      }
    } catch (err) {
      setMessage({ ok: false, text: `Failed to save: ${err instanceof Error ? err.message : "Network error"}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/directory-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: data.source }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        success?: boolean;
        fetched?: number;
        created?: number;
        updated?: number;
        deactivated?: number;
        usersSuspended?: number;
        truncated?: boolean;
      };
      if (!res.ok || payload.success === false) {
        setMessage({
          ok: false,
          text: payload.details ? `${payload.error}: ${payload.details}` : payload.error ?? `HTTP ${res.status}`,
        });
      } else {
        setMessage({
          ok: true,
          text:
            `Synced ${payload.fetched ?? 0} people — ${payload.created ?? 0} new, ${payload.updated ?? 0} updated, ` +
            `${payload.deactivated ?? 0} deactivated` +
            (payload.usersSuspended ? `, ${payload.usersSuspended} UrNammu user(s) suspended` : "") +
            (payload.truncated ? ". Listing hit the page cap; deactivation was skipped this run." : "."),
        });
      }
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: `Sync failed: ${err instanceof Error ? err.message : "Network error"}` });
    } finally {
      setSyncing(false);
    }
  }

  const lastRun = data.lastRun;
  const lastRunOk = lastRun?.status === "SUCCEEDED";
  const totalPeople = data.people.active + data.people.deactivated;

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Building2 className="h-4 w-4 text-[var(--accent)]" />
            {data.label}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{help.credentials}</p>
        </div>
        {data.configured ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--success)]">
            <Wifi className="h-3 w-3" /> Credentials ready
          </span>
        ) : (
          <Link
            href="/settings/shadow-ai"
            className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--warning)] hover:underline"
          >
            <WifiOff className="h-3 w-3" /> Configure {help.short}
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">People</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-primary)]">{totalPeople}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Active</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--success)]">{data.people.active}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
            <UserX className="h-3 w-3" /> Deactivated
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-secondary)]">
            {data.people.deactivated}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2 text-xs">
            <Calendar className="h-3.5 w-3.5" />
            Auto-sync
          </Label>
          <select
            value={enabled ? "true" : "false"}
            onChange={(e) => setEnabled(e.target.value === "true")}
            className="flex h-9 w-full appearance-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)]"
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5" />
            Interval
          </Label>
          <select
            value={String(intervalHours)}
            onChange={(e) => setIntervalHours(parseInt(e.target.value, 10))}
            className="flex h-9 w-full appearance-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)]"
          >
            {(INTERVAL_OPTIONS.includes(intervalHours) ? INTERVAL_OPTIONS : [...INTERVAL_OPTIONS, intervalHours].sort((a, b) => a - b)).map(
              (hours) => (
                <option key={hours} value={String(hours)}>
                  {hours === 168 ? "Weekly" : `Every ${hours} hours`}
                </option>
              )
            )}
          </select>
        </div>
        {data.source === "microsoft_365" && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="flex items-center gap-2 text-xs">
              <Users className="h-3.5 w-3.5" />
              Guest accounts
            </Label>
            <select
              value={includeGuests ? "true" : "false"}
              onChange={(e) => setIncludeGuests(e.target.value === "true")}
              className="flex h-9 w-full appearance-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)]"
            >
              <option value="false">Skip guests (#EXT# in the UPN)</option>
              <option value="true">Include guests</option>
            </select>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">{help.permission}</p>

      <div className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Last run</p>
        {lastRun ? (
          <div className="mt-1 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
              <Badge variant={lastRunOk ? "success" : lastRun.status === "RUNNING" ? "info" : "critical"} className="text-[10px]">
                {lastRun.status.toLowerCase()}
              </Badge>
              <span>{formatDateTime(lastRun.completedAt ?? lastRun.startedAt)}</span>
              {lastRun.counts && (
                <span className="text-[var(--text-muted)]">
                  {lastRun.counts.fetched} fetched · {lastRun.counts.created} new · {lastRun.counts.updated} updated ·{" "}
                  {lastRun.counts.deactivated} deactivated
                  {lastRun.counts.usersSuspended > 0 ? ` · ${lastRun.counts.usersSuspended} suspended` : ""}
                  {lastRun.counts.truncated ? " · truncated" : ""}
                </span>
              )}
            </p>
            {lastRun.errorMessage && (
              <p className="flex items-start gap-1.5 text-[var(--critical)]">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="break-words">{lastRun.errorMessage}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-[var(--text-muted)]">Never run.</p>
        )}
        <p className="mt-1 text-[var(--text-faint)]">
          {data.enabled
            ? data.nextDueAt
              ? `Next due ${formatDateTime(data.nextDueAt)}.`
              : data.skippedReason ?? "Due on the next daily cron tick."
            : "Auto-sync is off; use Sync now to run once."}
        </p>
      </div>

      {message && (
        <p
          className={`flex items-start gap-1.5 text-xs ${message.ok ? "text-[var(--success)]" : "text-[var(--critical)]"}`}
        >
          {message.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
          <span className="break-words">{message.text}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={handleSyncNow} disabled={syncing || !data.configured}>
          {syncing ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>
    </div>
  );
}
