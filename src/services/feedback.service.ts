import { Interview } from "../models/interview.model";
import { Feedback } from "../models/feedback.model";
import { graphApp } from "../utils/graph";
import { invokeStructuredLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { aiFeedbackSchema } from "../validators/interview.validator";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { extractQAPairs } from "../helpers/message-utils";
import { NotFoundError } from "../lib/errors";
import { MESSAGES } from "../config/constants";

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

    const basePrompt = this.getFeedbackPrompt(interview, isFreeTier);
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ["system", basePrompt],
      ["system", "INTERVIEW TRANSCRIPT:\n{history}"],
    ]);

    const qaHistory = extractQAPairs(state.values.messages);
    const formattedMessages = await promptTemplate.formatMessages({
      interviewType: interview.interviewType,
      difficultyLevel: interview.difficultyLevel,
      numQuestions: interview.numberOfQuestions,
      customTopics: (interview as any).customTopics || "None specified",
      jobDescription: (interview as any).jobDescription || "None specified",
      companyStyle: (interview as any).companyStyle || "Standard professional",
      history: qaHistory.map(pair => `Question: ${pair.question}\nAnswer: ${pair.answer}`).join("\n\n"),
    });

    const data = await invokeStructuredLLMWithFallback(
      aiFeedbackSchema,
      formattedMessages,
      { timeout: 90000 }
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

  private getFeedbackPrompt(interview: any, isFreeTier: boolean) {
    return `Act as an expert, highly critical Senior Interviewer. Analyze this interview transcript for a candidate practice session.
---
Context:
- Interview Type: ${interview.interviewType}
- Target Difficulty: ${interview.difficultyLevel}
- Required Number of Questions: ${interview.numberOfQuestions}
- Custom Topics: ${(interview as any).customTopics || "None"}
- Job Description: ${(interview as any).jobDescription || "None"}
- Company Style: ${(interview as any).companyStyle || "Standard"}
---
Instructions:
1. STRICT RULE: Analyze ONLY the provided transcript. DO NOT hallucinate.
2. If a question was asked but NOT answered, record 'userAnswer' as "Not Answered" and set individual 'score' to 0.
3. Be brutally honest.
4. If fewer than ${interview.numberOfQuestions} questions were answered, penalize at least 20 points per missing question in 'overallScore'.
5. Evaluate technical accuracy, communication clarity, and confidence.
${
  isFreeTier
    ? "6. Provide a concise feedback summary. DO NOT provide model answers or per-question breakdowns."
    : "6. For EACH question, provide individual feedback with a model/ideal answer.\n7. MANDATORY: The 'questions' array must contain every question asked."
}`;
  }
}

export const feedbackService = new FeedbackService();
