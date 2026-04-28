"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";
import { HELP_HINTS, type HelpHintKey } from "@/lib/help/hints";

/**
 * Inline `?` icon that reveals a short tooltip. Use beside complex form
 * labels, badges, or section headers — anything where one line of plain
 * English saves a trip to the docs.
 *
 * Pass either a named hint key (preferred — keeps copy in one place)
 * or freeform text via the `text` prop.
 */
export function HelpHint({
  hint,
  text,
  className,
  side = "top",
}: {
  hint?: HelpHintKey;
  text?: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const body = text ?? (hint ? HELP_HINTS[hint] : "");
  if (!body) return null;
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="More info"
            className={
              "inline-flex items-center justify-center rounded text-[var(--text-muted)] outline-none transition-colors hover:text-[var(--accent)] focus:text-[var(--accent)] " +
              (className ?? "")
            }
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={12}
            className="z-[60] max-w-xs rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)] shadow-lg shadow-black/40 animate-in fade-in-0 zoom-in-95"
          >
            {body}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
