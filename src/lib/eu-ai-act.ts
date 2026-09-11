/**
 * EU AI Act classification — pure logic.
 *
 * Takes the answers from the classification wizard and derives the system's
 * risk tier under Regulation (EU) 2024/1689, the obligations that follow, and
 * the article codes those obligations correspond to in the framework control
 * catalog (FrameworkControl.code for EU_AI_ACT). No Prisma here; the API
 * route persists the result and the UI previews it live.
 *
 * Legal notes, kept short:
 * - Art. 5 prohibited practices trump everything.
 * - Art. 6(1): safety components of / products under Annex I harmonisation
 *   legislation that require third-party conformity assessment are high-risk.
 * - Art. 6(2): Annex III use cases are high-risk, unless Art. 6(3) applies —
 *   the system performs a narrow procedural / preparatory / human-improving /
 *   pattern-detection task AND does not profile natural persons. Claiming the
 *   derogation must be documented (Art. 6(4)) and providers still register
 *   the system (Art. 49(2)).
 * - Art. 50 transparency duties apply regardless of tier when the system
 *   interacts with people, generates synthetic content, does emotion
 *   recognition / biometric categorisation, or produces deep fakes.
 * - Art. 27 FRIA applies to deployers that are public bodies or provide
 *   public services, and to deployers of credit-scoring or life/health
 *   insurance risk systems (Annex III points 5(b) and 5(c)).
 * - Dates below are the regulation's own application dates. The Commission's
 *   "digital omnibus" proposal (Nov 2025) would push Annex III high-risk
 *   obligations back; until adopted, the statutory dates stand.
 */

export type EuAiActRole = "PROVIDER" | "DEPLOYER" | "PROVIDER_AND_DEPLOYER";
export type EuAiActTier = "PROHIBITED" | "HIGH_RISK" | "LIMITED_RISK" | "MINIMAL_RISK";

export type EuAiActOption = { id: string; label: string; description: string };

export type EuAiActAnswers = {
  role: EuAiActRole | null;
  prohibitedPractices: string[];
  annexIProduct: boolean | null;
  annexIIICategories: string[];
  derogationGrounds: string[];
  profiling: boolean | null;
  transparencyTriggers: string[];
  usesGpai: boolean | null;
  providesGpai: boolean | null;
  friaTriggers: string[];
};

export const EMPTY_ANSWERS: EuAiActAnswers = {
  role: null,
  prohibitedPractices: [],
  annexIProduct: null,
  annexIIICategories: [],
  derogationGrounds: [],
  profiling: null,
  transparencyTriggers: [],
  usesGpai: null,
  providesGpai: null,
  friaTriggers: [],
};

export const ROLE_OPTIONS: Array<EuAiActOption & { id: EuAiActRole }> = [
  { id: "DEPLOYER", label: "Deployer", description: "We use an AI system supplied by someone else under our authority (most SaaS and vendor tools)." },
  { id: "PROVIDER", label: "Provider", description: "We develop the system, or have it developed, and place it on the market or put it into service under our own name." },
  { id: "PROVIDER_AND_DEPLOYER", label: "Provider and deployer", description: "We built it and we use it ourselves (internal tools built in-house on a foundation model count here)." },
];

export const PROHIBITED_PRACTICES: EuAiActOption[] = [
  { id: "subliminal_manipulation", label: "Subliminal or manipulative techniques", description: "Materially distorts behaviour in a way that causes or is likely to cause significant harm (Art. 5(1)(a))." },
  { id: "exploits_vulnerabilities", label: "Exploits vulnerabilities", description: "Exploits age, disability, or social/economic situation to distort behaviour and cause significant harm (Art. 5(1)(b))." },
  { id: "social_scoring", label: "Social scoring", description: "Evaluates or classifies people on social behaviour or personal traits leading to detrimental treatment in unrelated contexts (Art. 5(1)(c))." },
  { id: "predictive_policing_profiling", label: "Predictive policing based solely on profiling", description: "Assesses the risk of a person committing a criminal offence based solely on profiling or personality traits (Art. 5(1)(d))." },
  { id: "facial_scraping", label: "Untargeted facial-image scraping", description: "Builds or expands facial recognition databases by untargeted scraping of the internet or CCTV (Art. 5(1)(e))." },
  { id: "workplace_emotion_recognition", label: "Emotion recognition at work or in education", description: "Infers emotions of people in the workplace or education institutions, except for medical or safety reasons (Art. 5(1)(f))." },
  { id: "biometric_categorisation_protected", label: "Biometric categorisation of protected attributes", description: "Categorises people by biometric data to infer race, political opinions, union membership, religion, sex life or orientation (Art. 5(1)(g))." },
  { id: "realtime_remote_biometric_id", label: "Real-time remote biometric identification for law enforcement", description: "In publicly accessible spaces, outside the narrow exceptions (Art. 5(1)(h))." },
];

