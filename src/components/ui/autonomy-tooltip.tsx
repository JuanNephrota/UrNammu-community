"use client";

import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

const AUTONOMY_LEVELS: Record<string, { label: string; description: string; risk: string }> = {
  MANUAL: {
    label: "Manual",
    description: "Agent performs no actions on its own. A human initiates and executes every step.",
    risk: "Lowest risk",
  },
  HUMAN_IN_THE_LOOP: {
    label: "Human in the Loop",
    description: "Agent proposes actions but requires explicit human approval before each execution.",
    risk: "Low risk",
  },
  HUMAN_ON_THE_LOOP: {
    label: "Human on the Loop",
    description: "Agent executes actions autonomously but a human monitors and can intervene or override.",
    risk: "Medium risk",
  },
  SUPERVISED: {
    label: "Supervised",
    description: "Agent operates independently with periodic human review of outcomes and decisions.",
    risk: "Higher risk",
  },
  FULL_AUTONOMY: {
    label: "Full Autonomy",
    description: "Agent operates without human oversight. Requires thorough risk assessment.",
    risk: "Highest risk",
  },
};

/**
 * Badge that shows the autonomy level with a hover tooltip explaining it.
 */
export function AutonomyBadge({ level }: { level: string }) {
  const info = AUTONOMY_LEVELS[level];
  if (!info) {
    return <Badge variant="outline">{level.replace(/_/g, " ")}</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <Badge variant="outline" className="cursor-help gap-1">
            {info.label}
            <HelpCircle className="h-2.5 w-2.5 text-[var(--text-faint)]" />
          </Badge>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-3">
        <p className="text-xs leading-relaxed">
          <span className="font-semibold text-[var(--text-primary)]">{info.label}</span>
          {" — "}{info.description}
        </p>
        <p className="text-[10px] text-[var(--text-faint)] mt-1">{info.risk}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Help icon tooltip that explains all autonomy levels.
 */
export function AutonomyHelpTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="h-3.5 w-3.5 text-[var(--text-faint)] cursor-help" />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs p-3 space-y-2 text-xs leading-relaxed">
        {Object.values(AUTONOMY_LEVELS).map((level) => (
          <p key={level.label}>
            <span className="font-semibold text-[var(--text-primary)]">{level.label}</span>
            {" — "}{level.description}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
