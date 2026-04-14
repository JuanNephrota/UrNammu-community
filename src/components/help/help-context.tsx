"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { helpKeyForPath, type HelpKey } from "@/lib/help/content";

type HelpContextValue = {
  open: boolean;
  helpKey: HelpKey;
  openHelp: (key?: HelpKey) => void;
  closeHelp: () => void;
  toggleHelp: () => void;
};

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  // Store the override key together with the pathname it was set for.
  // When pathname changes, the override is stale and ignored — no effect needed.
  const [override, setOverride] = useState<{ key: HelpKey; forPath: string } | null>(null);
  const helpKey = (override && override.forPath === pathname) ? override.key : helpKeyForPath(pathname);

  const closeHelp = useCallback(() => {
    setOpen(false);
    setOverride(null);
  }, []);

  const openHelp = useCallback((key?: HelpKey) => {
    if (key) setOverride({ key, forPath: pathname });
    setOpen(true);
  }, [pathname]);

  const toggleHelp = useCallback(() => {
    setOpen((prev) => {
      if (prev) setOverride(null);
      return !prev;
    });
  }, []);

  // `?` opens / closes help, but only when the user is not typing in a field.
  useEffect(() => {
    function isTextEntry(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function handler(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key !== "?") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      toggleHelp();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleHelp]);

  const value = useMemo(
    () => ({ open, helpKey, openHelp, closeHelp, toggleHelp }),
    [open, helpKey, openHelp, closeHelp, toggleHelp]
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error("useHelp must be used inside <HelpProvider>");
  }
  return ctx;
}
