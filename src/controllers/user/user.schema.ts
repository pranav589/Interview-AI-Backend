import { z } from "zod";

export const updateSettingsSchema = z.object({
  weeklyEmailDigest: z.boolean().optional(),
});

export const resumeUploadSchema = z.object({
  mimetype: z.string().refine((val) => val === "application/pdf", {
    message: "Only PDF files are allowed",
  }),
  size: z.number().max(5 * 1024 * 1024, {
    message: "File size must be less than 5MB",
  }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
