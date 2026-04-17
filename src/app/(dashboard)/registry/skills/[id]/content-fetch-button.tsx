"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  skillId: string;
}

type ContentResponse = {
  id: string;
  file_name: string | null;
  file_size_bytes: number | null;
  file_type: string | null;
  content_url: string | null;
  expires_at: string | null;
};

/**
 * Fetches a short-lived signed URL from the Forge API (via our server
 * endpoint) and surfaces it to the user. Client fetches bytes directly;
 * we deliberately never stream file content through our server.
 */
export function ContentFetchButton({ skillId }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/registry/skills/${skillId}/content`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        setData(body);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={handleFetch} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {loading ? "Fetching…" : "Fetch signed URL"}
        </Button>
        <span className="text-xs text-[var(--text-muted)]">
          15-minute TTL — expires quickly, so download promptly.
        </span>
      </div>

      {error ? (
        <p className="text-xs text-[var(--critical)]">{error}</p>
      ) : null}

      {data?.content_url ? (
        <div
          className="rounded-lg border p-3 text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--bg-base)",
          }}
        >
          <p className="font-medium mb-1">
            {data.file_name ?? "Signed URL"}
            {data.file_size_bytes != null
              ? ` · ${(data.file_size_bytes / 1024).toFixed(1)} KB`
              : ""}
          </p>
          <a
            href={data.content_url}
            className="break-all text-[var(--accent)] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {data.content_url}
          </a>
          {data.expires_at ? (
            <p className="mt-1 text-[var(--text-faint)]">
              Expires: {new Date(data.expires_at).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
