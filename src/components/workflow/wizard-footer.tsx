"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WizardFooterProps {
  onBack?: () => void;
  onSkip?: () => void;
  onNext: () => void;
  nextLabel?: string;
  saving?: boolean;
  error?: string | null;
  /** Shown beside the buttons, e.g. "Saved". */
  status?: string | null;
  nextDisabled?: boolean;
}

export function WizardFooter({
  onBack,
  onSkip,
  onNext,
  nextLabel = "Save & continue",
  saving,
  error,
  status,
  nextDisabled,
}: WizardFooterProps) {
  return (
    <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
      {error && (
        <div
          role="alert"
          className="rounded-md bg-[var(--critical-dim)] p-3 text-sm text-[var(--critical-strong)]"
        >
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {onBack && (
            <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {status && !error && (
            <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
              {status}
            </span>
          )}
          {onSkip && (
            <Button type="button" variant="outline" onClick={onSkip} disabled={saving}>
              Skip for now
            </Button>
          )}
          <Button type="button" onClick={onNext} disabled={saving || nextDisabled}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : nextLabel}
            {!saving && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
