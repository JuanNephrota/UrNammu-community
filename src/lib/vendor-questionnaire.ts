// Vendor security & data-handling questionnaire.
//
// The question bank is static so answers stay comparable across vendors and
// over time. Each question names the answer that represents the *safe*
// posture; scoring measures distance from it, weighted, so a higher score
// means more vendor risk (matching the 0-100 convention of vendor-risk.ts).

export type VendorAnswerValue = "yes" | "partial" | "no" | "unknown" | "na";

export type VendorAnswer = {
  value: VendorAnswerValue;
  note?: string;
};

export type VendorAnswers = Record<string, VendorAnswer>;

export type VendorQuestion = {
  id: string;
  prompt: string;
  helper: string;
  /** The answer that represents the low-risk posture. */
  safeAnswer: "yes" | "no";
  weight: 1 | 2 | 3;
  /** A risky or unknown answer here forces the vendor to at least HIGH. */
  critical?: boolean;
  /** Offer "Not applicable" (e.g. BAA when no PHI is in scope). */
  allowNa?: boolean;
};

export type VendorQuestionSection = {
  id: string;
  title: string;
  /** Label for the wizard stepper. */
  shortTitle: string;
  description: string;
  questions: VendorQuestion[];
};

export const VENDOR_QUESTION_SECTIONS: VendorQuestionSection[] = [
  {
    id: "assurance",
    title: "Security assurance",
    shortTitle: "Assurance",
    description: "Independent evidence that the vendor runs a mature security program.",
    questions: [
      {
        id: "soc2_type2",
        prompt: "Has the vendor provided a current SOC 2 Type II report?",
        helper: "Current means the audit period ended within the last 12 months.",
        safeAnswer: "yes",
        weight: 3,
      },
      {
        id: "iso27001",
        prompt: "Is the vendor ISO/IEC 27001 certified?",
        helper: "Check the certificate scope covers the AI product you are buying.",
        safeAnswer: "yes",
        weight: 1,
      },
      {
        id: "pentest",
        prompt: "Has a third-party penetration test been completed in the last 12 months?",
        helper: "Ask for the executive summary and remediation status.",
        safeAnswer: "yes",
        weight: 2,
      },
      {
        id: "incident_notice",
        prompt: "Does the contract commit to breach notification within 72 hours?",
        helper: "Look in the DPA or security addendum.",
        safeAnswer: "yes",
        weight: 2,
      },
    ],
  },
  {
    id: "data",
    title: "Data handling",
    shortTitle: "Data",
    description: "What happens to prompts, files and outputs you send the vendor.",
    questions: [
      {
        id: "trains_on_customer_data",
        prompt: "Does the vendor train or fine-tune models on your prompts, files or outputs?",
        helper: "Answer Yes if training is on by default, even if you can opt out.",
        safeAnswer: "no",
        weight: 3,
        critical: true,
      },
      {
        id: "retention_controls",
        prompt: "Can you configure data retention, including zero or short retention?",
        helper: "For example zero-data-retention, or a retention window you control.",
        safeAnswer: "yes",
        weight: 2,
      },
      {
        id: "encryption",
        prompt: "Is data encrypted in transit (TLS 1.2+) and at rest?",
        helper: "Customer-managed keys count as Yes. Vendor-managed keys also count.",
        safeAnswer: "yes",
        weight: 2,
        critical: true,
      },
      {
        id: "human_review",
        prompt: "Can vendor staff read your content, for abuse monitoring or support, without your approval?",
        helper: "Answer No if human review needs your explicit approval or can be switched off.",
        safeAnswer: "no",
        weight: 2,
      },
      {
        id: "residency_choice",
        prompt: "Can you choose the region where data is processed and stored?",
        helper: "Record the regions on the vendor profile's data residency step.",
        safeAnswer: "yes",
        weight: 1,
      },
    ],
  },
  {
    id: "access",
    title: "Access & monitoring",
    shortTitle: "Access",
    description: "Whether you can control who uses the tool and see what they did.",
    questions: [
      {
        id: "sso",
        prompt: "Does the vendor support SSO (SAML or OIDC) and enforcing it?",
        helper: "Enforcement means password logins can be switched off.",
        safeAnswer: "yes",
        weight: 2,
      },
      {
        id: "scim",
        prompt: "Does the vendor support SCIM or automated deprovisioning?",
        helper: "Without it, leavers keep access until someone removes them by hand.",
        safeAnswer: "yes",
        weight: 1,
      },
      {
        id: "audit_logs",
        prompt: "Are admin and usage audit logs available and exportable?",
        helper: "An admin API or compliance export that UrNammu could ingest counts as Yes.",
        safeAnswer: "yes",
        weight: 2,
      },
    ],
  },
  {
    id: "ai",
    title: "AI-specific controls",
    shortTitle: "AI controls",
    description: "Model provenance, safety and the vendor's own supply chain.",
    questions: [
      {
        id: "model_disclosure",
        prompt: "Does the vendor disclose which foundation models power the product?",
        helper: "Including when third-party models such as OpenAI or Anthropic are used.",
        safeAnswer: "yes",
        weight: 1,
      },
      {
        id: "subprocessors_disclosed",
        prompt: "Is there a published subprocessor list with change notification?",
        helper: "Record the subprocessors on the vendor profile.",
        safeAnswer: "yes",
        weight: 2,
      },
      {
        id: "safety_filtering",
        prompt: "Does the vendor filter prompts and outputs for harmful content or prompt injection?",
        helper: "Ask how they handle jailbreaks and data exfiltration through tools.",
        safeAnswer: "yes",
        weight: 1,
      },
      {
        id: "ai_governance_framework",
        prompt: "Does the vendor align to an AI governance framework (ISO/IEC 42001, NIST AI RMF)?",
        helper: "Certification or a published mapping both count.",
        safeAnswer: "yes",
        weight: 1,
      },
    ],
  },
  {
    id: "legal",
    title: "Legal & contractual",
    shortTitle: "Legal",
    description: "The paperwork that makes the answers above enforceable.",
    questions: [
      {
        id: "dpa_signed",
        prompt: "Is a data processing agreement (DPA) signed?",
        helper: "Needed for GDPR, CCPA and most state privacy laws.",
        safeAnswer: "yes",
        weight: 3,
        critical: true,
      },
      {
        id: "baa",
        prompt: "If health data is in scope, is a BAA signed?",
        helper: "Choose Not applicable if no PHI will be processed.",
        safeAnswer: "yes",
        weight: 2,
        allowNa: true,
      },
      {
        id: "ip_indemnity",
        prompt: "Does the vendor indemnify you against IP claims over generated output?",
        helper: "Often called a copyright shield or IP indemnity.",
        safeAnswer: "yes",
        weight: 1,
      },
    ],
  },
];

