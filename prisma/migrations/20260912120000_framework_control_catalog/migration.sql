-- AlterTable
ALTER TABLE "ComplianceMapping" ADD COLUMN     "assessedAt" TIMESTAMP(3),
ADD COLUMN     "controlId" TEXT;

-- CreateTable
CREATE TABLE "FrameworkControl" (
    "id" TEXT NOT NULL,
    "framework" "ComplianceFramework" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "builtIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlCrosswalk" (
    "id" TEXT NOT NULL,
    "fromControlId" TEXT NOT NULL,
    "toControlId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlCrosswalk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FrameworkControl_framework_sortOrder_idx" ON "FrameworkControl"("framework", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FrameworkControl_framework_code_key" ON "FrameworkControl"("framework", "code");

-- CreateIndex
CREATE INDEX "ControlCrosswalk_toControlId_idx" ON "ControlCrosswalk"("toControlId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlCrosswalk_fromControlId_toControlId_key" ON "ControlCrosswalk"("fromControlId", "toControlId");

-- CreateIndex
CREATE INDEX "ComplianceMapping_aiSystemId_framework_idx" ON "ComplianceMapping"("aiSystemId", "framework");

-- CreateIndex
CREATE INDEX "ComplianceMapping_controlId_idx" ON "ComplianceMapping"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceMapping_aiSystemId_controlId_key" ON "ComplianceMapping"("aiSystemId", "controlId");

-- AddForeignKey
ALTER TABLE "ComplianceMapping" ADD CONSTRAINT "ComplianceMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "FrameworkControl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlCrosswalk" ADD CONSTRAINT "ControlCrosswalk_fromControlId_fkey" FOREIGN KEY ("fromControlId") REFERENCES "FrameworkControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlCrosswalk" ADD CONSTRAINT "ControlCrosswalk_toControlId_fkey" FOREIGN KEY ("toControlId") REFERENCES "FrameworkControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the built-in framework control catalog. Mirrors src/lib/framework-catalog.ts —
-- keep the two in sync (regenerate with `npx tsx scripts/gen-framework-catalog-sql.ts`).
INSERT INTO "FrameworkControl" ("id", "framework", "code", "title", "description", "category", "sortOrder", "builtIn", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 4', 'AI literacy', 'Providers and deployers take measures to ensure a sufficient level of AI literacy of their staff and other persons dealing with the operation and use of AI systems on their behalf, taking into account their technical knowledge, context of use and the persons affected.', 'Chapter I — General provisions', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 5', 'Prohibited AI practices', 'The system does not engage in a prohibited practice: subliminal or manipulative techniques causing significant harm, exploitation of vulnerabilities, social scoring, predictive policing based solely on profiling, untargeted facial-image scraping, emotion recognition in workplaces or education, biometric categorisation inferring protected attributes, or real-time remote biometric identification in public spaces for law enforcement (save narrow exceptions).', 'Chapter II — Prohibited practices', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 9', 'Risk management system', 'A continuous, iterative risk management system is established, implemented, documented and maintained throughout the lifecycle of the high-risk AI system: identify and analyse known and reasonably foreseeable risks, evaluate risks from intended use and misuse, adopt targeted risk management measures, and test against defined metrics.', 'Chapter III — High-risk: requirements', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 10', 'Data and data governance', 'Training, validation and testing data sets are subject to data governance and management practices appropriate for the intended purpose: design choices, provenance and collection, preparation, assumptions, bias examination and mitigation, gaps and shortcomings, and relevance/representativeness for the deployment context.', 'Chapter III — High-risk: requirements', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 11', 'Technical documentation', 'Technical documentation is drawn up before the system is placed on the market or put into service and kept up to date, demonstrating compliance with Section 2 requirements and containing at minimum the elements in Annex IV.', 'Chapter III — High-risk: requirements', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 12', 'Record-keeping', 'The system technically allows for the automatic recording of events (logs) over its lifetime, at a level of traceability appropriate to the intended purpose, enabling identification of risk situations, post-market monitoring and deployer oversight.', 'Chapter III — High-risk: requirements', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 13', 'Transparency and provision of information to deployers', 'The system is designed so its operation is sufficiently transparent for deployers to interpret and use the output appropriately, and is accompanied by instructions for use covering characteristics, capabilities, limitations, performance, human oversight measures and expected lifetime.', 'Chapter III — High-risk: requirements', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 14', 'Human oversight', 'The system is designed and developed so it can be effectively overseen by natural persons during use, with measures enabling overseers to understand capacities and limitations, remain aware of automation bias, correctly interpret output, decide not to use or to override the system, and intervene or halt it.', 'Chapter III — High-risk: requirements', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 15', 'Accuracy, robustness and cybersecurity', 'The system achieves an appropriate level of accuracy, robustness and cybersecurity and performs consistently throughout its lifecycle, with declared accuracy metrics, resilience to errors and faults, and protection against data poisoning, model poisoning, adversarial examples and confidentiality attacks.', 'Chapter III — High-risk: requirements', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 16', 'Obligations of providers of high-risk AI systems', 'Providers ensure compliance with Section 2 requirements, indicate their name and contact details, have a quality management system, keep documentation and logs, undergo conformity assessment, draw up an EU declaration of conformity, affix CE marking, register the system, take corrective actions and cooperate with authorities.', 'Chapter III — High-risk: provider obligations', 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 17', 'Quality management system', 'A quality management system is in place, documented as written policies, procedures and instructions, covering regulatory compliance strategy, design and development control, testing and validation, technical specifications, data management, risk management, post-market monitoring, incident reporting, communication with authorities, record-keeping, resource management and accountability.', 'Chapter III — High-risk: provider obligations', 110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 26', 'Obligations of deployers of high-risk AI systems', 'Deployers use the system in accordance with its instructions, assign human oversight to competent and trained persons, ensure input data is relevant and representative, monitor operation and inform the provider/distributor of risks or incidents, keep logs for at least six months, inform workers'' representatives and affected persons where applicable, and cooperate with authorities.', 'Chapter III — High-risk: deployer obligations', 120, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 27', 'Fundamental rights impact assessment', 'Before deploying a high-risk AI system, deployers that are public bodies or private entities providing public services (and deployers of credit-scoring or life/health insurance risk systems) perform an assessment of the impact on fundamental rights: processes, period and frequency of use, categories of persons affected, specific risks of harm, human oversight measures, and measures if risks materialise.', 'Chapter III — High-risk: deployer obligations', 130, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 43', 'Conformity assessment', 'The applicable conformity assessment procedure is followed before the system is placed on the market or put into service — internal control (Annex VI) or a notified-body assessment of the quality management system and technical documentation (Annex VII) — and repeated after substantial modification.', 'Chapter III — High-risk: conformity', 140, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 49', 'Registration in the EU database', 'The provider (and, for public-authority deployers, the deployer) registers the high-risk AI system in the EU database referred to in Article 71 before placing it on the market or putting it into service.', 'Chapter III — High-risk: conformity', 150, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 50', 'Transparency obligations for certain AI systems', 'Systems intended to interact directly with natural persons inform them they are interacting with AI; synthetic audio, image, video or text output is marked in a machine-readable format; deployers of emotion recognition or biometric categorisation inform exposed persons; deep fakes and AI-generated text on matters of public interest are disclosed.', 'Chapter IV — Transparency obligations', 160, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 53', 'Obligations for providers of general-purpose AI models', 'Providers of GPAI models draw up and maintain technical documentation, provide information to downstream providers, put in place a copyright-compliance policy, and publish a sufficiently detailed summary of training content. Deployers should confirm their GPAI provider meets these obligations.', 'Chapter V — General-purpose AI models', 170, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 72', 'Post-market monitoring by providers', 'A post-market monitoring system is established and documented, proportionate to the nature of the AI technologies and risks, that actively and systematically collects, documents and analyses performance data throughout the system''s lifetime to evaluate continuous compliance.', 'Chapter IX — Post-market monitoring', 180, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EU_AI_ACT'::"ComplianceFramework", 'Art. 73', 'Reporting of serious incidents', 'Serious incidents are reported to the market surveillance authorities of the Member State where the incident occurred, immediately after a causal link is established and no later than 15 days (2 days for widespread infringement, 10 days for death), followed by investigation and corrective action.', 'Chapter IX — Post-market monitoring', 190, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'GOVERN 1', 'Policies, processes and procedures for AI risk', 'Policies, processes, procedures and practices across the organisation related to the mapping, measuring and managing of AI risks are in place, transparent and implemented effectively. Includes legal/regulatory tracking, risk tolerance, and lifecycle-wide risk management.', 'Govern', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'GOVERN 2', 'Accountability structures', 'Accountability structures are in place so that the appropriate teams and individuals are empowered, responsible and trained for mapping, measuring and managing AI risks. Roles and responsibilities are documented and executive leadership takes responsibility for AI risk decisions.', 'Govern', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'GOVERN 3', 'Workforce diversity, equity, inclusion and accessibility', 'Workforce diversity, equity, inclusion and accessibility processes are prioritised in the mapping, measuring and managing of AI risks throughout the lifecycle, and roles for human-AI configurations and oversight are defined.', 'Govern', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'GOVERN 4', 'Culture of AI risk awareness', 'Organisational teams are committed to a culture that considers and communicates AI risk. Practices foster critical thinking and safety-first mindsets, document risks and impacts, and test for risk before deployment.', 'Govern', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'GOVERN 5', 'Engagement with relevant AI actors', 'Processes are in place for robust engagement with relevant AI actors, including collecting and integrating feedback from external stakeholders and affected communities about system impacts.', 'Govern', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'GOVERN 6', 'Third-party and supply chain risk policies', 'Policies and procedures are in place to address AI risks and benefits arising from third-party software and data and other supply chain issues, including contingency processes for third-party failures.', 'Govern', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MAP 1', 'Context is established and understood', 'Intended purposes, potentially beneficial uses, context-specific laws and norms, expectations and prospective settings for deployment are understood and documented, along with organisational risk tolerances and the business value of the system.', 'Map', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MAP 2', 'Categorisation of the AI system', 'The AI system is categorised: the specific tasks and methods used to implement them (classifiers, generative models, recommenders), knowledge limits and the extent of human oversight are defined and documented.', 'Map', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MAP 3', 'Capabilities, usage, goals and expected benefits and costs', 'AI capabilities, targeted usage, goals and expected benefits and costs compared with appropriate benchmarks are understood, including the potential for the system to be used in ways outside its intended purpose.', 'Map', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MAP 4', 'Risks and benefits of all components', 'Risks and benefits are mapped for all components of the AI system including third-party software, pre-trained models and data. Internal risk controls for third-party components are identified and documented.', 'Map', 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MAP 5', 'Impacts to individuals, groups, communities and society', 'Likelihood and magnitude of each identified impact — positive or negative — to individuals, groups, communities, organisations and society are characterised, informed by engagement with affected parties.', 'Map', 110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MEASURE 1', 'Appropriate methods and metrics', 'Approaches and metrics for measurement of AI risks enumerated during the MAP function are selected, applied and documented, including metrics for risks that cannot be measured directly. Independent assessors are involved where appropriate.', 'Measure', 120, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MEASURE 2', 'Evaluation for trustworthy characteristics', 'AI systems are evaluated for trustworthy characteristics: validity and reliability, safety, security and resilience, accountability and transparency, explainability, privacy, and fairness with harmful bias managed. Evaluations use representative conditions and test sets.', 'Measure', 130, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MEASURE 3', 'Tracking identified risks over time', 'Mechanisms for tracking identified AI risks over time are in place, including approaches for identifying and tracking emergent risks and end-user/affected-party feedback about performance.', 'Measure', 140, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MEASURE 4', 'Feedback about measurement efficacy', 'Feedback about the efficacy of measurement is gathered and assessed. Measurement approaches are connected to deployment context and are validated with domain experts and affected users.', 'Measure', 150, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MANAGE 1', 'Risks are prioritised, responded to and managed', 'AI risks based on assessments and other analytical output from the MAP and MEASURE functions are prioritised, responded to and managed. Go/no-go decisions are documented; residual risks are documented for downstream acquirers and end users.', 'Manage', 160, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MANAGE 2', 'Strategies to maximise benefits and minimise negative impacts', 'Strategies to maximise AI benefits and minimise negative impacts are planned, prepared, implemented, documented and informed by input from relevant AI actors, including mechanisms to supersede, disengage or deactivate systems that perform inconsistently with intended use.', 'Manage', 170, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MANAGE 3', 'Third-party risks and benefits are managed', 'AI risks and benefits from third-party entities — pre-trained models, vendor-hosted services, external data — are regularly monitored, and risk controls are applied and documented.', 'Manage', 180, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NIST_AI_RMF'::"ComplianceFramework", 'MANAGE 4', 'Risk treatments, response, recovery and communication plans', 'Risk treatments including response and recovery, and communication plans for the identified and measured AI risks, are documented and monitored regularly. Post-deployment monitoring, incident response and change management are in place.', 'Manage', 190, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.2.2', 'AI policy', 'The organisation documents a policy for the development or use of AI systems, aligned with business strategy, values, and legal requirements, and communicates it to relevant parties.', 'A.2 Policies related to AI', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.2.3', 'Alignment with other organisational policies', 'The organisation determines where other policies (security, privacy, quality, risk) are affected by or apply to its objectives with respect to AI systems, and reconciles them.', 'A.2 Policies related to AI', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.2.4', 'Review of the AI policy', 'The AI policy is reviewed at planned intervals or when significant changes occur to ensure continuing suitability, adequacy and effectiveness.', 'A.2 Policies related to AI', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.3.2', 'AI roles and responsibilities', 'Roles and responsibilities for AI are defined and allocated according to the needs of the organisation, covering risk management, impact assessment, development, operations and oversight.', 'A.3 Internal organisation', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.3.3', 'Reporting of concerns', 'A process is defined for reporting concerns about the organisation''s role with respect to an AI system throughout its lifecycle, with protection for those raising concerns.', 'A.3 Internal organisation', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.4.2', 'Resource documentation', 'Relevant resources required for the activities at given AI system lifecycle stages are identified and documented: data, tooling, system and computing, and human resources.', 'A.4 Resources for AI systems', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.4.3', 'Data resources', 'Information about the data resources used for the AI system is documented, including provenance, categories, intended use, and known quality and bias characteristics.', 'A.4 Resources for AI systems', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.4.4', 'Tooling resources', 'Information about the tooling resources used for the AI system — development frameworks, evaluation tools, deployment platforms — is documented.', 'A.4 Resources for AI systems', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.4.5', 'System and computing resources', 'Information about the system and computing resources used for the AI system is documented, including hosting location, capacity and dependencies.', 'A.4 Resources for AI systems', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.4.6', 'Human resources', 'Information about the human resources and their competences used for the development, deployment, operation, change management, maintenance and oversight of the AI system is documented.', 'A.4 Resources for AI systems', 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.5.2', 'AI system impact assessment process', 'A process is established to assess the potential consequences for individuals, groups and societies that can result from the AI system throughout its lifecycle.', 'A.5 Assessing impacts of AI systems', 110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.5.3', 'Documentation of AI system impact assessments', 'Results of AI system impact assessments are documented and retained for a defined period.', 'A.5 Assessing impacts of AI systems', 120, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.5.4', 'Impact on individuals or groups of individuals', 'Potential impacts of the AI system on individuals or groups — fairness, safety, privacy, accessibility, human rights — are assessed and documented.', 'A.5 Assessing impacts of AI systems', 130, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.5.5', 'Societal impacts of AI systems', 'Potential societal impacts of the AI system — environmental, economic, governmental, cultural — are assessed and documented.', 'A.5 Assessing impacts of AI systems', 140, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.1.2', 'Objectives for responsible development', 'Objectives guiding the responsible development of AI systems are identified, documented, and integrated into development measures.', 'A.6 AI system life cycle', 150, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.1.3', 'Processes for responsible design and development', 'Specific processes for the responsible design and development of the AI system are defined and documented, covering the full lifecycle from requirements to retirement.', 'A.6 AI system life cycle', 160, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.2', 'AI system requirements and specification', 'Requirements for new AI systems or material enhancements are specified and documented, including intended purpose, performance criteria and constraints.', 'A.6 AI system life cycle', 170, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.3', 'Documentation of AI system design and development', 'The design and development of the AI system is documented based on organisational objectives, documented requirements and specification criteria.', 'A.6 AI system life cycle', 180, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.4', 'AI system verification and validation', 'Verification and validation measures for the AI system are defined and documented, and the criteria for their use are specified, including test data, metrics and acceptance thresholds.', 'A.6 AI system life cycle', 190, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.5', 'AI system deployment', 'A deployment plan is documented and the necessary requirements are met before deployment, including approval gates and rollback provisions.', 'A.6 AI system life cycle', 200, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.6', 'AI system operation and monitoring', 'Necessary elements for the ongoing operation of the AI system are defined and documented, including performance monitoring, drift detection and error handling.', 'A.6 AI system life cycle', 210, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.7', 'AI system technical documentation', 'Technical documentation for each relevant lifecycle stage is prepared and provided to interested parties as required, including model architecture, data, evaluation and known limitations.', 'A.6 AI system life cycle', 220, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.6.2.8', 'AI system recording of event logs', 'Event logs are recorded automatically during operation for a defined period, to support traceability, incident investigation and audit.', 'A.6 AI system life cycle', 230, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.7.2', 'Data for development and enhancement', 'Data management processes related to the development of AI systems are defined, documented and implemented, covering privacy, security, transparency and traceability of data.', 'A.7 Data for AI systems', 240, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.7.3', 'Acquisition of data', 'Details about the acquisition and selection of data used in AI systems are determined and documented, including sources, rights and consent.', 'A.7 Data for AI systems', 250, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.7.4', 'Quality of data for AI systems', 'Requirements for data quality are defined and data used to develop and operate the AI system is ensured to meet them, including representativeness and bias checks.', 'A.7 Data for AI systems', 260, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.7.5', 'Data provenance', 'A process to record the provenance of data used in AI systems over their lifecycle is defined and documented.', 'A.7 Data for AI systems', 270, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.7.6', 'Data preparation', 'Criteria for selecting data preparation methods and the methods used (cleaning, labelling, augmentation, splitting) are defined and documented.', 'A.7 Data for AI systems', 280, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.8.2', 'System documentation and information for users', 'Necessary information about the AI system is determined and provided to users, including capabilities, limitations, intended use and human oversight measures.', 'A.8 Information for interested parties', 290, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.8.3', 'External reporting', 'Interested parties are provided with the capability to report adverse impacts of the AI system.', 'A.8 Information for interested parties', 300, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.8.4', 'Communication of incidents', 'A plan for communicating incidents to users and other interested parties is defined and documented.', 'A.8 Information for interested parties', 310, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.8.5', 'Information for interested parties', 'The organisation determines and documents its obligations to report information about the AI system to interested parties, including regulators.', 'A.8 Information for interested parties', 320, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.9.2', 'Processes for responsible use of AI systems', 'Processes for the responsible use of AI systems are defined and documented, covering acceptable use, monitoring and escalation.', 'A.9 Use of AI systems', 330, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.9.3', 'Objectives for responsible use', 'Objectives guiding the responsible use of AI systems are identified, documented and applied.', 'A.9 Use of AI systems', 340, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.9.4', 'Intended use of the AI system', 'The AI system is used according to its intended uses and accompanying documentation; deviations are identified and managed.', 'A.9 Use of AI systems', 350, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.10.2', 'Allocating responsibilities', 'Responsibilities within the AI system lifecycle are allocated between the organisation, its partners, suppliers, customers and third parties, and documented.', 'A.10 Third-party and customer relationships', 360, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.10.3', 'Suppliers', 'A process is established to ensure that the organisation''s use of services, products or materials provided by suppliers aligns with its approach to responsible AI.', 'A.10 Third-party and customer relationships', 370, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ISO_42001'::"ComplianceFramework", 'A.10.4', 'Customers', 'The organisation ensures its responsible approach to AI considers customer expectations and needs, and provides the information customers require.', 'A.10 Third-party and customer relationships', 380, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC1', 'Control environment', 'The entity demonstrates a commitment to integrity and ethical values, board oversight, defined structures and reporting lines, commitment to competence, and accountability for internal control — including for AI-enabled processes.', 'Common criteria', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC2', 'Communication and information', 'The entity obtains or generates relevant, quality information to support internal control and communicates internally and externally the objectives and responsibilities for internal control, including how AI systems are used.', 'Common criteria', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC3', 'Risk assessment', 'The entity specifies objectives clearly enough to identify and assess risks, identifies and analyses risks to achieving them, considers the potential for fraud, and identifies changes (including new AI capabilities) that could significantly affect internal control.', 'Common criteria', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC4', 'Monitoring activities', 'The entity selects, develops and performs ongoing and separate evaluations to ascertain whether controls are present and functioning, and evaluates and communicates deficiencies in a timely manner.', 'Common criteria', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC5', 'Control activities', 'The entity selects and develops control activities that contribute to mitigating risks, including general controls over technology, and deploys them through policies and procedures.', 'Common criteria', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC6', 'Logical and physical access controls', 'Logical access security software, infrastructure and architectures are implemented over protected information assets; access is provisioned, restricted and removed appropriately; credentials, encryption and physical access are managed.', 'Common criteria', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC7', 'System operations', 'The entity detects and monitors configuration changes and vulnerabilities, monitors system components for anomalies, evaluates security events, responds to incidents, and recovers from them.', 'Common criteria', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC8', 'Change management', 'The entity authorises, designs, develops, configures, documents, tests, approves and implements changes to infrastructure, data, software and procedures — including model and prompt changes — to meet its objectives.', 'Common criteria', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'CC9', 'Risk mitigation', 'The entity identifies, selects and develops risk mitigation activities for risks arising from potential business disruptions, and assesses and manages risks associated with vendors and business partners.', 'Common criteria', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'A1', 'Availability', 'The entity maintains, monitors and evaluates current processing capacity, authorises and implements environmental protections and backup/recovery infrastructure, and tests recovery plan procedures.', 'Availability', 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'C1', 'Confidentiality', 'The entity identifies and maintains confidential information to meet its objectives and disposes of it when no longer needed — including prompts, outputs and training data containing confidential information.', 'Confidentiality', 110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'PI1', 'Processing integrity', 'The entity obtains or generates, uses and communicates relevant quality information regarding processing objectives; implements policies over system inputs, processing and outputs so they are complete, accurate, timely and authorised; and stores inputs and outputs completely and accurately.', 'Processing integrity', 120, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P1', 'Notice and communication of objectives', 'The entity provides notice to data subjects about its privacy practices and objectives, including how personal information is used in AI processing.', 'Privacy', 130, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P2', 'Choice and consent', 'The entity communicates choices available regarding the collection, use, retention, disclosure and disposal of personal information and obtains consent where required.', 'Privacy', 140, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P3', 'Collection', 'The entity collects personal information consistent with its objectives related to privacy, and obtains explicit consent for sensitive information.', 'Privacy', 150, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P4', 'Use, retention and disposal', 'The entity limits use of personal information to the purposes identified, retains it only as long as necessary, and securely disposes of it.', 'Privacy', 160, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P5', 'Access', 'The entity grants data subjects access to their personal information for review and correction.', 'Privacy', 170, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P6', 'Disclosure and notification', 'The entity discloses personal information to third parties only with consent or as permitted, assesses third-party compliance, and notifies affected parties of breaches and incidents.', 'Privacy', 180, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P7', 'Quality', 'The entity collects and maintains accurate, up-to-date, complete and relevant personal information.', 'Privacy', 190, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOC2'::"ComplianceFramework", 'P8', 'Monitoring and enforcement', 'The entity implements a process for receiving, addressing, resolving and communicating the resolution of inquiries, complaints and disputes, and monitors compliance with its privacy commitments.', 'Privacy', 200, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("framework", "code") DO NOTHING;

-- Crosswalk pairs, resolved by (framework, code) so ids need not be known.
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.2.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.2.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.2.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 1'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 17'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 1'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 1'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC5'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.3.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.4.6'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 16'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 2'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.5.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 4'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.3.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 4'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 5'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.8.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 5'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.8.5'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 5'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 6'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.10.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 6'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.10.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'GOVERN 6'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC9'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.9.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 1'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 5'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 1'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 9'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 9'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.1.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.9.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 4'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.4.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 4'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.7.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 4'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.10.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 5'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.5.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 5'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.5.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 5'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.5.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 5'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.5.5'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MAP 5'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 27'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 1'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 15'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.7.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 15'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.6'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.8'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 3'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 12'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 3'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 72'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 4'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.6'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MEASURE 4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 72'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 1'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.2.5'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 1'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 9'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 1'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.1.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 2'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.9.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 14'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.10.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 3'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.10.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 3'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 26'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 3'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC9'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 4'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.8.4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 73'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'NIST_AI_RMF'::"ComplianceFramework" AND f."code" = 'MANAGE 4'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC7'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.3.3'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.4.3'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'C1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.4.3'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.4.6'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.5.2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 27'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.3'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 11'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 15'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 43'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.5'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC8'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.6'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 26'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.6'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 72'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.7'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 11'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.7'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 53'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.8'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 12'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.6.2.8'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC7'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.3'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.3'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.4'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'PI1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.4'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P7'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.5'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.5'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 53'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.7.6'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 10'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.8.2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 13'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.8.2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 50'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.8.2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 53'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.8.2'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.8.4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 73'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.8.4'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P6'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.9.2'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 26'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.9.4'
    AND t."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND t."code" = 'Art. 26'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'ISO_42001'::"ComplianceFramework" AND f."code" = 'A.10.3'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC9'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 10'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'C1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 10'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 10'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P4'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 12'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC7'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 14'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.8.2'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 15'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC6'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 15'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC7'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 15'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'A1'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 17'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC5'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 17'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'CC8'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 17'
    AND t."framework" = 'ISO_42001'::"ComplianceFramework" AND t."code" = 'A.6.1.3'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
INSERT INTO "ControlCrosswalk" ("id", "fromControlId", "toControlId", "note", "createdAt")
  SELECT gen_random_uuid()::text, f."id", t."id", NULL, CURRENT_TIMESTAMP
  FROM "FrameworkControl" f, "FrameworkControl" t
  WHERE f."framework" = 'EU_AI_ACT'::"ComplianceFramework" AND f."code" = 'Art. 73'
    AND t."framework" = 'SOC2'::"ComplianceFramework" AND t."code" = 'P6'
  ON CONFLICT ("fromControlId", "toControlId") DO NOTHING;
