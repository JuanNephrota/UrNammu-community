"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface Props {
  bucketIds: string[];
  label: string;
  bucketCount: number;
  tokenCount: number;
}

interface AISystem {
  id: string;
  name: string;
  vendor: string | null;
  department: string;
  status: string;
}

export function LinkUsageDialog({ bucketIds, label, bucketCount, tokenCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/ai-systems")
      .then((res) => res.json())
      .then((data) => setSystems(Array.isArray(data) ? data : []))
      .catch(() => setSystems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = systems.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.vendor ?? "").toLowerCase().includes(search.toLowerCase()) ||
      s.department.toLowerCase().includes(search.toLowerCase())
  );

  async function handleLink(systemId: string) {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch("/api/usage-buckets/attribute", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketIds, aiSystemId: systemId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link usage");
    } finally {
      setLinking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 className="mr-1.5 h-3 w-3" />
          Link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Usage to AI System</DialogTitle>
          <DialogDescription>
            Attribute {bucketCount} usage {bucketCount === 1 ? "bucket" : "buckets"} ({(tokenCount / 1000).toFixed(0)}k tokens) from &ldquo;{label}&rdquo; to a registered AI system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-faint)]" />
            <Input
              placeholder="Search systems by name, vendor, or department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">
              {systems.length === 0 ? "No AI systems registered yet." : "No systems match your search."}
            </p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {filtered.map((system) => (
                <button
                  key={system.id}
                  onClick={() => handleLink(system.id)}
                  disabled={linking}
                  className="w-full flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 text-left transition-all hover:bg-[var(--bg-surface)] hover:border-[var(--accent)] disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{system.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {system.department}
                      {system.vendor && ` · ${system.vendor}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize shrink-0">
                    {system.status.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="text-[11px] text-[var(--critical)]">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