export const ANNEX_III_CATEGORIES: EuAiActOption[] = [
  { id: "biometrics", label: "Biometrics", description: "Remote biometric identification, biometric categorisation by sensitive attributes, or emotion recognition (Annex III, 1)." },
  { id: "critical_infrastructure", label: "Critical infrastructure", description: "Safety components in the management of critical digital infrastructure, road traffic, or water, gas, heating or electricity supply (Annex III, 2)." },
  { id: "education", label: "Education and vocational training", description: "Admission, assessment of learning outcomes, evaluating education level, or monitoring prohibited behaviour during tests (Annex III, 3)." },
  { id: "employment", label: "Employment and workers management", description: "Recruitment, screening, evaluating candidates, promotion/termination decisions, task allocation, or monitoring workers (Annex III, 4)." },
  { id: "essential_services", label: "Essential private and public services", description: "Eligibility for public benefits, creditworthiness / credit scoring, life and health insurance risk pricing, or emergency call triage (Annex III, 5)." },
  { id: "law_enforcement", label: "Law enforcement", description: "Victim risk assessment, polygraphs, evidence reliability, recidivism risk, or profiling in criminal investigations (Annex III, 6)." },
  { id: "migration", label: "Migration, asylum and border control", description: "Risk assessment, application examination, or identification of persons in migration and border contexts (Annex III, 7)." },
  { id: "justice_democracy", label: "Justice and democratic processes", description: "Assisting judicial authorities in researching and interpreting facts and law, or influencing the outcome of elections (Annex III, 8)." },
];

export const DEROGATION_GROUNDS: EuAiActOption[] = [
  { id: "narrow_procedural", label: "Narrow procedural task", description: "e.g. transforming unstructured data into structured data, classifying documents, or detecting duplicates (Art. 6(3)(a))." },
  { id: "improves_human_result", label: "Improves the result of a previously completed human activity", description: "Adds a layer on top of a human decision without replacing it, such as polishing language (Art. 6(3)(b))." },
  { id: "pattern_detection_only", label: "Detects decision patterns or deviations without replacing human assessment", description: "Flags inconsistencies for a human to review; does not influence the assessment without proper human review (Art. 6(3)(c))." },
  { id: "preparatory_task", label: "Preparatory task to an assessment", description: "Indexing, searching, text processing or translation that feeds a later human-led assessment (Art. 6(3)(d))." },
];

export const TRANSPARENCY_TRIGGERS: EuAiActOption[] = [
  { id: "interacts_with_persons", label: "Interacts directly with people", description: "Chatbots, voice assistants, or any interface where a person may not realise they are talking to AI (Art. 50(1))." },
  { id: "synthetic_content", label: "Generates synthetic audio, image, video or text", description: "Output must be marked machine-readable as artificially generated (Art. 50(2))." },
  { id: "emotion_or_biometric", label: "Emotion recognition or biometric categorisation", description: "Exposed persons must be informed (Art. 50(3))." },
  { id: "deepfake", label: "Produces or manipulates deep fakes", description: "Image, audio or video resembling real persons, places or events must be disclosed (Art. 50(4))." },
  { id: "public_interest_text", label: "Publishes AI-generated text on matters of public interest", description: "Unless human-reviewed with editorial responsibility, disclosure is required (Art. 50(4))." },
];

export const FRIA_TRIGGERS: EuAiActOption[] = [
  { id: "public_body", label: "We are a public body", description: "Bodies governed by public law deploying a high-risk system (Art. 27(1))." },
  { id: "public_services", label: "We provide public services", description: "Private entities providing public services such as healthcare, education, housing or social services (Art. 27(1))." },
  { id: "credit_scoring", label: "Creditworthiness or credit scoring of natural persons", description: "Annex III point 5(b)." },
  { id: "insurance_pricing", label: "Life or health insurance risk assessment and pricing", description: "Annex III point 5(c)." },
];

