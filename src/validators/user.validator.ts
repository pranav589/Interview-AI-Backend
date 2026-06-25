import { z } from "zod";
import { MESSAGES } from "../config/constants";

export const updateSettingsSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  weeklyEmailDigest: z.boolean().optional(),
  companyName: z.string().optional(),
  companyWebsite: z.string().optional(),
  aiInterviewerName: z.string().optional(),
});

export const resumeUploadSchema = z.object({
  mimetype: z.string().refine((val) => val === "application/pdf", {
    message: MESSAGES.USER.RESUME_INVALID_TYPE,
  }),
  size: z.number().max(5 * 1024 * 1024, {
    message: MESSAGES.USER.RESUME_TOO_LARGE,
  }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
