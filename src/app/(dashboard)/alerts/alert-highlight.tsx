"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function AlertHighlight() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`alert-${highlightId}`);
    if (!el) return;

    // Scroll into view
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Add highlight flash
    el.classList.add("ring-2", "ring-[var(--accent)]", "ring-offset-1", "ring-offset-[var(--bg-deep)]");
    const timer = setTimeout(() => {
      el.classList.remove("ring-2", "ring-[var(--accent)]", "ring-offset-1", "ring-offset-[var(--bg-deep)]");
    }, 3000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  return null;
}
