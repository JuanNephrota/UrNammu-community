"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type UsageLog = {
  id: string;
  provider: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  flagReason: string | null;
  createdAt: string;
  user: { name: string | null; email: string } | null;
};

export function RelatedUsageLogs({ alertId }: { alertId: string }) {
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetchLogs = useCallback(() => {
    if (fetched || loading) return;
    setLoading(true);
    fetch(`/api/alerts/${alertId}/usage-logs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLogs(data);
        setFetched(true);
      })
      .catch((err) => console.error("Failed to fetch related usage logs:", err))
      .finally(() => setLoading(false));
  }, [fetched, loading, alertId]);

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !fetched) fetchLogs();
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Related API Usage Logs
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {loading && (
            <p className="text-xs text-[var(--text-faint)]">Loading...</p>
          )}
          {!loading && logs.length === 0 && fetched && (
            <p className="text-xs text-[var(--text-faint)]">No related flagged usage logs found within the time window.</p>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline">{log.provider}</Badge>
                {log.model && <span className="text-xs text-[var(--text-muted)] truncate">{log.model}</span>}
                {log.user && (
                  <span className="text-xs text-[var(--text-faint)]">
                    {log.user.name ?? log.user.email}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] shrink-0">
                <span>{log.totalTokens.toLocaleString()} tokens</span>
                <span>${log.cost.toFixed(4)}</span>
                <span className="text-[var(--text-faint)]">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
