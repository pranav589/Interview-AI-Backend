import mongoose, { Types } from "mongoose";
import { z } from "zod";

import { Request, Response } from "express";
import { interviewSchema, getInterviewsQuerySchema, feedbackRequestSchema, aiFeedbackSchema } from "./interview.schema";

import { Interview } from "../../models/interview.model";
import { User } from "../../models/user.model";
import { graphApp } from "../../utils/graph";
import { createModuleLogger } from "../../lib/logger";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError, NotFoundError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { Feedback } from "../../models/feedback.model";
import { env } from "../../config/env";
import { invokeLLMWithFallback, invokeStructuredLLMWithFallback } from "../../lib/llm-with-fallback";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";



const logger = createModuleLogger("interview");



export const createInterview = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;


  const result = interviewSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError("Invalid data!");
  }

  const {
    interviewType,
    difficultyLevel,
    numberOfQuestions,
    duration,
    jobTitle,
    company,
    customTopics,
    jobDescription,
    companyStyle,
  } = result.data as {
    interviewType: string;
    difficultyLevel: string;
    numberOfQuestions: number;
    duration?: number;
    jobTitle?: string;
    company?: string;
    customTopics?: string;
    jobDescription?: string;
    companyStyle?: string;
  };

  // Fetch fresh user data to get resume text (which we don't keep in authReq)
  const user = await User.findById(authUser.id);

  const newInterview = await Interview.create({
    userId: authUser.id,
    interviewType,
    difficultyLevel,
    numberOfQuestions,
    duration: duration || 30,
    jobTitle,
    company,
    customTopics,
    jobDescription,
    companyStyle,
    resume: user?.resume,
  });

  return res.status(201).json({
    message: "Interview created",
    interviewId: newInterview._id.toString(),
    data: newInterview,
  });
});

export const getInterviews = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;

  const result = getInterviewsQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw new ValidationError("Invalid query parameters");
  }

  const { page, limit, type, difficulty, status } = result.data;

  const skip = (page - 1) * limit;
  
  const query: any = { userId: authUser.id };
  if (type && type !== 'all') query.interviewType = type;
  if (difficulty && difficulty !== 'all') query.difficultyLevel = difficulty;
  if (status && status !== 'all') query.status = status;


  const interviews = await Interview.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Interview.countDocuments(query);

  return res.status(200).json({ 
    data: interviews,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }

  });
});

export const getInterviewDetails = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    throw new ValidationError("Invalid interview ID format");
  }


  const interview = await Interview.findOne({
    _id: id,
    userId: authUser.id,
  }).populate("feedbackId");

  if (!interview) {
    throw new NotFoundError("Interview not found");
  }

  const state = await graphApp.getState({
    configurable: { thread_id: id },
  });

  const transcriptions = (state.values as any)?.messages?.map((msg: any) => ({
    role: msg._getType(),
    text: msg.content,
    timestamp: msg.response_metadata?.timestamp || new Date(),
  })) || [];

  return res.status(200).json({
    data: {
      ...interview.toObject(),
      transcriptions,
    },
  });
});

export const getInterviewStats = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;


  const userId = new mongoose.Types.ObjectId(authUser.id);

  const aggregationResult = await Interview.aggregate([
    {
      $match: { userId: userId }
    },
    {
      $group: {
        _id: null,
        totalInterviews: { $sum: 1 },
        avgScore: { $avg: "$score" },
        totalDuration: { $sum: "$actualDuration" }
      }
    },
    {
      $project: {
        _id: 0,
        totalInterviews: 1,
        avgScore: { $round: ["$avgScore", 0] },
        totalDuration: 1
      }
    }
  ]);

  const stats = aggregationResult.length > 0 ? aggregationResult[0] : {
    totalInterviews: 0,
    avgScore: 0,
    totalDuration: 0
  };

  return res.status(200).json({ data: stats });
});

export const getFeedbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = feedbackRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0].message);
  }

  const { threadId, actualDuration } = result.data;

  const interview = await Interview.findById(threadId);
  if (!interview) {
    throw new NotFoundError("Interview record not found");
  }

  const state = await graphApp.getState({
    configurable: { thread_id: threadId },
  });

  if (!state || !state.values || !state.values.messages) {
    throw new NotFoundError("State not found or no messages");
  }

  const prompt = `Act as an expert, highly critical Senior Interviewer. Analyze this interview transcript for a candidate practice session.
---
Context:
- Interview Type: {interviewType}
- Target Difficulty: {difficultyLevel}
- Required Number of Questions: {numQuestions}
- Custom Topics: {customTopics}
- Job Description: {jobDescription}
- Company Style: {companyStyle}
---
Instructions:
1. STRICT RULE: Analyze ONLY the provided transcript. DO NOT hallucinate, imagine, or infer any candidate answers that are not explicitly present in the transcript.
2. If the AI interviewer asked a question but the candidate DID NOT answer (e.g., the interview was closed early or the user skipped), you MUST record the 'userAnswer' as "Not Answered" or "No response detected" and set the individual question 'score' to 0.
3. Be brutally honest and firm. If the candidate was mediocre, give them a mediocre score. Avoid boilerplate "you did well" statements. 
4. Analyze how many distinct questions were actually answered. If the candidate answered FEWER than {numQuestions} questions (e.g., they ended early), you MUST penalize them significantly (at least 20 points per missing question) in the 'overallScore'.
5. Evaluate technical accuracy, communication clarity, and confidence.
6. For EACH question asked, provide individual feedback with a model/ideal answer for comparison.
7. MANDATORY: The 'questions' array must contain every question the AI asked during the session, with the candidate's actual corresponding response from the transcript.`;

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", prompt],
    new MessagesPlaceholder("history"),
  ]);

  const formattedMessages = await promptTemplate.formatMessages({
    interviewType: interview.interviewType,
    difficultyLevel: interview.difficultyLevel,
    numQuestions: interview.numberOfQuestions,
    customTopics: (interview as any).customTopics || "None specified",
    jobDescription: (interview as any).jobDescription || "None specified",
    companyStyle: (interview as any).companyStyle || "Standard professional",
    history: state.values.messages,
  });

  const responseData = await invokeStructuredLLMWithFallback(aiFeedbackSchema, formattedMessages, {
    timeout: 90000,
  });

  const data = responseData;

  // Save or update feedback document
  const feedback = await Feedback.findOneAndUpdate(
    { interviewId: threadId },
    { $set: data },
    { new: true, upsert: true }
  );

  // Update interview session
  await Interview.findByIdAndUpdate(threadId, {
    status: "completed",
    score: data.overallScore,
    feedbackId: feedback._id,
    actualDuration: actualDuration || 0
  });

  return res.json({ feedback: feedback });
});

export const getScoreHistory = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;

  const interviews = await Interview.find({
    userId: authUser.id,
    status: "completed",
    score: { $gt: 0 },
  })
    .sort({ createdAt: 1 })
    .select("score interviewType createdAt")
    .limit(20);

  const history = interviews.map((i) => ({
    date: i.createdAt,
    score: i.score,
    type: i.interviewType,
  }));

  return res.status(200).json({ data: history });
});

