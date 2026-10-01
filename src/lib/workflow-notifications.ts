export type WorkflowNotification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  category: "approval" | "renewal" | "drift" | "incident" | "overdue" | "investigation";
  createdAt: Date;
  tone: "critical" | "warning" | "info";
};

export function buildWorkflowNotifications(input: {
  recentApprovals: Array<{ id: string; systemName: string; decision: string; createdAt: Date }>;
  expiringExceptions: Array<{ id: string; systemName: string; expiresAt: Date }>;
  driftAlerts: Array<{ id: string; title: string; createdAt: Date }>;
  /** System or agent incidents; `href` defaults to /alerts. */
  openIncidents: Array<{ id: string; systemName: string; title: string; openedAt: Date; href?: string }>;
  overdueReviews: Array<{ id: string; systemName: string; nextReviewDate: Date }>;
  investigations: Array<{ id: string; title: string; updatedAt: Date }>;
  /** Agent approvals (AgentApproval). */
  agentApprovals?: Array<{ id: string; agentId: string; agentName: string; decision: string; createdAt: Date }>;
  /** Agents whose next-review date has passed. */
  agentOverdueReviews?: Array<{ id: string; agentName: string; nextReviewDate: Date }>;
  /** Open human-review trigger alerts (a tool call matched a trigger). */
  reviewAlerts?: Array<{ id: string; title: string; createdAt: Date }>;
}) {
  const items: WorkflowNotification[] = [
    ...(input.agentApprovals ?? []).map((approval) => ({
      id: `agent-approval-${approval.id}`,
      title: `${approval.agentName} agent approval updated`,
      detail: `Decision recorded: ${approval.decision.replace(/_/g, " ").toLowerCase()}.`,
      href: `/agents/${approval.agentId}#approval`,
      category: "approval" as const,
      createdAt: approval.createdAt,
      tone: (approval.decision === "APPROVED" ? "info" : "warning") as WorkflowNotification["tone"],
    })),
    ...(input.agentOverdueReviews ?? []).map((review) => ({
      id: `agent-overdue-${review.id}`,
      title: `${review.agentName} agent review is overdue`,
      detail: `Next review date was ${review.nextReviewDate.toLocaleDateString("en-US")}. Re-review and record a fresh approval.`,
      href: `/agents/${review.id}#approval`,
      category: "overdue" as const,
      createdAt: review.nextReviewDate,
      tone: "warning" as const,
    })),
    ...(input.reviewAlerts ?? []).map((alert) => ({
      id: `review-${alert.id}`,
      title: alert.title,
      detail: "An agent's tool call matched a human-review trigger and needs a decision.",
      href: "/alerts",
      category: "incident" as const,
      createdAt: alert.createdAt,
      tone: "critical" as const,
    })),
    ...input.recentApprovals.map((approval) => {
      const tone: WorkflowNotification["tone"] =
        approval.decision === "APPROVED" ? "info" : "warning";
      return {
        id: `approval-${approval.id}`,
        title: `${approval.systemName} approval updated`,
        detail: `Decision recorded: ${approval.decision.replace(/_/g, " ").toLowerCase()}.`,
        href: "/dashboard",
        category: "approval" as const,
        createdAt: approval.createdAt,
        tone,
      };
    }),
    ...input.expiringExceptions.map((exception) => ({
      id: `renewal-${exception.id}`,
      title: `${exception.systemName} exception expires soon`,
      detail: `Renew or close this exception before ${exception.expiresAt.toLocaleDateString("en-US")}.`,
      href: "/compliance",
      category: "renewal" as const,
      createdAt: exception.expiresAt,
      tone: "warning" as const,
    })),
    ...input.driftAlerts.map((alert) => ({
      id: `drift-${alert.id}`,
      title: alert.title,
      detail: "A system's governance posture or an agent's behaviour changed in a way that should be reviewed.",
      href: "/alerts",
      category: "drift" as const,
      createdAt: alert.createdAt,
      tone: "critical" as const,
    })),
    ...input.openIncidents.map((incident) => ({
      id: `incident-${incident.id}`,
      title: `${incident.systemName} incident is open`,
      detail: incident.title,
      href: incident.href ?? "/alerts",
      category: "incident" as const,
      createdAt: incident.openedAt,
      tone: "critical" as const,
    })),
    ...input.overdueReviews.map((review) => ({
      id: `overdue-${review.id}`,
      title: `${review.systemName} review is overdue`,
      detail: `Next review date was ${review.nextReviewDate.toLocaleDateString("en-US")}.`,
      href: `/registry/${review.id}`,
      category: "overdue" as const,
      createdAt: review.nextReviewDate,
      tone: "warning" as const,
    })),
    ...input.investigations.map((investigation) => ({
      id: `investigation-${investigation.id}`,
      title: investigation.title,
      detail: "Investigation updated and still needs follow-through.",
      href: "/oversight/investigations",
      category: "investigation" as const,
      createdAt: investigation.updatedAt,
      tone: "info" as const,
    })),
  ];

  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 12);
}
