import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { previewKeyUsageRule } from "@/lib/key-usage-evaluation";
import { previewKeyUsageRuleSchema } from "@/lib/validations/key-usage-rule";

/**
 * Dry-run a rule config against live telemetry. Writes nothing — no alerts, no
 * profile updates — so an admin can size a threshold before enabling the rule.
 */
export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const body = await req.json();
    const parsed = previewKeyUsageRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.conditionType !== parsed.data.config.conditionType) {
      return NextResponse.json(
        { error: "config.conditionType must match the requested conditionType." },
        { status: 400 }
      );
    }

    const { findings, keysEvaluated } = await previewKeyUsageRule({
      conditionType: parsed.data.conditionType,
      config: parsed.data.config,
      providers: parsed.data.providers,
      apiKeyExternalIds: parsed.data.apiKeyExternalIds,
    });

    return NextResponse.json({
      keysEvaluated,
      matchCount: findings.length,
      // Cap the payload: a badly-tuned threshold can match every key, and the
      // count is what tells the admin that, not 400 rows of detail.
      matches: findings.slice(0, 25).map((finding) => ({
        provider: finding.provider,
        apiKeyExternalId: finding.apiKeyExternalId,
        apiKeyName: finding.apiKeyName,
        metric: finding.metric,
        observed: finding.observed,
        baseline: finding.baseline,
        threshold: finding.threshold,
        reasons: finding.reasons,
      })),
    });
  });
}
