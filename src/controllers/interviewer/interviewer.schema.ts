import { z } from "zod";

export const interviewerApplicationSchema = z.object({
  answers: z.array(z.string()).min(1, "At least one answer is required"),
  // Resume will be handled via the upload resume endpoint or passed as text
});

export const aiEvaluationSchema = z.object({
  status: z.enum(["approved", "rejected", "pending", "none"]),
  aiFeedback: z.string(),
  maxCandidateExp: z.number().default(0),
  expertiseTags: z.array(z.string()).default([]),
});

export const updateAvailabilitySchema = z.object({
  weeklySlots: z.array(z.object({
    dayOfWeek: z.number().min(0).max(6),
    startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:mm)"),
    endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:mm)"),
  })),
  timezone: z.string().optional(),
});

export const createBookingSchema = z.object({
  interviewerId: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});
