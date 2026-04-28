import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-in-up",
        className
      )}
    >
      <div>
        <h1
          className="text-2xl font-bold tracking-tight text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
