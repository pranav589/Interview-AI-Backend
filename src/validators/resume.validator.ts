import { z } from "zod";

export const SectionFeedbackSchema = z.object({
  present: z.boolean(),
  score: z.number().min(0).max(100),
  positives: z.array(z.string()),
  negatives: z.array(z.string()),
});

export const AnalysisSchema = z.object({
  atsScore: z.number().min(0).max(100),
  sections: z.object({
    contact: SectionFeedbackSchema.optional(),
    summary: SectionFeedbackSchema.optional(),
    experience: SectionFeedbackSchema.optional(),
    education: SectionFeedbackSchema.optional(),
    skills: SectionFeedbackSchema.optional(),
    projects: SectionFeedbackSchema.optional(),
    certifications: SectionFeedbackSchema.optional(),
  }),
  overallPositives: z.array(z.string()),
  overallNegatives: z.array(z.string()),
  topRecommendations: z.array(z.string()),
  keywordsFound: z.array(z.string()),
  keywordsMissing: z.array(z.string()),
});

export const MatchSchema = z.object({
  matchScore: z.number().min(0).max(100),
  jobTitle: z.string(),
  company: z.string(),
  matchedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  sectionFeedback: z.array(z.object({
    section: z.string(),
    gap: z.string(),
    suggestion: z.string(),
  })),
});

export const OptimizedBulletsSchema = z.object({
  optimizedBullets: z.array(z.object({
    original: z.string(),
    improved: z.string()
  }))
});
