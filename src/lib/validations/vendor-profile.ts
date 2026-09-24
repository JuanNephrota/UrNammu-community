import { z } from "zod";

const stringListField = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (Array.isArray(value)) {
      return value.map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  });

export const upsertVendorProfileSchema = z.object({
  vendor: z.string().trim().min(1).max(200),
  contractStatus: z
    .enum(["UNKNOWN", "IN_REVIEW", "ACTIVE", "EXPIRED", "TERMINATED"])
    .default("UNKNOWN"),
  contractOwner: z.string().trim().max(200).optional().nullable(),
  contractStartDate: z.string().optional().nullable(),
  contractRenewalDate: z.string().optional().nullable(),
  renewalNoticeDays: z.coerce.number().int().min(1).max(365).default(60),
  renewalNotes: z.string().trim().max(5000).optional().nullable(),
  securityReviewStatus: z
    .enum(["NOT_REVIEWED", "IN_PROGRESS", "APPROVED", "CONDITIONAL", "REJECTED"])
    .default("NOT_REVIEWED"),
  dataResidency: stringListField,
  approvedUseCases: stringListField,
  subprocessors: stringListField,
  notes: z.string().trim().max(5000).optional().nullable(),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalDate = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return date;
  });

const websiteField = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withScheme);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      return url.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid website URL" });
      return z.NEVER;
    }
  });

/** Step 1 of the Add vendor wizard. Creates the profile, or returns the existing one. */
export const onboardVendorSchema = z.object({
  vendor: z.string().trim().min(1, "Vendor name is required").max(200),
  website: websiteField,
  description: optionalText(5000),
  contractOwner: optionalText(200),
});

/**
 * Partial update from a single wizard step. Only keys present in the body are
 * written, so each step can save its own fields without clobbering the rest.
 * The vendor name is deliberately not editable: AI systems and discoveries
 * link to a vendor by name.
 */
export const patchVendorProfileSchema = z
  .object({
    website: websiteField,
    description: optionalText(5000),
    contractStatus: z.enum(["UNKNOWN", "IN_REVIEW", "ACTIVE", "EXPIRED", "TERMINATED"]),
    contractOwner: optionalText(200),
    contractStartDate: optionalDate,
    contractRenewalDate: optionalDate,
    renewalNoticeDays: z.coerce.number().int().min(1).max(365),
    renewalNotes: optionalText(5000),
    dataResidency: stringListField,
    subprocessors: stringListField,
    approvedUseCases: stringListField,
    notes: optionalText(5000),
  })
  .partial()
  .strict();
