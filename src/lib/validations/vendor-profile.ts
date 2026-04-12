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
