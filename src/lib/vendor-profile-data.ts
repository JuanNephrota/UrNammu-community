import { prisma } from "@/lib/prisma";
import { asStringList } from "@/lib/vendor-onboarding";

/** Loads a vendor profile with list fields parsed and its questionnaire history. */
export async function loadVendorProfile(id: string) {
  const profile = await prisma.vendorProfile.findUnique({
    where: { id },
    include: { assessments: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  if (!profile) return null;

  return {
    ...profile,
    dataResidency: asStringList(profile.dataResidency),
    subprocessors: asStringList(profile.subprocessors),
    approvedUseCases: asStringList(profile.approvedUseCases),
    latestAssessment: profile.assessments[0] ?? null,
    latestCompletedAssessment: profile.assessments.find((a) => a.status === "COMPLETED") ?? null,
  };
}

export type LoadedVendorProfile = NonNullable<Awaited<ReturnType<typeof loadVendorProfile>>>;

/** Vendor names used by AI systems or discoveries that don't have a profile yet. */
export async function listVendorsWithoutProfile(): Promise<string[]> {
  const [systems, discovered, profiles] = await Promise.all([
    prisma.aISystem.findMany({ where: { vendor: { not: null } }, select: { vendor: true }, distinct: ["vendor"] }),
    prisma.discoveredAITool.findMany({ where: { vendor: { not: null } }, select: { vendor: true }, distinct: ["vendor"] }),
    prisma.vendorProfile.findMany({ select: { vendor: true } }),
  ]);
  const profiled = new Set(profiles.map((p) => p.vendor.toLowerCase()));
  const names = new Map<string, string>();
  for (const row of [...systems, ...discovered]) {
    const name = row.vendor?.trim();
    if (name && !profiled.has(name.toLowerCase()) && !names.has(name.toLowerCase())) {
      names.set(name.toLowerCase(), name);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
