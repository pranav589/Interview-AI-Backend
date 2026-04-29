import { Request, Response } from "express";
import { interviewService } from "../../services/interview.service";
import { feedbackService } from "../../services/feedback.service";
import { 
  interviewSchema, 
  getInterviewsQuerySchema, 
  feedbackRequestSchema 
} from "../../validators/interview.validator";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { graphApp } from "../../utils/graph";
import { stripMetadata, isLikelyMetaLeak } from "../../helpers/message-utils";
import { MESSAGES } from "../../config/constants";

export const createInterview = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;
  const result = interviewSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(MESSAGES.INTERVIEW.INVALID_DATA);

  const fullUser = (req as any).fullUser;
  const interview = await interviewService.createInterview(authUser!.id, result.data, fullUser);

  return res.status(201).json({
    success: true,
    message: MESSAGES.INTERVIEW.CREATED,
    data: {
      interviewId: (interview as any)._id,
      interview,
      updatedCredits: fullUser.credits,
    }
  });
});

export const getInterviews = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;
  const result = getInterviewsQuerySchema.safeParse(req.query);
  if (!result.success) throw new ValidationError(MESSAGES.INTERVIEW.INVALID_QUERY);

  const data = await interviewService.getInterviews(authUser!.id, result.data);
  return res.status(200).json({
    success: true,
    message: MESSAGES.INTERVIEW.FETCHED_SUCCESS,
    data: data
  });
});

export const getInterviewDetails = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const interview = await interviewService.getInterviewDetails(authUser!.id, id);
  const state = await graphApp.getState({ configurable: { thread_id: id } });

  const transcriptions = (state.values as any)?.messages?.map((msg: any) => ({
    role: msg._getType(),
    text: stripMetadata(msg.content),
    timestamp: msg.response_metadata?.timestamp || new Date(),
  })).filter((m: any) => m.text && !isLikelyMetaLeak(m.text)) || [];

  return res.status(200).json({
    success: true,
    message: MESSAGES.INTERVIEW.DETAILS_FETCHED,
    data: {
      ...interview.toObject(),
      transcriptions,
    },
  });
});

export const getInterviewStats = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;
  const stats = await interviewService.getStats(authUser!.id);
  return res.status(200).json({
    success: true,
    message: MESSAGES.INTERVIEW.STATS_FETCHED,
    data: stats
  });
});

export const getFeedbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;
  const result = feedbackRequestSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(MESSAGES.INTERVIEW.INVALID_FEEDBACK_REQUEST);

  const fullUser = (req as any).fullUser;
  const isFreeTier = fullUser.subscriptionTier === "free";

  const feedback = await feedbackService.generateFeedback(
    result.data.threadId,
    result.data.actualDuration,
    authUser!.id,
    isFreeTier
  );

  return res.json({
    success: true,
    message: MESSAGES.INTERVIEW.FEEDBACK_GENERATED,
    data: feedback
  });
});

export const getScoreHistory = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;
  const history = await interviewService.getScoreHistory(authUser!.id);
  return res.status(200).json({
    success: true,
    message: MESSAGES.INTERVIEW.SCORE_HISTORY_FETCHED,
    data: history
  });
});
