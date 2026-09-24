import { prisma } from "@/lib/prisma";

/** Suggestions for the registration wizard's vendor and department fields. */
export async function loadSystemSetupSuggestions() {
  const [systemVendors, profiles, departments] = await Promise.all([
    prisma.aISystem.findMany({ where: { vendor: { not: null } }, select: { vendor: true }, distinct: ["vendor"] }),
    prisma.vendorProfile.findMany({ select: { vendor: true } }),
    prisma.aISystem.findMany({ select: { department: true }, distinct: ["department"] }),
  ]);
  const vendors = new Map<string, string>();
  for (const name of [...profiles.map((p) => p.vendor), ...systemVendors.map((s) => s.vendor ?? "")]) {
    const trimmed = name.trim();
    if (trimmed && !vendors.has(trimmed.toLowerCase())) vendors.set(trimmed.toLowerCase(), trimmed);
  }
  return {
    knownVendors: [...vendors.values()].sort((a, b) => a.localeCompare(b)),
    knownDepartments: [...new Set(departments.map((d) => d.department.trim()).filter(Boolean))].sort(),
    profiledVendors: profiles.map((p) => p.vendor.toLowerCase()),
  };
}
