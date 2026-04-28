import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { invalidateRuleCache } from "@/lib/prompt-risk";
import { validateRegexPatterns } from "@/lib/regex-validator";
import { z } from "zod";

const SEVERITY = ["critical", "warning"] as const;

// Stable key: lowercase, alphanumeric + underscore. Used by PromptRiskException
// for category matching, so it must be deterministic and URL-safe.
const KEY_REGEX = /^[a-z][a-z0-9_]{2,39}$/;

const createRuleSchema = z.object({
  key: z
    .string()
    .regex(
      KEY_REGEX,
      "Key must start with a lowercase letter and contain only lowercase letters, digits, and underscores (3-40 chars)."
    ),
  label: z.string().min(1).max(200),
  severity: z.enum(SEVERITY),
  patterns: z.array(z.string().min(1)).min(1).max(10),
  description: z.string().max(2000).optional().nullable(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  return withAuth(async () => {
    const rules = await prisma.promptRiskRule.findMany({
      orderBy: [{ builtIn: "desc" }, { key: "asc" }],
    });
    return NextResponse.json(rules);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const regexCheck = validateRegexPatterns(parsed.data.patterns);
    if (!regexCheck.ok) {
      return NextResponse.json({ error: regexCheck.error }, { status: 400 });
    }

    const existing = await prisma.promptRiskRule.findUnique({
      where: { key: parsed.data.key },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A rule with key "${parsed.data.key}" already exists.` },
        { status: 409 }
      );
    }

    const rule = await prisma.promptRiskRule.create({
      data: {
        key: parsed.data.key,
        label: parsed.data.label,
        severity: parsed.data.severity,
        patterns: parsed.data.patterns,
        description: parsed.data.description ?? null,
        enabled: parsed.data.enabled ?? true,
        builtIn: false,
      },
    });

    invalidateRuleCache();

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "PromptRiskRule",
      entityId: rule.id,
      changes: {
        key: rule.key,
        label: rule.label,
        severity: rule.severity,
        patternCount: rule.patterns.length,
      },
    });

    return NextResponse.json(rule, { status: 201 });
  });
}
