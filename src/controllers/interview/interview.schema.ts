import z from "zod";

export const interviewSchema = z.object({
  interviewType: z.enum(["behavioral", "technical", "system-design"]),
  difficultyLevel: z.enum(["beginner", "intermediate", "advanced"]),
  numberOfQuestions: z.number().default(5),
  duration: z.number().optional(),
  jobTitle: z.string().optional(),
  company: z.string().optional(),
  customTopics: z.string().optional(),
  jobDescription: z.string().optional(),
  companyStyle: z.string().optional(),
});

export const getInterviewsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  type: z.enum(['all', 'behavioral', 'technical', 'system-design']).optional(),
  difficulty: z.enum(['all', 'beginner', 'intermediate', 'advanced']).optional(),
  status: z.enum(['all', 'not-started', 'in-progress', 'completed']).optional(),
});
export const feedbackRequestSchema = z.object({
  threadId: z.string().refine((val) => /^[0-9a-fA-F]{24}$/.test(val), {
    message: "Invalid interview ID format",
  }),
  actualDuration: z.number().nonnegative().optional().default(0),
});

export const aiFeedbackSchema = z.object({
  overallScore: z.number().min(0).max(100).describe("Final performance score"),
  communicationScore: z.number().min(0).max(100).describe("Clarity and impact"),
  technicalScore: z.number().min(0).max(100).describe("Accuracy and logic"),
  confidenceScore: z.number().min(0).max(100).describe("Professionalism"),
  feedbackSummary: z.string().describe("Critical, blunt summary paragraph"),
  strengths: z.array(z.string()).describe("What the candidate did well"),
  areasForImprovement: z.array(z.string()).describe("Specific performance failures"),
  suggestions: z.array(z.string()).describe("Detailed path to improve"),
  questions: z.array(z.object({
    question: z.string().describe("The exact question asked"),
    userAnswer: z.string().describe("Brief summary of candidate's response"),
    score: z.number().min(0).max(100).describe("Score for this answer"),
    feedback: z.string().describe("Why it got this score"),
    modelAnswer: z.string().describe("What an ideal answer looks like")
  })).describe("Breakdown of every turn")
});
