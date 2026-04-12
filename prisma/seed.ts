import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/passwords";

const prisma = new PrismaClient();

function daysAgo(days: number, hour = 14) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function startOfUtcDay(days: number) {
  const date = daysAgo(days, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

async function resetDemoWorkspace() {
  await prisma.auditLog.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.systemApproval.deleteMany();
  await prisma.complianceMapping.deleteMany();
  await prisma.policyAssignment.deleteMany();
  await prisma.riskAssessment.deleteMany();
  await prisma.aIAgent.deleteMany();
  await prisma.aISystem.deleteMany();
  await prisma.discoveredAITool.deleteMany();
  await prisma.aPIUsageLog.deleteMany();
  await prisma.providerRawSnapshot.deleteMany();
  await prisma.usageBucket.deleteMany();
  await prisma.costBucket.deleteMany();
  await prisma.providerProject.deleteMany();
  await prisma.providerActor.deleteMany();
  await prisma.providerSyncRun.deleteMany();
  await prisma.ingestionRun.deleteMany();
  await prisma.scanHistory.deleteMany();
  await prisma.policy.deleteMany();
}

async function main() {
  await resetDemoWorkspace();
  const demoPasswordHash = await hashPassword("demo-password");

  const [admin, complianceOfficer, viewer] = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@example.com" },
      update: {
        name: "Demo Admin",
        passwordHash: demoPasswordHash,
        role: "ADMIN",
        department: "Security & Governance",
      },
      create: {
        email: "admin@example.com",
        name: "Demo Admin",
        passwordHash: demoPasswordHash,
        role: "ADMIN",
        department: "Security & Governance",
      },
    }),
    prisma.user.upsert({
      where: { email: "compliance@example.com" },
      update: {
        name: "Compliance Lead",
        passwordHash: demoPasswordHash,
        role: "COMPLIANCE_OFFICER",
        department: "Risk & Compliance",
      },
      create: {
        email: "compliance@example.com",
        name: "Compliance Lead",
        passwordHash: demoPasswordHash,
        role: "COMPLIANCE_OFFICER",
        department: "Risk & Compliance",
      },
    }),
    prisma.user.upsert({
      where: { email: "viewer@example.com" },
      update: {
        name: "Program Observer",
        passwordHash: demoPasswordHash,
        role: "VIEWER",
        department: "Operations",
      },
      create: {
        email: "viewer@example.com",
        name: "Program Observer",
        passwordHash: demoPasswordHash,
        role: "VIEWER",
        department: "Operations",
      },
    }),
  ]);

  await prisma.appSetting.upsert({
    where: { key: "provider_sync_enabled" },
    update: { value: "true" },
    create: { key: "provider_sync_enabled", value: "true" },
  });
  await prisma.appSetting.upsert({
    where: { key: "provider_sync_interval_hours" },
    update: { value: "6" },
    create: { key: "provider_sync_interval_hours", value: "6" },
  });
  await prisma.appSetting.upsert({
    where: { key: "google_scan_enabled" },
    update: { value: "true" },
    create: { key: "google_scan_enabled", value: "true" },
  });
  await prisma.appSetting.upsert({
    where: { key: "google_scan_lookback_days" },
    update: { value: "30" },
    create: { key: "google_scan_lookback_days", value: "30" },
  });
  await prisma.appSetting.upsert({
    where: { key: "google_scan_interval_hours" },
    update: { value: "24" },
    create: { key: "google_scan_interval_hours", value: "24" },
  });
  const systems = await Promise.all([
    prisma.aISystem.create({
      data: {
        name: "Customer Support Chatbot",
        description: "Claude-based assistant for inbound customer questions, triage, and ticket deflection.",
        department: "Customer Success",
        ownerId: admin.id,
        vendor: "Anthropic",
        modelType: "LLM",
        riskLevel: "MEDIUM",
        status: "UNDER_REVIEW",
        dataSensitivity: "CONFIDENTIAL",
        useCase: "Respond to product support questions and summarize cases before handoff.",
        version: "2.4",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Fraud Detection Engine",
        description: "Real-time transaction scoring model for payment risk operations.",
        department: "Risk & Compliance",
        ownerId: complianceOfficer.id,
        vendor: "Internal",
        modelType: "Classification",
        riskLevel: "HIGH",
        status: "DEPLOYED",
        dataSensitivity: "RESTRICTED",
        useCase: "Flags suspicious card and ACH activity for analyst review before settlement.",
        version: "3.2",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Document Summarizer",
        description: "OpenAI-based contract and policy summarization workspace for legal teams.",
        department: "Legal",
        ownerId: admin.id,
        vendor: "OpenAI",
        modelType: "LLM",
        riskLevel: "MEDIUM",
        status: "APPROVED",
        dataSensitivity: "CONFIDENTIAL",
        useCase: "Summarizes vendor agreements and highlights unusual clauses for legal review.",
        version: "1.3",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Resume Screening Tool",
        description: "Internal candidate ranking workflow that needs remediation before approval.",
        department: "Human Resources",
        ownerId: complianceOfficer.id,
        vendor: "Internal",
        modelType: "NLP Classification",
        riskLevel: "HIGH",
        status: "UNDER_REVIEW",
        dataSensitivity: "CONFIDENTIAL",
        useCase: "Ranks inbound applicants for recruiter review based on role criteria.",
        version: "1.5",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Marketing Content Generator",
        description: "Campaign drafting assistant used for blog, email, and landing-page copy.",
        department: "Marketing",
        ownerId: viewer.id,
        vendor: "Anthropic",
        modelType: "LLM",
        riskLevel: "LOW",
        status: "DEPLOYED",
        dataSensitivity: "INTERNAL",
        useCase: "Generates first drafts of campaign copy and partner launch announcements.",
        version: "1.8",
      },
    }),
  ]);

  await Promise.all([
    prisma.aIAgent.create({
      data: {
        name: "SOC Analyst Agent",
        description: "Investigates suspicious activity and drafts incident summaries for human review.",
        ownerId: admin.id,
        aiSystemId: systems[1].id,
        capabilities: ["alert_triage", "investigation_summary", "playbook_guidance"],
        accessLevel: "read-write",
        autonomyLevel: "HUMAN_IN_THE_LOOP",
        connectedSystems: ["SIEM", "Jira", "Case Management"],
        humanReviewRequired: true,
        riskLevel: "HIGH",
        status: "DEPLOYED",
        department: "Security",
      },
    }),
    prisma.aIAgent.create({
      data: {
        name: "Customer Routing Agent",
        description: "Routes incoming support requests to the right queue and proposes responses.",
        ownerId: admin.id,
        aiSystemId: systems[0].id,
        capabilities: ["intent_classification", "routing", "response_suggestions"],
        accessLevel: "read-write",
        autonomyLevel: "SUPERVISED",
        connectedSystems: ["Zendesk", "Slack"],
        humanReviewRequired: false,
        riskLevel: "LOW",
        status: "DEPLOYED",
        department: "Customer Success",
      },
    }),
    prisma.aIAgent.create({
      data: {
        name: "Policy Change Agent",
        description: "Summarizes new policy drafts and highlights evidence gaps before audit review.",
        ownerId: complianceOfficer.id,
        aiSystemId: systems[2].id,
        capabilities: ["policy_diffing", "evidence_gap_detection", "review_summaries"],
        accessLevel: "read-only",
        autonomyLevel: "HUMAN_ON_THE_LOOP",
        connectedSystems: ["GitHub", "Google Drive"],
        humanReviewRequired: true,
        riskLevel: "MEDIUM",
        status: "APPROVED",
        department: "Risk & Compliance",
      },
    }),
  ]);

  await Promise.all([
    prisma.riskAssessment.create({
      data: {
        aiSystemId: systems[0].id,
        biasScore: 22,
        securityScore: 38,
        privacyScore: 46,
        fairnessScore: 20,
        performanceScore: 18,
        transparencyScore: 34,
        overallScore: 29.7,
        assessedBy: "Compliance Lead",
        justifications: {
          privacyScore: "Support transcripts can contain customer identifiers and refund details.",
          securityScore: "Prompt-injection testing still exposes escalation instructions in edge cases.",
        },
        notes: "Suitable for approval once prompt hardening evidence is documented.",
      },
    }),
    prisma.riskAssessment.create({
      data: {
        aiSystemId: systems[1].id,
        biasScore: 58,
        securityScore: 72,
        privacyScore: 66,
        fairnessScore: 61,
        performanceScore: 42,
        transparencyScore: 53,
        overallScore: 58.7,
        assessedBy: "Compliance Lead",
        justifications: {
          biasScore: "Historical fraud labels over-weight a few customer geographies.",
          securityScore: "Model inputs include sensitive transaction features and require stricter access controls.",
        },
        notes: "Ongoing monitoring required with tighter governance for analyst overrides.",
      },
    }),
    prisma.riskAssessment.create({
      data: {
        aiSystemId: systems[3].id,
        biasScore: 77,
        securityScore: 44,
        privacyScore: 58,
        fairnessScore: 81,
        performanceScore: 34,
        transparencyScore: 66,
        overallScore: 60,
        assessedBy: "Compliance Lead",
        justifications: {
          biasScore: "Historical hiring data still reflects prior demographic skew.",
          fairnessScore: "Evaluation shows a material gap across protected groups that must be remediated.",
        },
        notes: "This system should remain under review until the remediation plan is complete.",
      },
    }),
  ]);

  const policies = await Promise.all([
    prisma.policy.create({
      data: {
        name: "EU AI Act - High Risk Systems",
        description: "Baseline controls for high-risk systems with human oversight and evidence requirements.",
        framework: "EU_AI_ACT",
        version: "1.0",
        status: "ACTIVE",
        content: "High-risk AI systems must maintain risk controls, transparent documentation, and effective human oversight.",
      },
    }),
    prisma.policy.create({
      data: {
        name: "NIST AI RMF - Govern",
        description: "Governance expectations for accountability, monitoring, and ongoing review.",
        framework: "NIST_AI_RMF",
        version: "1.1",
        status: "ACTIVE",
        content: "Organizations should establish accountability and lifecycle management processes for AI risk.",
      },
    }),
    prisma.policy.create({
      data: {
        name: "ISO 42001 - Impact Assessment",
        description: "Assessment and recordkeeping requirements for AI management systems.",
        framework: "ISO_42001",
        version: "0.9",
        status: "DRAFT",
        content: "Organizations should evaluate AI impacts and maintain evidence of their management responses.",
      },
    }),
  ]);

  await Promise.all([
    prisma.policyAssignment.create({
      data: {
        policyId: policies[1].id,
        aiSystemId: systems[0].id,
        complianceStatus: "COMPLIANT",
        evidence: "Support workflow approvals, retention policy, and escalation playbooks are documented.",
        assessedAt: daysAgo(5),
      },
    }),
    prisma.policyAssignment.create({
      data: {
        policyId: policies[0].id,
        aiSystemId: systems[1].id,
        complianceStatus: "PARTIALLY_COMPLIANT",
        evidence: "Monitoring and human review are in place, but formal transparency notices are still incomplete.",
        assessedAt: daysAgo(4),
      },
    }),
    prisma.policyAssignment.create({
      data: {
        policyId: policies[0].id,
        aiSystemId: systems[3].id,
        complianceStatus: "NON_COMPLIANT",
        evidence: "Bias remediation and human oversight design are not yet complete.",
        assessedAt: daysAgo(3),
      },
    }),
    prisma.policyAssignment.create({
      data: {
        policyId: policies[1].id,
        aiSystemId: systems[2].id,
        complianceStatus: "COMPLIANT",
        evidence: "Legal review workflow, access controls, and approval records are current.",
        assessedAt: daysAgo(2),
      },
    }),
  ]);

  await Promise.all([
    prisma.complianceMapping.create({
      data: {
        aiSystemId: systems[1].id,
        framework: "EU_AI_ACT",
        requirement: "Human oversight for high-risk transaction review",
        status: "PARTIALLY_COMPLIANT",
        evidence: "Analyst review exists, but explanation quality remains inconsistent.",
      },
    }),
    prisma.complianceMapping.create({
      data: {
        aiSystemId: systems[2].id,
        framework: "NIST_AI_RMF",
        requirement: "Documented accountability and review gates",
        status: "COMPLIANT",
        evidence: "Approval board records and review notes are stored with each release.",
      },
    }),
  ]);

  await Promise.all([
    prisma.systemApproval.create({
      data: {
        aiSystemId: systems[2].id,
        decidedByUserId: admin.id,
        decision: "APPROVED",
        rationale: "Legal review controls, evidence, and monitoring coverage are complete for pilot rollout.",
        createdAt: daysAgo(2, 16),
      },
    }),
    prisma.systemApproval.create({
      data: {
        aiSystemId: systems[3].id,
        decidedByUserId: complianceOfficer.id,
        decision: "CHANGES_REQUESTED",
        rationale: "Address fairness gaps and add explicit recruiter oversight before reconsideration.",
        createdAt: daysAgo(1, 15),
      },
    }),
  ]);

  const discoveredTools = await Promise.all([
    prisma.discoveredAITool.create({
      data: {
        toolName: "ChatGPT",
        vendor: "OpenAI",
        detectedDomain: "chat.openai.com",
        detectionSource: "google_workspace",
        department: "Engineering",
        userCount: 23,
        status: "UNDER_REVIEW",
        linkedSystemId: systems[2].id,
        notes: "Widespread usage detected. Linked to approved legal summarization workspace for policy review alignment.",
      },
    }),
    prisma.discoveredAITool.create({
      data: {
        toolName: "Midjourney",
        vendor: "Midjourney",
        detectedDomain: "midjourney.com",
        detectionSource: "dns_proxy",
        department: "Marketing",
        userCount: 5,
        status: "DISCOVERED",
        notes: "Design team experiment surfaced through imported DNS proxy activity.",
      },
    }),
    prisma.discoveredAITool.create({
      data: {
        toolName: "Claude",
        vendor: "Anthropic",
        detectedDomain: "claude.ai",
        detectionSource: "csv_import",
        department: "Customer Success",
        userCount: 8,
        status: "REGISTERED",
        linkedSystemId: systems[0].id,
        notes: "Registered from proxy export and routed into the support chatbot governance workflow.",
      },
    }),
  ]);

  await Promise.all([
    prisma.alert.create({
      data: {
        title: "Approval follow-up: Resume Screening Tool",
        description: "Requested changes remain open after the latest review decision.",
        severity: "CRITICAL",
        source: "governance",
        status: "OPEN",
      },
    }),
    prisma.alert.create({
      data: {
        title: "New shadow AI discovery: Midjourney",
        description: "Marketing endpoint activity suggests active usage that still needs triage.",
        severity: "MEDIUM",
        source: "shadow_ai",
        status: "OPEN",
        relatedToolId: discoveredTools[1].id,
      },
    }),
    prisma.alert.create({
      data: {
        title: "Anthropic spend increased week over week",
        description: "Demo telemetry shows a moderate cost increase across support and marketing usage.",
        severity: "MEDIUM",
        source: "oversight",
        status: "ACKNOWLEDGED",
      },
    }),
  ]);

  const telemetryRuns = await Promise.all([
    prisma.providerSyncRun.create({
      data: {
        provider: "anthropic",
        syncType: "telemetry",
        status: "SUCCEEDED",
        triggeredByUserId: admin.id,
        startedAt: daysAgo(0, 5),
        completedAt: daysAgo(0, 5),
        recordsProcessed: 14,
        metadata: {
          coverage: {
            members: 4,
            keys: 2,
          },
        },
      },
    }),
    prisma.providerSyncRun.create({
      data: {
        provider: "openai",
        syncType: "telemetry",
        status: "SUCCEEDED",
        triggeredByUserId: admin.id,
        startedAt: daysAgo(0, 5),
        completedAt: daysAgo(0, 5),
        recordsProcessed: 18,
        metadata: {
          coverage: {
            assistants: 2,
          },
        },
      },
    }),
  ]);

  await Promise.all([
    prisma.providerActor.create({
      data: {
        provider: "anthropic",
        externalId: "anthropic-user-support",
        email: "support-lead@example.com",
        name: "Support Lead",
        role: "admin",
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[0].id,
      },
    }),
    prisma.providerActor.create({
      data: {
        provider: "openai",
        externalId: "openai-user-legal",
        email: "legal-ops@example.com",
        name: "Legal Ops",
        role: "member",
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[1].id,
      },
    }),
    prisma.providerProject.create({
      data: {
        provider: "anthropic",
        externalId: "anthropic-key-support",
        name: "Support Workspace",
        status: "active",
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[0].id,
      },
    }),
    prisma.providerProject.create({
      data: {
        provider: "openai",
        externalId: "proj_legal_summaries",
        name: "Legal Summaries",
        status: "active",
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[1].id,
      },
    }),
  ]);

  const telemetryDays = [6, 5, 4, 3, 2, 1, 0];
  for (const day of telemetryDays) {
    const bucketStart = startOfUtcDay(day);
    const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);

    const anthropicTokens = 52000 + day * 1800;
    const openaiTokens = 34000 + day * 2200;

    await prisma.usageBucket.create({
      data: {
        provider: "anthropic",
        bucketStart,
        bucketEnd,
        granularity: "day",
        dimensionKey: `date=${bucketStart.toISOString()}|model=claude-sonnet-4-20250514|apiKey=anthropic-key-support`,
        model: "claude-sonnet-4-20250514",
        projectExternalId: "anthropic-key-support",
        projectName: "Support Workspace",
        actorExternalId: "anthropic-user-support",
        actorName: "Support Lead",
        apiKeyExternalId: "anthropic-key-support",
        apiKeyName: "Support Workspace",
        inputTokens: Math.round(anthropicTokens * 0.62),
        outputTokens: Math.round(anthropicTokens * 0.38),
        totalTokens: anthropicTokens,
        requestCount: 120 + (6 - day) * 5,
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[0].id,
      },
    });

    await prisma.costBucket.create({
      data: {
        provider: "anthropic",
        bucketStart,
        bucketEnd,
        granularity: "day",
        dimensionKey: `date=${bucketStart.toISOString()}|lineItem=messages|model=claude-sonnet-4-20250514`,
        amount: 18 + (6 - day) * 1.4,
        currency: "usd",
        model: "claude-sonnet-4-20250514",
        lineItem: "messages",
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[0].id,
      },
    });

    await prisma.usageBucket.create({
      data: {
        provider: "openai",
        bucketStart,
        bucketEnd,
        granularity: "day",
        dimensionKey: `date=${bucketStart.toISOString()}|model=gpt-4o|project=proj_legal_summaries|actor=openai-user-legal`,
        model: "gpt-4o",
        projectExternalId: "proj_legal_summaries",
        projectName: "Legal Summaries",
        actorExternalId: "openai-user-legal",
        actorName: "Legal Ops",
        apiKeyExternalId: "key_legal_ops",
        apiKeyName: "Legal Ops Key",
        inputTokens: Math.round(openaiTokens * 0.57),
        outputTokens: Math.round(openaiTokens * 0.43),
        totalTokens: openaiTokens,
        requestCount: 70 + (6 - day) * 4,
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[1].id,
      },
    });

    await prisma.costBucket.create({
      data: {
        provider: "openai",
        bucketStart,
        bucketEnd,
        granularity: "day",
        dimensionKey: `date=${bucketStart.toISOString()}|lineItem=responses|model=gpt-4o`,
        amount: 12 + (6 - day) * 1.1,
        currency: "usd",
        model: "gpt-4o",
        lineItem: "responses",
        metadata: { source: "demo_seed" },
        syncRunId: telemetryRuns[1].id,
      },
    });
  }

  await Promise.all([
    prisma.providerRawSnapshot.create({
      data: {
        provider: "anthropic",
        resourceType: "usage_by_model",
        payload: { source: "demo_seed", note: "Sample normalized telemetry snapshot" },
        syncRunId: telemetryRuns[0].id,
      },
    }),
    prisma.providerRawSnapshot.create({
      data: {
        provider: "openai",
        resourceType: "usage",
        payload: { source: "demo_seed", note: "Sample normalized telemetry snapshot" },
        syncRunId: telemetryRuns[1].id,
      },
    }),
  ]);

  const usageLogEntries = [
    { provider: "claude", model: "claude-sonnet-4-20250514", department: "Customer Success", totalTokens: 18450, cost: 2.11, flagged: false, day: 1 },
    { provider: "chatgpt", model: "gpt-4o", department: "Legal", totalTokens: 12980, cost: 1.82, flagged: false, day: 1 },
    { provider: "claude", model: "claude-haiku-4-5-20251001", department: "Marketing", totalTokens: 8920, cost: 0.58, flagged: true, day: 2, flagReason: "PII-like customer list detected in prompt metadata" },
    { provider: "chatgpt", model: "gpt-4.1", department: "Engineering", totalTokens: 15820, cost: 2.43, flagged: false, day: 3 },
    { provider: "claude", model: "claude-sonnet-4-20250514", department: "Customer Success", totalTokens: 17240, cost: 2.02, flagged: false, day: 4 },
  ];

  for (const entry of usageLogEntries) {
    await prisma.aPIUsageLog.create({
      data: {
        userId: admin.id,
        provider: entry.provider,
        model: entry.model,
        department: entry.department,
        promptTokens: Math.round(entry.totalTokens * 0.58),
        completionTokens: Math.round(entry.totalTokens * 0.42),
        totalTokens: entry.totalTokens,
        cost: entry.cost,
        flagged: entry.flagged,
        flagReason: entry.flagReason ?? null,
        promptMetadata: { source: "demo_seed" },
        createdAt: daysAgo(entry.day, 11),
      },
    });
  }

  await Promise.all([
    prisma.scanHistory.create({
      data: {
        scanType: "google_workspace",
        status: "completed",
        toolsFound: 4,
        newToolsAdded: 1,
        updatedTools: 2,
        triggeredBy: "system",
        startedAt: daysAgo(0, 2),
        completedAt: daysAgo(0, 2),
      },
    }),
    prisma.ingestionRun.create({
      data: {
        source: "demo_csv_import",
        status: "completed",
        inputType: "csv",
        fileName: "sample-shadow-ai-export.csv",
        triggeredByUserId: admin.id,
        processed: 12,
        matched: 9,
        newTools: 2,
        updatedTools: 3,
        details: { source: "demo_seed" },
        startedAt: daysAgo(2, 10),
        completedAt: daysAgo(2, 10),
      },
    }),
  ]);

  console.log("Demo workspace seeded successfully.");
  console.log("Use admin@example.com with password demo-password to explore the sample environment.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
