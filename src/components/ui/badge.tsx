import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]",
        critical: "bg-[var(--critical-dim)] text-[var(--critical)] border border-red-500/20",
        high: "bg-[var(--high-dim)] text-[var(--high)] border border-orange-500/20",
        medium: "bg-[var(--medium-dim)] text-[var(--medium)] border border-yellow-500/20",
        low: "bg-[var(--low-dim)] text-[var(--low)] border border-green-500/20",
        minimal: "bg-[var(--minimal-dim)] text-[var(--minimal)] border border-sky-500/20",
        success: "bg-[var(--success-dim)] text-[var(--success)] border border-emerald-500/20",
        warning: "bg-[var(--warning-dim)] text-[var(--warning)] border border-amber-500/20",
        info: "bg-[var(--info-dim)] text-[var(--info)] border border-indigo-500/20",
        outline: "border border-[var(--border-default)] text-[var(--text-muted)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export function riskBadgeVariant(
  level: string
): VariantProps<typeof badgeVariants>["variant"] {
  const map: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
    MINIMAL: "minimal",
  };
  return map[level] ?? "default";
}

export function statusBadgeVariant(
  status: string
): VariantProps<typeof badgeVariants>["variant"] {
  const map: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
    DRAFT: "default",
    UNDER_REVIEW: "warning",
    APPROVED: "success",
    DEPLOYED: "info",
    DEPRECATED: "high",
    RETIRED: "outline",
    COMPLIANT: "success",
    PARTIALLY_COMPLIANT: "warning",
    NON_COMPLIANT: "critical",
    NOT_ASSESSED: "default",
    OPEN: "critical",
    ACKNOWLEDGED: "warning",
    RESOLVED: "success",
    DISMISSED: "outline",
    DISCOVERED: "warning",
    REGISTERED: "success",
    BLOCKED: "critical",
    CHANGES_REQUESTED: "warning",
    REVOKED: "critical",
  };
  return map[status] ?? "default";
}
