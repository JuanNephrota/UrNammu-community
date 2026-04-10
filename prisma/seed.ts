import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin User",
      role: "ADMIN",
      department: "IT Security",
    },
  });

  // Create AI Systems
  const systems = await Promise.all([
    prisma.aISystem.create({
      data: {
        name: "Customer Support Chatbot",
        description: "AI-powered chatbot using Claude for customer service inquiries",
        department: "Customer Success",
        ownerId: admin.id,
        vendor: "Anthropic",
        modelType: "LLM",
        riskLevel: "MEDIUM",
        status: "DEPLOYED",
        dataSensitivity: "CONFIDENTIAL",
        useCase: "Automated customer support responses, ticket routing, and FAQ handling",
        version: "2.1",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Fraud Detection Engine",
        description: "ML model for real-time transaction fraud detection",
        department: "Risk & Compliance",
        ownerId: admin.id,
        vendor: "Internal",
        modelType: "Classification",
        riskLevel: "HIGH",
        status: "DEPLOYED",
        dataSensitivity: "RESTRICTED",
        useCase: "Real-time fraud scoring for wire transfers and ACH transactions",
        version: "3.0",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Document Summarizer",
        description: "GPT-4 based document summarization for legal review",
        department: "Legal",
        ownerId: admin.id,
        vendor: "OpenAI",
        modelType: "LLM",
        riskLevel: "MEDIUM",
        status: "APPROVED",
        dataSensitivity: "CONFIDENTIAL",
        useCase: "Summarize legal contracts and regulatory documents",
        version: "1.0",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Resume Screening Tool",
        description: "AI-powered resume parsing and candidate scoring",
        department: "Human Resources",
        ownerId: admin.id,
        vendor: "Internal",
        modelType: "NLP/Classification",
        riskLevel: "HIGH",
        status: "UNDER_REVIEW",
        dataSensitivity: "CONFIDENTIAL",
        useCase: "Screen and rank job applicants based on resume content",
        version: "1.2",
      },
    }),
    prisma.aISystem.create({
      data: {
        name: "Marketing Content Generator",
        description: "Claude-powered content generation for marketing campaigns",
        department: "Marketing",
        ownerId: admin.id,
        vendor: "Anthropic",
        modelType: "LLM",
        riskLevel: "LOW",
        status: "DEPLOYED",
        dataSensitivity: "INTERNAL",
        useCase: "Generate blog posts, social media content, and email copy",
        version: "1.0",
      },
    }),
  ]);

  // Create AI Agents
  await Promise.all([
    prisma.aIAgent.create({
      data: {
        name: "SOC Analyst Agent",
        description: "Autonomous security operations agent for threat investigation",
        ownerId: admin.id,
        aiSystemId: systems[1].id,
        capabilities: ["threat_analysis", "log_investigation", "alert_triage", "report_generation"],
        accessLevel: "read-write",
        autonomyLevel: "HUMAN_IN_THE_LOOP",
        connectedSystems: ["Splunk", "CrowdStrike", "Jira"],
        humanReviewRequired: true,
        riskLevel: "HIGH",
        status: "DEPLOYED",
        department: "Security",
      },
    }),
    prisma.aIAgent.create({
      data: {
        name: "Customer Routing Agent",
        description: "Routes customer inquiries to appropriate teams",
        ownerId: admin.id,
        aiSystemId: systems[0].id,
        capabilities: ["intent_classification", "ticket_routing", "escalation"],
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
        name: "Code Review Agent",
        description: "Automated code review and security scanning agent",
        ownerId: admin.id,
        capabilities: ["code_review", "security_scan", "pr_comments"],
        accessLevel: "read-only",
        autonomyLevel: "HUMAN_ON_THE_LOOP",
        connectedSystems: ["GitHub", "Slack"],
        humanReviewRequired: true,
        riskLevel: "MEDIUM",
        status: "APPROVED",
        department: "Engineering",
      },
    }),
  ]);

  // Create Risk Assessments
  await Promise.all([
    prisma.riskAssessment.create({
      data: {
        aiSystemId: systems[0].id,
        biasScore: 25,
        securityScore: 35,
        privacyScore: 45,
        fairnessScore: 20,
        performanceScore: 15,
        transparencyScore: 30,
        overallScore: 28.3,
        assessedBy: "Admin User",
        justifications: {
          privacyScore: "Chatbot handles customer PII including names, emails, and account numbers in support conversations. Conversation logs are retained for 90 days.",
          securityScore: "API endpoints are authenticated but the model can be coaxed into revealing system prompt contents through adversarial prompting.",
        },
        notes: "Customer chatbot poses moderate privacy risk due to handling PII in conversations",
      },
    }),
    prisma.riskAssessment.create({
      data: {
        aiSystemId: systems[1].id,
        biasScore: 55,
        securityScore: 70,
        privacyScore: 65,
        fairnessScore: 60,
        performanceScore: 40,
        transparencyScore: 50,
        overallScore: 56.7,
        assessedBy: "Admin User",
        justifications: {
          biasScore: "Training data over-represents urban transaction patterns, leading to higher false-positive rates for rural customers.",
          securityScore: "Model weights are stored unencrypted and the inference endpoint lacks rate limiting, exposing it to model extraction attacks.",
          privacyScore: "Transaction data includes full account numbers and merchant details. Inference logs contain raw input features that could reconstruct customer identities.",
          fairnessScore: "Approval rates for flagged transactions differ by 15% across geographic regions, with significantly higher false-positive rates in certain ZIP codes.",
          transparencyScore: "Fraud scores are presented to analysts without any feature attribution or explanation of which transaction attributes triggered the flag.",
        },
        notes: "Fraud detection system has high bias and fairness concerns due to training data imbalances",
      },
    }),
    prisma.riskAssessment.create({
      data: {
        aiSystemId: systems[3].id,
        biasScore: 75,
        securityScore: 40,
        privacyScore: 55,
        fairnessScore: 80,
        performanceScore: 30,
        transparencyScore: 65,
        overallScore: 57.5,
        assessedBy: "Admin User",
        justifications: {
          biasScore: "Model was trained on historical hiring data which reflects past demographic imbalances. Resumes from certain universities are systematically ranked higher.",
          fairnessScore: "Testing revealed that resumes with traditionally female names receive 12% lower scores on average. Candidates with employment gaps are penalized regardless of context.",
          transparencyScore: "Hiring managers receive a numeric score with no explanation of contributing factors. Candidates are not informed that AI is used in the screening process.",
          privacyScore: "System ingests full resume content including personal addresses, phone numbers, and references without data minimization.",
        },
        notes: "Resume screening has critical bias and fairness risks — needs thorough audit before deployment",
      },
    }),
  ]);

  // Create Policies
  const policies = await Promise.all([
    prisma.policy.create({
      data: {
        name: "EU AI Act - High Risk AI Systems",
        description: "Requirements for high-risk AI systems under the EU AI Act",
        framework: "EU_AI_ACT",
        status: "ACTIVE",
        content: `Article 9 - Risk Management System\nHigh-risk AI systems shall have a risk management system established, implemented, documented and maintained.\n\nArticle 10 - Data and Data Governance\nHigh-risk AI systems which make use of techniques involving the training of models with data shall be developed on the basis of training, validation and testing data sets.\n\nArticle 13 - Transparency and Provision of Information\nHigh-risk AI systems shall be designed and developed in such a way to ensure that their operation is sufficiently transparent.\n\nArticle 14 - Human Oversight\nHigh-risk AI systems shall be designed and developed in such a way that they can be effectively overseen by natural persons.`,
      },
    }),
    prisma.policy.create({
      data: {
        name: "NIST AI RMF - Govern Function",
        description: "NIST AI Risk Management Framework governance requirements",
        framework: "NIST_AI_RMF",
        status: "ACTIVE",
        content: `GOVERN 1: Policies, processes, procedures, and practices across the organization related to the mapping, measuring, and managing of AI risks are in place, transparent, and implemented effectively.\n\nGOVERN 2: Accountability structures are in place so that the appropriate teams and individuals are empowered, responsible, and trained for mapping, measuring, and managing AI risks.\n\nGOVERN 3: Workforce diversity, equity, inclusion, and accessibility processes are prioritized in the mapping, measuring, and managing of AI risks throughout the lifecycle.`,
      },
    }),
    prisma.policy.create({
      data: {
        name: "ISO 42001 - AI Management System",
        description: "Requirements for establishing and maintaining an AI management system",
        framework: "ISO_42001",
        status: "DRAFT",
        content: `Clause 6.1 - Actions to Address Risks and Opportunities\nThe organization shall determine risks and opportunities that need to be addressed to ensure the AI management system can achieve its intended outcomes.\n\nClause 8.4 - AI System Impact Assessment\nThe organization shall assess the potential impacts of AI systems on individuals, groups, and society.`,
      },
    }),
  ]);

  // Create Policy Assignments
  await Promise.all([
    prisma.policyAssignment.create({
      data: {
        policyId: policies[0].id,
        aiSystemId: systems[1].id,
        complianceStatus: "PARTIALLY_COMPLIANT",
        evidence: "Risk management system in place but transparency documentation incomplete",
        assessedAt: new Date(),
      },
    }),
    prisma.policyAssignment.create({
      data: {
        policyId: policies[0].id,
        aiSystemId: systems[3].id,
        complianceStatus: "NON_COMPLIANT",
        evidence: "Human oversight mechanisms not yet implemented for resume screening",
        assessedAt: new Date(),
      },
    }),
    prisma.policyAssignment.create({
      data: {
        policyId: policies[1].id,
        aiSystemId: systems[0].id,
        complianceStatus: "COMPLIANT",
        evidence: "Full governance structure in place for customer chatbot",
        assessedAt: new Date(),
      },
    }),
  ]);

  // Create Discovered AI Tools
  await Promise.all([
    prisma.discoveredAITool.create({
      data: {
        toolName: "ChatGPT",
        vendor: "OpenAI",
        detectedDomain: "chat.openai.com",
        detectionSource: "network_log",
        department: "Engineering",
        userCount: 23,
        status: "UNDER_REVIEW",
        notes: "Widespread usage detected across engineering team",
      },
    }),
    prisma.discoveredAITool.create({
      data: {
        toolName: "Midjourney",
        vendor: "Midjourney Inc",
        detectedDomain: "midjourney.com",
        detectionSource: "siem",
        department: "Marketing",
        userCount: 5,
        status: "DISCOVERED",
        notes: "Used for generating marketing images",
      },
    }),
    prisma.discoveredAITool.create({
      data: {
        toolName: "Copilot",
        vendor: "GitHub / Microsoft",
        detectedDomain: "github.com",
        detectionSource: "manual",
        department: "Engineering",
        userCount: 15,
        status: "APPROVED",
        notes: "Approved for use with code review requirements",
      },
    }),
  ]);

  // Create Alerts
  await Promise.all([
    prisma.alert.create({
      data: {
        title: "High risk score: Fraud Detection Engine",
        description: "Overall risk score of 56.7 exceeds threshold",
        severity: "HIGH",
        source: "risk_center",
        status: "OPEN",
      },
    }),
    prisma.alert.create({
      data: {
        title: "New AI tool discovered: Midjourney",
        description: "Midjourney detected via SIEM in Marketing department",
        severity: "MEDIUM",
        source: "shadow_ai",
        status: "OPEN",
      },
    }),
    prisma.alert.create({
      data: {
        title: "Non-compliant system: Resume Screening Tool",
        description: "Resume screening tool fails EU AI Act compliance for human oversight",
        severity: "CRITICAL",
        source: "compliance",
        status: "OPEN",
      },
    }),
    prisma.alert.create({
      data: {
        title: "ChatGPT usage spike detected",
        description: "23 users detected accessing ChatGPT - review required",
        severity: "MEDIUM",
        source: "shadow_ai",
        status: "ACKNOWLEDGED",
      },
    }),
  ]);

  // Create API Usage Logs
  const providers = ["claude", "chatgpt"];
  const models = ["claude-sonnet-4-20250514", "gpt-4", "gpt-3.5-turbo", "claude-haiku-4-5-20251001"];
  const departments = ["Engineering", "Marketing", "Legal", "Customer Success"];

  for (let i = 0; i < 30; i++) {
    const provider = providers[Math.floor(Math.random() * providers.length)];
    const model = models[Math.floor(Math.random() * models.length)];
    const promptTokens = Math.floor(Math.random() * 2000) + 100;
    const completionTokens = Math.floor(Math.random() * 1000) + 50;

    await prisma.aPIUsageLog.create({
      data: {
        userId: admin.id,
        provider,
        model,
        department: departments[Math.floor(Math.random() * departments.length)],
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost: (promptTokens * 0.000003 + completionTokens * 0.000015),
        flagged: Math.random() < 0.1,
        flagReason: Math.random() < 0.1 ? "Sensitive data detected in prompt" : null,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)),
      },
    });
  }

  console.log("Seed data created successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