export const VENDOR_QUESTIONS: VendorQuestion[] = VENDOR_QUESTION_SECTIONS.flatMap(
  (section) => section.questions
);

const QUESTION_IDS = new Set(VENDOR_QUESTIONS.map((q) => q.id));
const ANSWER_VALUES = new Set<VendorAnswerValue>(["yes", "partial", "no", "unknown", "na"]);

/** Drops unknown question ids and malformed entries from stored JSON. */
export function parseVendorAnswers(raw: unknown): VendorAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const answers: VendorAnswers = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!QUESTION_IDS.has(id) || !entry || typeof entry !== "object") continue;
    const { value, note } = entry as { value?: unknown; note?: unknown };
    if (typeof value !== "string" || !ANSWER_VALUES.has(value as VendorAnswerValue)) continue;
    answers[id] = {
      value: value as VendorAnswerValue,
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
    };
  }
  return answers;
}

/** 0 = safe posture, 1 = risky. "partial" is half-way; "unknown" is treated as mostly risky. */
function riskFactor(question: VendorQuestion, value: VendorAnswerValue): number | null {
  if (value === "na") return question.allowNa ? null : 0.75;
  if (value === "unknown") return 0.75;
  if (value === "partial") return 0.5;
  return value === question.safeAnswer ? 0 : 1;
}

export type VendorQuestionnaireTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type VendorQuestionnaireFinding = {
  questionId: string;
  prompt: string;
  sectionTitle: string;
  value: VendorAnswerValue;
  critical: boolean;
};

export type VendorQuestionnaireResult = {
  score: number;
  tier: VendorQuestionnaireTier;
  answered: number;
  total: number;
  findings: VendorQuestionnaireFinding[];
  suggestedDecision: "APPROVED" | "CONDITIONAL" | "REJECTED";
};

function tierFromScore(score: number): VendorQuestionnaireTier {
  if (score >= 70) return "CRITICAL";
  if (score >= 45) return "HIGH";
  if (score >= 20) return "MEDIUM";
  return "LOW";
}

const TIER_ORDER: VendorQuestionnaireTier[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function scoreVendorQuestionnaire(answers: VendorAnswers): VendorQuestionnaireResult {
  let weighted = 0;
  let totalWeight = 0;
  let answered = 0;
  let criticalMiss = false;
  const findings: VendorQuestionnaireFinding[] = [];

  for (const section of VENDOR_QUESTION_SECTIONS) {
    for (const question of section.questions) {
      const answer = answers[question.id];
      // Unanswered questions count as unknown so skipping cannot lower the score.
      const value = answer?.value ?? "unknown";
      if (answer) answered += 1;
      const factor = riskFactor(question, value);
      if (factor === null) continue;
      weighted += factor * question.weight;
      totalWeight += question.weight;
      if (factor >= 0.5) {
        findings.push({
          questionId: question.id,
          prompt: question.prompt,
          sectionTitle: section.title,
          value,
          critical: Boolean(question.critical) && factor >= 0.75,
        });
      }
      // "Don't know" (or skipping) a key control is treated like failing it,
      // so it can never earn a better tier than an honest risky answer.
      if (question.critical && factor >= 0.75) criticalMiss = true;
    }
  }

  const score = totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 100);
  let tier = tierFromScore(score);
  if (criticalMiss && TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf("HIGH")) tier = "HIGH";

  const suggestedDecision =
    tier === "CRITICAL" ? "REJECTED" : tier === "HIGH" || findings.length > 0 ? "CONDITIONAL" : "APPROVED";

  findings.sort((a, b) => Number(b.critical) - Number(a.critical));

  return { score, tier, answered, total: VENDOR_QUESTIONS.length, findings, suggestedDecision };
}

export function sectionProgress(section: VendorQuestionSection, answers: VendorAnswers) {
  const answered = section.questions.filter((q) => answers[q.id]).length;
  return { answered, total: section.questions.length, complete: answered === section.questions.length };
}