export const EU_AI_ACT_MILESTONES = {
  prohibitions: "2025-02-02",
  literacy: "2025-02-02",
  gpai: "2025-08-02",
  transparency: "2026-08-02",
  annexIIIHighRisk: "2026-08-02",
  annexIHighRisk: "2027-08-02",
} as const;

export const TIER_LABELS: Record<EuAiActTier, string> = {
  PROHIBITED: "Prohibited",
  HIGH_RISK: "High-risk",
  LIMITED_RISK: "Limited risk",
  MINIMAL_RISK: "Minimal risk",
};

export const ROLE_LABELS: Record<EuAiActRole, string> = {
  PROVIDER: "Provider",
  DEPLOYER: "Deployer",
  PROVIDER_AND_DEPLOYER: "Provider and deployer",
};

export type EuAiActObligation = {
  /** FrameworkControl.code for EU_AI_ACT, e.g. "Art. 26". */
  code: string;
  why: string;
};

export type EuAiActClassificationResult = {
  tier: EuAiActTier;
  role: EuAiActRole;
  annexIProduct: boolean;
  annexIIICategories: string[];
  derogationClaimed: boolean;
  transparencyRequired: boolean;
  friaRequired: boolean;
  gpaiDeployer: boolean;
  gpaiProvider: boolean;
  obligations: EuAiActObligation[];
  applicableArticles: string[];
  rationale: string[];
  warnings: string[];
  deadline: { date: string; label: string } | null;
};

export type EuAiActCompleteness = { complete: boolean; missing: string[] };

/**
 * Which questions still need an answer. The wizard uses this to gate the
 * final step; the API uses it to reject partial submissions.
 */
export function checkCompleteness(a: EuAiActAnswers): EuAiActCompleteness {
  const missing: string[] = [];
  if (!a.role) missing.push("role");
  if (a.annexIProduct === null) missing.push("annexIProduct");
  if (a.usesGpai === null) missing.push("usesGpai");
  if (a.annexIIICategories.length > 0 && a.derogationGrounds.length > 0 && a.profiling === null) {
    missing.push("profiling");
  }
  return { complete: missing.length === 0, missing };
}

function isDeployer(role: EuAiActRole) {
  return role === "DEPLOYER" || role === "PROVIDER_AND_DEPLOYER";
}
function isProvider(role: EuAiActRole) {
  return role === "PROVIDER" || role === "PROVIDER_AND_DEPLOYER";
}

