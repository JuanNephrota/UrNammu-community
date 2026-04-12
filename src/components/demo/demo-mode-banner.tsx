import { FlaskConical, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function DemoModeBanner() {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
        <Badge variant="warning" className="gap-1">
          <FlaskConical className="h-3 w-3" />
          Demo Mode
        </Badge>
        <span className="text-amber-50/90">
          This workspace is running with seeded sample data for exploration. External integrations are optional in this mode.
        </span>
        <span className="inline-flex items-center gap-1 text-amber-200/90">
          <Sparkles className="h-3 w-3" />
          Safe for screenshots and evaluation
        </span>
      </div>
    </div>
  );
}
