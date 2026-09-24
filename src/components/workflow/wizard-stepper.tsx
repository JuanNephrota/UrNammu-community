"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardStep } from "@/lib/workflow";

interface WizardStepperProps {
  steps: readonly WizardStep[];
  currentStepId: string;
  completedStepIds: ReadonlySet<string>;
  /** Omit to render a non-interactive stepper. */
  onSelect?: (stepId: string) => void;
  disabled?: boolean;
}

export function WizardStepper({
  steps,
  currentStepId,
  completedStepIds,
  onSelect,
  disabled,
}: WizardStepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentStepId)
  );
  const current = steps[currentIndex];

  return (
    <nav aria-label="Progress" className="@container space-y-3">
      {/* Compact summary for narrow screens */}
      <div className="flex items-center justify-between text-sm @4xl:hidden">
        <span className="font-medium text-[var(--text-primary)]">{current.label}</span>
        <span className="text-[var(--text-muted)]">
          Step {currentIndex + 1} of {steps.length}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)] @4xl:hidden">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all"
          style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }}
        />
      </div>

      <ol className="hidden @4xl:flex @4xl:items-start @4xl:gap-1">
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStepId;
          const isComplete = completedStepIds.has(step.id) && !isCurrent;
          const clickable = Boolean(onSelect) && !disabled && !isCurrent;

          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-start gap-2">
              <button
                type="button"
                onClick={clickable ? () => onSelect?.(step.id) : undefined}
                disabled={!clickable}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Step ${index + 1}: ${step.label}${isComplete ? " (complete)" : ""}`}
                className={cn(
                  "group flex min-w-0 flex-1 items-start gap-3 rounded-lg p-2 text-left transition-colors",
                  clickable && "hover:bg-[var(--bg-hover)]",
                  !clickable && "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                    isCurrent &&
                      "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]",
                    isComplete &&
                      "border-[var(--success-border)] bg-[var(--success-dim)] text-[var(--success-strong)]",
                    !isCurrent &&
                      !isComplete &&
                      "border-[var(--border-default)] text-[var(--text-faint)]"
                  )}
                >
                  {isComplete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      isCurrent ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    )}
                  >
                    {step.label}
                  </span>
                  {step.description && (
                    <span className="hidden truncate text-xs text-[var(--text-faint)] @6xl:block">
                      {step.description}
                    </span>
                  )}
                </span>
              </button>
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mt-5 hidden h-px w-4 shrink-0 @6xl:block",
                    completedStepIds.has(step.id)
                      ? "bg-[var(--success-border)]"
                      : "bg-[var(--border-subtle)]"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