function labelFor(options: EuAiActOption[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? id;
}

export function classifyEuAiAct(a: EuAiActAnswers): EuAiActClassificationResult {
  const role: EuAiActRole = a.role ?? "DEPLOYER";
  const rationale: string[] = [];
  const warnings: string[] = [];
  const obligations: EuAiActObligation[] = [];
  const add = (code: string, why: string) => {
    if (!obligations.some((o) => o.code === code)) obligations.push({ code, why });
  };

  const annexIProduct = a.annexIProduct === true;
  const annexIII = a.annexIIICategories;
  const derogationEligible =
    annexIII.length > 0 && a.derogationGrounds.length > 0 && a.profiling === false;
  const derogationClaimed = derogationEligible && !annexIProduct;
  const transparencyRequired = a.transparencyTriggers.length > 0;
  const gpaiDeployer = a.usesGpai === true;
  const gpaiProvider = a.providesGpai === true;

  let tier: EuAiActTier;
  if (a.prohibitedPractices.length > 0) {
    tier = "PROHIBITED";
    rationale.push(
      `Matches a prohibited practice under Art. 5: ${a.prohibitedPractices
        .map((id) => labelFor(PROHIBITED_PRACTICES, id))
        .join("; ")}. The system may not be placed on the market, put into service or used in the EU.`
    );
  } else if (annexIProduct) {
    tier = "HIGH_RISK";
    rationale.push(
      "High-risk under Art. 6(1): the system is, or is a safety component of, a product covered by Annex I Union harmonisation legislation requiring third-party conformity assessment."
    );
  } else if (annexIII.length > 0 && !derogationClaimed) {
    tier = "HIGH_RISK";
    rationale.push(
      `High-risk under Art. 6(2): intended use falls within Annex III — ${annexIII
        .map((id) => labelFor(ANNEX_III_CATEGORIES, id))
        .join("; ")}.`
    );
    if (a.derogationGrounds.length > 0 && a.profiling === true) {
      rationale.push(
        "The Art. 6(3) derogation was considered but does not apply because the system performs profiling of natural persons (Art. 6(3), final subparagraph)."
      );
    }
  } else if (transparencyRequired) {
    tier = "LIMITED_RISK";
    rationale.push(
      `Not high-risk, but Art. 50 transparency obligations apply: ${a.transparencyTriggers
        .map((id) => labelFor(TRANSPARENCY_TRIGGERS, id))
        .join("; ")}.`
    );
  } else {
    tier = "MINIMAL_RISK";
    rationale.push(
      "Not prohibited, not an Annex I product, not an Annex III use case (or the Art. 6(3) derogation applies), and no Art. 50 transparency trigger. Only the general AI-literacy duty and voluntary codes of conduct apply."
    );
  }

  if (derogationClaimed) {
    rationale.push(
      `Annex III area identified (${annexIII
        .map((id) => labelFor(ANNEX_III_CATEGORIES, id))
        .join("; ")}) but the Art. 6(3) derogation is claimed: ${a.derogationGrounds
        .map((id) => labelFor(DEROGATION_GROUNDS, id))
        .join("; ")}, and the system does not profile natural persons.`
    );
    warnings.push(
      "Document the Art. 6(3) assessment before deployment (Art. 6(4)) and keep it available to authorities. Providers must still register the system in the EU database (Art. 49(2))."
    );
  }

  // ── Obligations → article codes ────────────────────────────────────────
  add("Art. 4", "AI literacy applies to every provider and deployer regardless of tier.");

  if (tier === "PROHIBITED") {
    add("Art. 5", "The identified practice is prohibited; withdraw the system or redesign it so the practice no longer applies.");
  }

  if (tier === "HIGH_RISK") {
    if (isProvider(role)) {
      add("Art. 9", "Providers of high-risk systems maintain a lifecycle risk management system.");
      add("Art. 10", "Training, validation and testing data are subject to data governance requirements.");
      add("Art. 11", "Technical documentation (Annex IV) before placing on the market.");
      add("Art. 12", "Automatic event logging over the system's lifetime.");
      add("Art. 13", "Transparency and instructions for use to deployers.");
      add("Art. 14", "Human oversight measures designed into the system.");
      add("Art. 15", "Accuracy, robustness and cybersecurity.");
      add("Art. 16", "Umbrella provider obligations for high-risk systems.");
      add("Art. 17", "Quality management system.");
      add("Art. 43", "Conformity assessment before market placement and after substantial modification.");
      add("Art. 49", "Registration in the EU database.");
      add("Art. 72", "Post-market monitoring system.");
      add("Art. 73", "Serious incident reporting.");
    }
    if (isDeployer(role)) {
      add("Art. 26", "Deployer obligations: use per instructions, assign trained human oversight, ensure relevant input data, monitor, keep logs, inform affected persons.");
      add("Art. 14", "Deployers assign human oversight to competent persons and act on the provider's oversight measures (Art. 26(2)).");
      add("Art. 12", "Deployers keep the logs generated by the system for at least six months (Art. 26(6)).");
      add("Art. 73", "Deployers report serious incidents to the provider and authorities (Art. 26(5)).");
      if (a.friaTriggers.length > 0) {
        add("Art. 27", `Fundamental rights impact assessment required: ${a.friaTriggers
          .map((id) => labelFor(FRIA_TRIGGERS, id))
          .join("; ")}.`);
      }
      if (a.friaTriggers.includes("public_body")) {
        add("Art. 49", "Public-authority deployers register their use of the high-risk system (Art. 49(3)).");
      }
    }
  }

  if (derogationClaimed && isProvider(role)) {
    add("Art. 49", "Providers claiming the Art. 6(3) derogation register the system in the EU database (Art. 49(2)).");
  }

  if (transparencyRequired) {
    add("Art. 50", `Transparency obligations: ${a.transparencyTriggers
      .map((id) => labelFor(TRANSPARENCY_TRIGGERS, id))
      .join("; ")}.`);
  }

  if (gpaiProvider) {
    add("Art. 53", "As a provider of a general-purpose AI model: technical documentation, downstream information, copyright policy, training-content summary.");
  } else if (gpaiDeployer) {
    add("Art. 53", "The system is built on a general-purpose AI model: confirm the model provider meets its Art. 53 obligations and retain the downstream documentation it supplies.");
  }

  const friaRequired = tier === "HIGH_RISK" && isDeployer(role) && a.friaTriggers.length > 0;

  if (tier === "HIGH_RISK" && isDeployer(role) && a.friaTriggers.length === 0) {
    warnings.push(
      "No Art. 27 FRIA trigger was selected. Re-check if the organisation is a public body, provides public services, or the use case involves credit scoring or life/health insurance."
    );
  }
  if (transparencyRequired && tier === "HIGH_RISK") {
    rationale.push("Art. 50 transparency obligations apply in addition to the high-risk requirements.");
  }

  // ── Deadline ───────────────────────────────────────────────────────────
  let deadline: EuAiActClassificationResult["deadline"] = null;
  if (tier === "PROHIBITED") {
    deadline = { date: EU_AI_ACT_MILESTONES.prohibitions, label: "Prohibitions (Art. 5)" };
  } else if (tier === "HIGH_RISK" && annexIProduct) {
    deadline = { date: EU_AI_ACT_MILESTONES.annexIHighRisk, label: "Annex I high-risk obligations" };
  } else if (tier === "HIGH_RISK") {
    deadline = { date: EU_AI_ACT_MILESTONES.annexIIIHighRisk, label: "Annex III high-risk obligations" };
  } else if (tier === "LIMITED_RISK") {
    deadline = { date: EU_AI_ACT_MILESTONES.transparency, label: "Transparency obligations (Art. 50)" };
  } else if (gpaiProvider) {
    deadline = { date: EU_AI_ACT_MILESTONES.gpai, label: "GPAI provider obligations (Art. 53)" };
  } else {
    deadline = { date: EU_AI_ACT_MILESTONES.literacy, label: "AI literacy (Art. 4)" };
  }

  const articleOrder = (code: string) => Number(code.replace(/[^0-9]/g, "")) || 0;
  obligations.sort((x, y) => articleOrder(x.code) - articleOrder(y.code));

  return {
    tier,
    role,
    annexIProduct,
    annexIIICategories: annexIII,
    derogationClaimed,
    transparencyRequired,
    friaRequired,
    gpaiDeployer,
    gpaiProvider,
    obligations,
    applicableArticles: obligations.map((o) => o.code),
    rationale,
    warnings,
    deadline,
  };
}

export function describeDeadline(deadline: { date: string; label: string } | null, now = new Date()): string {
  if (!deadline) return "";
  const d = new Date(`${deadline.date}T00:00:00Z`);
  const formatted = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return d.getTime() <= now.getTime()
    ? `${deadline.label} — in force since ${formatted}`
    : `${deadline.label} — applies from ${formatted}`;
}

/** Badge tone per tier, matching the Badge component variants. */
export function tierBadgeVariant(tier: EuAiActTier): "critical" | "high" | "medium" | "low" {
  switch (tier) {
    case "PROHIBITED":
      return "critical";
    case "HIGH_RISK":
      return "high";
    case "LIMITED_RISK":
      return "medium";
    default:
      return "low";
  }
}

/** Coerces a stored JSON answers blob back into a well-formed answers object. */
export function normalizeAnswers(raw: unknown): EuAiActAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
  const role = typeof r.role === "string" && (ROLE_OPTIONS as { id: string }[]).some((o) => o.id === r.role)
    ? (r.role as EuAiActRole)
    : null;
  return {
    role,
    prohibitedPractices: strs(r.prohibitedPractices),
    annexIProduct: bool(r.annexIProduct),
    annexIIICategories: strs(r.annexIIICategories),
    derogationGrounds: strs(r.derogationGrounds),
    profiling: bool(r.profiling),
    transparencyTriggers: strs(r.transparencyTriggers),
    usesGpai: bool(r.usesGpai),
    providesGpai: bool(r.providesGpai),
    friaTriggers: strs(r.friaTriggers),
  };
}
