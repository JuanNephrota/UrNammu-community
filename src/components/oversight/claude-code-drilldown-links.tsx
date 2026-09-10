import Link from "next/link";
import { ScrollText, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";

// Header actions for the OTel-sourced Claude Code dashboards (the Claude Code
// page and the Cowork page, which share ClaudeCodeAnalyticsView).
//
// These used to live inside the "Recent Events" card, which only renders when
// that window has events — so on a quiet day the only route to the session
// traces and the audit log disappeared. Keep them in the page header, where
// they are always reachable.

export function ClaudeCodeDrilldownLinks({
  surface,
}: {
  /** app.entrypoint to scope the drilldowns to, e.g. "local-agent" for Cowork. */
  surface?: string | null;
}) {
  const qs = surface ? `?surface=${encodeURIComponent(surface)}` : "";

  return (
    <>
      <Link href={`/oversight/claude-code/sessions${qs}`}>
        <Button variant="outline">
          <Waypoints className="mr-2 h-4 w-4" /> Session Traces
        </Button>
      </Link>
      <Link href={`/oversight/claude-code/events${qs}`}>
        <Button variant="outline">
          <ScrollText className="mr-2 h-4 w-4" /> Audit Log
        </Button>
      </Link>
    </>
  );
}
