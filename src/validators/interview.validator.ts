import z from "zod";
import { INTERVIEW_TYPES, DIFFICULTY_LEVELS, MESSAGES } from "../config/constants";

export const interviewSchema = z.object({
  interviewType: z.enum(INTERVIEW_TYPES),
  difficultyLevel: z.enum(DIFFICULTY_LEVELS),
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
  type: z.enum(['all', ...INTERVIEW_TYPES]).optional(),
  difficulty: z.enum(['all', ...DIFFICULTY_LEVELS]).optional(),
  status: z.enum(['all', 'not-started', 'in-progress', 'completed']).optional(),
});
export const feedbackRequestSchema = z.object({
  threadId: z.string().refine((val) => /^[0-9a-fA-F]{24}$/.test(val), {
    message: MESSAGES.INTERVIEW.INVALID_ID_FORMAT,
  }),
  actualDuration: z.number().nonnegative().optional().default(0),
});

export const aiFeedbackSchema = z.object({
  overallScore: z.number().min(0).max(100).describe(
    "Overall performance score. Rubric: 90-100=exceptional mastery; 70-89=solid with minor gaps; 50-69=average, partial answers; 30-49=below average, weak reasoning; 0-29=poor, failed to address questions. Apply a 20-point penalty per unanswered question."
  ),
  communicationScore: z.number().min(0).max(100).describe(
    "Communication quality score. Rubric: 90-100=structured, concise, uses examples naturally, no filler words; 70-89=clear but occasionally verbose; 50-69=understandable but rambling, lacks structure; 30-49=disorganized, excessive hedging; 0-29=incoherent, very hard to follow."
  ),
  technicalScore: z.number().min(0).max(100).describe(
    "Technical accuracy score. Rubric: 90-100=all answers correct, covers edge cases and complexity; 70-89=mostly correct, minor gaps; 50-69=partially correct, misses key concepts; 30-49=significant errors, confused fundamentals; 0-29=could not answer or wrong on most. For non-technical interviews, evaluate domain knowledge depth instead."
  ),
  confidenceScore: z.number().min(0).max(100).describe(
    "Confidence and composure score. Rubric: 90-100=answers delivered decisively, no second-guessing; 70-89=generally confident, minor hesitation; 50-69=noticeable hedging ('I think maybe...', 'I'm not sure but...'); 30-49=frequently apologized or walked back answers; 0-29=extremely hesitant, couldn't commit to any answer."
  ),
  feedbackSummary: z.string().min(80).describe(
    "A critical, specific, and blunt 3-5 sentence summary of the candidate's overall performance. MUST reference specific answers or moments from the transcript. DO NOT use generic phrases like 'the candidate showed some strengths'. Be direct about what failed and what succeeded."
  ),
  strengths: z.array(z.string()).min(2).describe(
    "At least 2 specific strengths demonstrated during the interview. Each item must reference a concrete example from the transcript, not a generic observation."
  ),
  areasForImprovement: z.array(z.string()).min(2).describe(
    "At least 2 specific performance failures. Each must identify the exact gap and why it matters in a real interview context."
  ),
  suggestions: z.array(z.string()).min(2).describe(
    "At least 2 concrete, actionable improvement steps the candidate can take. Be specific — name resources, techniques, or practice methods."
  ),
  questions: z.array(z.object({
    question: z.string().describe("The exact interview question that was asked"),
    userAnswer: z.string().describe(
      "A concise but complete summary of everything the candidate said in response to this question, including any follow-up answers. If not answered, use the literal string 'Not Answered'."
    ),
    score: z.number().min(0).max(100).describe(
      "Per-question score. Rubric: 100=perfect match to ideal answer; 75=good, missing 1-2 key points; 50=partial, correct direction but shallow; 25=attempted but fundamentally wrong; 0=did not answer or 'Not Answered'."
    ),
    feedback: z.string().describe(
      "2-3 sentences explaining specifically why the answer received this score, referencing what was said or omitted."
    ),
    modelAnswer: z.string().describe(
      "A complete, high-quality model answer that would score 100 on this question. Include key concepts, structure, and any important caveats."
    ),
  })).describe(
    "CRITICAL: This array must contain ONLY the actual distinct interview questions asked — NOT greetings, NOT follow-up probes, NOT acknowledgements, NOT transitions. The length of this array MUST exactly equal the number of distinct questions provided in the transcript."
  ),
});
