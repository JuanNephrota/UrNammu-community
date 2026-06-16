"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface SystemLifecycleActionsProps {
  systemId: string;
  systemName: string;
  status: string;
}

export function SystemLifecycleActions({
  systemId,
  systemName,
  status,
}: SystemLifecycleActionsProps) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isArchived = status === "RETIRED";
  const canDelete = deleteConfirmation.trim() === systemName;

  async function handleArchive() {
    setArchiveLoading(true);
    setArchiveError(null);

    try {
      const response = await fetch(`/api/ai-systems/${systemId}/archive`, {
        method: "POST",
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to archive service");
      }

      setArchiveOpen(false);
      router.refresh();
    } catch (error) {
      setArchiveError(
        error instanceof Error ? error.message : "Failed to archive service"
      );
    } finally {
      setArchiveLoading(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/ai-systems/${systemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: deleteConfirmation.trim() }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete service");
      }

      setDeleteOpen(false);
      router.push("/registry");
      router.refresh();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete service"
      );
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog
        open={archiveOpen}
        onOpenChange={(open) => {
          setArchiveOpen(open);
          if (!open) setArchiveError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" disabled={isArchived}>
            <Archive className="mr-2 h-4 w-4" />
            {isArchived ? "Archived" : "Archive"}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive Service</DialogTitle>
            <DialogDescription>
              Archiving keeps <span className="font-medium text-[var(--text-primary)]">{systemName}</span> in the registry for audit history, but marks it as no longer in use.
            </DialogDescription>
          </DialogHeader>

          {archiveError ? (
            <div className="rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">
              {archiveError}
            </div>
          ) : null}

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">
            This action sets the service status to <span className="font-medium text-[var(--text-primary)]">Retired</span>. The record, audit history, assessments, and related governance data stay available.
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchiveOpen(false)}
              disabled={archiveLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleArchive}
              disabled={archiveLoading}
            >
              {archiveLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {archiveLoading ? "Archiving..." : "Archive Service"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setDeleteError(null);
            setDeleteConfirmation("");
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Service</DialogTitle>
            <DialogDescription>
              Use permanent deletion only for mistakes like duplicate or erroneous services. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError ? (
            <div className="rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">
              {deleteError}
            </div>
          ) : null}

          <div className="space-y-3 rounded-lg border border-[var(--critical)]/40 bg-[var(--critical)]/5 p-4 text-sm">
            <p className="text-[var(--text-primary)]">
              Type <span className="font-semibold">{systemName}</span> to confirm permanent deletion.
            </p>
            <Input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder={systemName}
              autoComplete="off"
            />
            <p className="text-xs text-[var(--text-muted)]">
              Deletion removes the service record and its directly attached governance history. Linked agents, discoveries, usage attribution, and audit references are detached instead of deleted.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteLoading || !canDelete}
            >
              {deleteLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deleteLoading ? "Deleting..." : "Delete Permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
