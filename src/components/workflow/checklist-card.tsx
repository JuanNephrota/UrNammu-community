import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checklistProgress, type ChecklistItem } from "@/lib/workflow";

interface ChecklistCardProps {
  title: string;
  description?: string;
  items: ChecklistItem[];
  /** Hide the "do next" links, e.g. for read-only viewers. */
  readOnly?: boolean;
  completeMessage?: string;
}

export function ChecklistCard({
  title,
  description,
  items,
  readOnly,
  completeMessage = "Everything on this checklist is done.",
}: ChecklistCardProps) {
  const progress = checklistProgress(items);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          <Badge variant={progress.complete ? "success" : "info"}>
            {progress.done} of {progress.total} done
          </Badge>
        </div>
        {description && <p className="text-sm text-[var(--text-muted)]">{description}</p>}
        <div
          className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${title} progress`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              progress.complete ? "bg-[var(--success)]" : "bg-[var(--accent)]"
            )}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {progress.complete ? (
          <p className="text-sm text-[var(--success-strong)]">{completeMessage}</p>
        ) : (
          progress.next &&
          !readOnly &&
          progress.next.href && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-faint)] p-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                  Next step
                </p>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {progress.next.label}
                </p>
              </div>
              <Link href={progress.next.href} className={buttonVariants({ size: "sm" })}>
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )
        )}

        <ul className="space-y-1">
          {items.map((item) => {
            const content = (
              <>
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    item.done
                      ? "bg-[var(--success-dim)] text-[var(--success-strong)]"
                      : "text-[var(--text-faint)]"
                  )}
                >
                  {item.done ? <Check className="h-3 w-3" /> : <Circle className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm",
                      item.done ? "text-[var(--text-muted)]" : "font-medium text-[var(--text-primary)]"
                    )}
                  >
                    {item.label}
                    {item.optional && (
                      <span className="ml-2 text-xs font-normal text-[var(--text-faint)]">
                        Optional
                      </span>
                    )}
                  </span>
                  {item.detail && (
                    <span className="block text-xs text-[var(--text-faint)]">{item.detail}</span>
                  )}
                </span>
                {!item.done && item.href && !readOnly && (
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-faint)] group-hover:text-[var(--accent)]" />
                )}
              </>
            );

            return (
              <li key={item.id}>
                {item.href && !readOnly && !item.done ? (
                  <Link
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
