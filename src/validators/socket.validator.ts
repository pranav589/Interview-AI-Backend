import z from "zod";

export const wsStartSchema = z.object({
  type: z.literal("start"),
  threadId: z.string().min(1),
  resume: z.string().optional().default(""),
  numberOfQuestions: z.number().int().positive().max(20).optional().default(5),
  interviewType: z
    .enum(["behavioral", "technical", "system-design"])
    .optional()
    .default("technical"),
  difficultyLevel: z
    .enum(["beginner", "intermediate", "advanced"])
    .optional()
    .default("intermediate"),
  jobTitle: z.string().optional().default(""),
  company: z.string().optional().default(""),
  customTopics: z.string().optional().default(""),
  jobDescription: z.string().optional().default(""),
  companyStyle: z.string().optional().default(""),
});

export const wsAudioSchema = z.object({
  type: z.literal("audio"),
  chunk: z.string().min(1),
});

export const wsPauseSchema = z.object({
  type: z.literal("pause"),
  elapsedSeconds: z.number().nonnegative(),
});

export const wsResumeStartSchema = z.object({
  type: z.literal("resume"),
  threadId: z.string().min(1).optional(),
});

export const wsCodeSchema = z.object({
  type: z.literal("code_submission"),
  content: z.string().min(1),
  language: z.string().optional(),
});
