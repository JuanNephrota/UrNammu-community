"use client";

import { CircleHelp } from "lucide-react";
import { useHelp } from "./help-context";

/**
 * Top-bar help icon. Opens the per-page help drawer.
 */
export function HelpTrigger() {
  const { openHelp } = useHelp();
  return (
    <button
      type="button"
      onClick={() => openHelp()}
      title="Help (?)"
      aria-label="Open help"
      className="rounded-lg p-2 text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <CircleHelp className="h-[18px] w-[18px]" />
    </button>
  );
}
