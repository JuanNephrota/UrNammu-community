import Link from "next/link";
import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettings } from "@/lib/settings";
import {
  ENDPOINT_COLLECTORS_KEY,
  ENDPOINT_ENROLLMENT_SECRET_KEY,
  ENDPOINT_REPORT_INTERVAL_KEY,
  getEnabledCollectors,
} from "@/lib/endpoint-agent";
import { EndpointAgentSettings } from "../endpoint-agent-settings";

export const dynamic = "force-dynamic";

export default async function EndpointAgentSettingsPage() {
  await requireRole(["ADMIN"]);

  const [settingsMap, collectors, deviceCount] = await Promise.all([
    getSettings([
      ENDPOINT_ENROLLMENT_SECRET_KEY,
      ENDPOINT_REPORT_INTERVAL_KEY,
      ENDPOINT_COLLECTORS_KEY,
      "platform_url",
    ]),
    getEnabledCollectors(),
    prisma.endpointDevice.count(),
  ]);

  const hasSecret =
    !!settingsMap[ENDPOINT_ENROLLMENT_SECRET_KEY] ||
    !!process.env.ENDPOINT_AGENT_ENROLLMENT_SECRET;

  const platformUrl =
    settingsMap.platform_url ?? process.env.NEXTAUTH_URL ?? "https://urnammu.example.com";

  return (
    <div className="space-y-6">
      <EndpointAgentSettings
        hasSecret={hasSecret}
        platformUrl={platformUrl}
        reportIntervalSeconds={settingsMap[ENDPOINT_REPORT_INTERVAL_KEY] ?? "900"}
        enabledCollectors={collectors}
        deviceCount={deviceCount}
      />

      <Card>
        <CardHeader>
          <CardTitle>What the agent can and cannot see</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--text-secondary)]">
          <p>
            Three things enforce the content boundary rather than merely promising
            it. The allowlist is <strong>server-issued</strong>: the agent reports
            only hostnames present in the manifest compiled from the AI tools
            registry, so ordinary browsing never leaves the machine. The wire schema
            has <strong>no field that can carry content</strong> — its hostname type
            rejects anything containing a slash, so a URL cannot be smuggled through
            a domain field. And <code>--dry-run</code> prints the exact bytes a
            machine would transmit, so anyone can audit it on their own laptop.
          </p>
          <p>
            It is not an EDR: no kernel extension, no Endpoint Security client, no
            ETW hooks. It runs unprivileged in the user&apos;s own session and reads
            only what that user can already read.
          </p>
          <p>
            Enrolled devices and what they found are on{" "}
            <Link
              href="/oversight/endpoints"
              className="text-[var(--accent)] hover:underline"
            >
              Endpoints
            </Link>
            . Discoveries also roll into{" "}
            <Link href="/shadow-ai" className="text-[var(--accent)] hover:underline">
              Shadow AI
            </Link>{" "}
            with source <code>endpoint_agent</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
