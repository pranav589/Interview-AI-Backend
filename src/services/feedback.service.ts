import { Interview } from "../models/interview.model";
import { Feedback } from "../models/feedback.model";
import { graphApp } from "../utils/graph";
import { invokeStructuredLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { aiFeedbackSchema } from "../validators/interview.validator";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { extractQAPairs, extractActualQAPairs } from "../helpers/message-utils";
import { NotFoundError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("feedback");

export class FeedbackService {
  async generateFeedback(threadId: string, actualDuration: number, userId: string, isFreeTier: boolean) {
    const interview = await Interview.findOne({ _id: threadId, userId });
    if (!interview) {
      throw new NotFoundError(MESSAGES.INTERVIEW.FEEDBACK_NOT_FOUND);
    }

    const state = await graphApp.getState({
      configurable: { thread_id: threadId },
    });

    if (!state?.values?.messages) {
      throw new NotFoundError(MESSAGES.INTERVIEW.HISTORY_NOT_FOUND);
    }

    // --- Q&A Extraction ---
    // Extract Q&A pairs directly from the actual messages exchanged (one per AI-Human turn pair)
    logger.info(
      { threadId },
      "[FB] Extracting Q&A pairs directly from message turns"
    );
    const qaPairs = extractQAPairs(state.values.messages);

    logger.info(
      { pairsCount: qaPairs.length, targetCount: interview.numberOfQuestions },
      "[FB] Q&A pairs extracted for feedback"
    );

    const basePrompt = this.getFeedbackPrompt(interview, isFreeTier, qaPairs.length);
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ["system", basePrompt],
      ["system", "INTERVIEW TRANSCRIPT (Q&A pairs only):\n{history}"],
    ]);

    const formattedMessages = await promptTemplate.formatMessages({
      interviewType: interview.interviewType,
      difficultyLevel: interview.difficultyLevel,
      numQuestions: interview.numberOfQuestions,
      customTopics: (interview as any).customTopics || "None specified",
      jobDescription: (interview as any).jobDescription || "None specified",
      companyStyle: (interview as any).companyStyle || "Standard professional",
      history: qaPairs
        .map((pair, i) => `[Q${i + 1}] ${pair.question}\n[A${i + 1}] ${pair.answer}`)
        .join("\n\n"),
    });

    const data = await invokeStructuredLLMWithFallback(
      aiFeedbackSchema,
      formattedMessages,
      { timeout: 90000 }
    );

    logger.info(
      {
        overallScore: data.overallScore,
        questionsReturned: data.questions.length,
        questionsExpected: qaPairs.length,
      },
      "[FB] Feedback generated"
    );

    const feedback = await Feedback.findOneAndUpdate(
      { interviewId: threadId },
      { $set: data },
      { new: true, upsert: true }
    );

    await Interview.findByIdAndUpdate(threadId, {
      status: "completed",
      score: data.overallScore,
      feedbackId: feedback._id,
      actualDuration: actualDuration || 0,
    });

    return feedback;
  }

  private getFeedbackPrompt(interview: any, isFreeTier: boolean, actualQuestionCount: number): string {
    return `You are a brutally honest, highly critical Senior Technical Interviewer evaluating a candidate's practice session. You do not soften feedback. You do not give benefit of the doubt.

---
SESSION CONTEXT:
- Interview Type: ${interview.interviewType}
- Target Difficulty: ${interview.difficultyLevel}
- Configured Number of Questions: ${interview.numberOfQuestions}
- Actual Questions Asked: ${actualQuestionCount}
- Custom Topics: ${(interview as any).customTopics || "None"}
- Job Description: ${(interview as any).jobDescription || "None"}
- Company Style: ${(interview as any).companyStyle || "Standard"}
---

ABSOLUTE RULES:
1. Analyze ONLY what is in the provided transcript. Do NOT hallucinate or invent answers.
2. If a question appears with answer "Not Answered", set that question's score to 0 and userAnswer to "Not Answered".
3. Apply a 20-point deduction to overallScore for EACH unanswered question.
4. If fewer than ${interview.numberOfQuestions} questions were completed, the overallScore cap is ${Math.max(0, 100 - (interview.numberOfQuestions - actualQuestionCount) * 20)}.
5. The 'questions' array must have EXACTLY ${actualQuestionCount} entries — one per Q&A pair in the transcript. No more, no less.

---
SCORING RUBRICS — FOLLOW THESE EXACTLY:

overallScore (0-100):
  90-100 → Exceptional: demonstrated mastery, specific examples, excellent communication
  70-89  → Good: answered most questions well with minor gaps or vagueness
  50-69  → Average: partial answers, some missed concepts, inconsistent depth
  30-49  → Below Average: many incomplete answers, poor reasoning, weak examples
  0-29   → Poor: failed to address most questions, major errors, largely incoherent

technicalScore (0-100):
  90-100 → All technical answers correct; included edge cases, complexity analysis
  70-89  → Mostly correct; minor inaccuracies or missing depth on 1-2 questions
  50-69  → Partially correct; missed key concepts or gave incorrect solutions on half
  30-49  → Significant technical errors; confused fundamental concepts
  0-29   → Could not answer technical questions, or wrong on the majority
  (For behavioral interviews: evaluate domain knowledge and situational reasoning instead)

communicationScore (0-100):
  90-100 → Structured, concise, uses concrete examples naturally, no filler words
  70-89  → Mostly clear but occasionally verbose or imprecise
  50-69  → Understandable but rambling; lacks structure (STAR etc.); frequent hedging
  30-49  → Hard to follow; disorganized; excessive use of "I think", "maybe", "probably"
  0-29   → Incoherent, very difficult to follow

confidenceScore (0-100):
  90-100 → Answers delivered decisively; no second-guessing or self-correction
  70-89  → Generally confident; minor hesitation on 1-2 answers
  50-69  → Noticeable hedging ("I'm not sure but...", "I think maybe..."); walks back answers
  30-49  → Frequently apologizes; often revises or contradicts earlier statements
  0-29   → Extremely hesitant; unable to commit to any answer; constant self-doubt

Per-question score (0-100):
  100 → Perfect: matches model answer on all key points, with correct depth
  75  → Good: correct direction, misses 1-2 key supporting points
  50  → Partial: correct high-level idea but shallow or missing critical details
  25  → Attempted but fundamentally wrong or significantly off-track
  0   → Did not answer; "Not Answered"; or completely irrelevant response

---
${
  isFreeTier
    ? "OUTPUT CONSTRAINTS (FREE TIER): Provide a concise feedback summary and overall scores. Do NOT include modelAnswer in question breakdowns. Keep per-question feedback to 1 sentence each."
    : `OUTPUT CONSTRAINTS (PRO TIER):
- feedbackSummary: 3-5 sentences. MUST reference specific answers from the transcript. No generic phrases.
- strengths: minimum 2 items. Each must name a specific moment from the interview.
- areasForImprovement: minimum 2 items. Each must name the exact gap and why it matters.
- suggestions: minimum 2 items. Each must be concrete and actionable (name a technique, resource, or practice method).
- questions[].modelAnswer: write a complete, expert-level answer that would score 100.
- questions[].feedback: 2-3 sentences. Explain exactly why the candidate's answer received its score.`
}`;
  }
}

export const feedbackService = new FeedbackService();
