import Link from "next/link";
import { Pencil, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/help/help-hint";

type Person = { name: string | null; email: string } | null;

/**
 * Who answers for the agent: business owner, technical owner, risk owner,
 * and where a trigger or incident escalates to.
 */
export function AgentAccountabilityCard({
  agent,
  canEdit,
}: {
  agent: {
    id: string;
    owner: Person;
    technicalOwner: Person;
    riskOwner: Person;
    escalationContact: string | null;
    riskLevel: string;
  };
  canEdit: boolean;
}) {
  const show = (p: Person) => (p ? p.name ?? p.email : null);
  const rows: Array<{ label: string; value: string | null; hint: string }> = [
    { label: "Business owner", value: show(agent.owner), hint: "Accountable for the outcomes the agent produces." },
    { label: "Technical owner", value: show(agent.technicalOwner), hint: "Runs the agent: prompts, tools, deploys, fixes." },
    { label: "Risk owner", value: show(agent.riskOwner), hint: "Signs off the risk basis and decides on incidents." },
    { label: "Escalation contact", value: agent.escalationContact, hint: "Paged when a review trigger fires or an incident opens." },
  ];
  const missing = rows.filter((r) => !r.value).length;

  return (
    <Card id="accountability" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--accent)]" />
            Accountability
            <HelpHint hint="agent_accountability" />
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={missing === 0 ? "success" : "warning"}>
              {missing === 0 ? "Complete" : `${missing} unassigned`}
            </Badge>
            {canEdit && (
              <Link
                href={`/agents/${agent.id}/edit#accountability`}
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                <Pencil className="h-3 w-3" /> Edit
              </Link>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="text-[var(--text-muted)]">
                {row.label}
                <span className="block text-[11px] text-[var(--text-faint)]">{row.hint}</span>
              </dt>
              <dd className={row.value ? "text-right font-medium" : "text-right text-[var(--text-faint)]"}>
                {row.value ?? "Unassigned"}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
