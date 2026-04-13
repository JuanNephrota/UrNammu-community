import { prisma } from "./prisma";

/**
 * Suppression of shadow AI discoveries when the tool is already governed.
 *
 * If a discovered tool matches an existing AISystem (by name, or by vendor + name),
 * the discovery is linked to that system and its status is advanced to `REGISTERED`
 * so that it does not clutter the shadow-AI queue. Listings filter out discoveries
 * with a non-null `linkedSystemId`.
 */

export type GovernedSystemMatchInput = {
  toolName?: string | null;
  vendor?: string | null;
  detectedDomain?: string | null;
};

export type GovernedSystemMatch = {
  id: string;
  name: string;
  vendor: string | null;
};

function norm(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Look up a governed AISystem that corresponds to a discovery. Matching is
 * case-insensitive on AISystem.name (which is required on every system) and
 * optionally narrowed by vendor. Any AISystem in the registry counts as
 * "governed" regardless of its lifecycle status (DRAFT, UNDER_REVIEW,
 * APPROVED, DEPLOYED, DEPRECATED, RETIRED).
 *
 * Returns the matching system, or null if no match.
 */
export async function findMatchingGovernedSystem(
  input: GovernedSystemMatchInput
): Promise<GovernedSystemMatch | null> {
  const name = norm(input.toolName);
  const vendor = norm(input.vendor);
  if (!name) return null;

  // Prefer a vendor + name match when we have both signals.
  if (vendor) {
    const vendorScoped = await prisma.aISystem.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        vendor: { equals: vendor, mode: "insensitive" },
      },
      select: { id: true, name: true, vendor: true },
    });
    if (vendorScoped) return vendorScoped;
  }

  // Fall back to name-only match.
  const nameOnly = await prisma.aISystem.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, vendor: true },
  });
  return nameOnly;
}
