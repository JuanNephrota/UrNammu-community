"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useHelp } from "./help-context";
import { HelpMarkdown } from "./markdown";
import { HELP_CONTENT, HELP_TITLES } from "@/lib/help/content";

/**
 * Side-drawer help panel. Reads the current page key from HelpContext and
 * renders the matching markdown. Trigger via the top-bar icon or `?`.
 */
export function HelpDrawer() {
  const { open, helpKey, closeHelp } = useHelp();
  const title = HELP_TITLES[helpKey];
  const content = HELP_CONTENT[helpKey];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && closeHelp()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl shadow-black/60 outline-none animate-fade-in-up"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                Help
              </p>
              <DialogPrimitive.Title
                className="mt-1 text-base font-semibold text-[var(--text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {title}
              </DialogPrimitive.Title>
              <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                Press <kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5 font-mono">?</kbd> anywhere to toggle this panel.
              </p>
            </div>
            <DialogPrimitive.Close
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close help"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <HelpMarkdown source={content} />
          </div>

          <div className="border-t border-[var(--border-subtle)] p-4 text-[11px] text-[var(--text-faint)]">
            For deeper coverage, see the User Guide in <code className="font-mono">docs/user-guide.md</code>.
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
