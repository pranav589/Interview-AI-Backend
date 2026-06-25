import { Request, Response } from "express";
import { feedbackService } from "../../services/feedback.service";
import { Interview } from "../../models/interview.model";
import { InterviewInvite } from "../../models/interview-invite.model";
import {
  interviewSchema,
  getInterviewsQuerySchema,
  feedbackRequestSchema,
} from "../../validators/interview.validator";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError, ForbiddenError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { isFeatureEnabled } from "../../utils/feature-flags";
import { graphApp } from "../../utils/graph";
import { stripMetadata, isLikelyMetaLeak } from "../../helpers/message-utils";
import { MESSAGES } from "../../config/constants";
import { interviewJobService } from "../../services/interview-job.service";
import { notificationService } from "../../services/notification.service";
import { interviewService } from "../../services/interview.service";


export const createInterview = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const result = interviewSchema.safeParse(req.body);
    if (!result.success)
      throw new ValidationError(MESSAGES.INTERVIEW.INVALID_DATA);

    // Check feature flag for specific interview type
    const featureKey = `interview_${result.data.interviewType.replace("-", "_")}_enabled`;
    const isEnabled = await isFeatureEnabled(featureKey);
    if (!isEnabled) {
      throw new ForbiddenError(MESSAGES.SYSTEM.FEATURE_DISABLED);
    }

    const fullUser = (req as any).fullUser;
    const interview = await interviewService.createInterview(
      authUser!.id,
      result.data,
      fullUser,
    );

    return res.status(201).json({
      success: true,
      message: MESSAGES.INTERVIEW.CREATED,
      data: {
        interviewId: (interview as any)._id,
        interview,
        updatedCredits: fullUser.credits,
      },
    });
  },
);

export const getInterviews = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const result = getInterviewsQuerySchema.safeParse(req.query);
    if (!result.success)
      throw new ValidationError(MESSAGES.INTERVIEW.INVALID_QUERY);

    const data = await interviewService.getInterviews(
      authUser!.id,
      result.data,
      authUser!.role
    );
    return res.status(200).json({
      success: true,
      message: MESSAGES.INTERVIEW.FETCHED_SUCCESS,
      data: data,
    });
  },
);

export const getInterviewDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const { id } = req.params;

    const interview = await interviewService.getInterviewDetails(
      authUser!.id,
      id,
    );
    
    let activeJobId = null;
    if (!interview.feedbackId) {
      const activeJob = await interviewJobService.findActiveJobForInterview(id, authUser!.id);
      if (activeJob) {
        activeJobId = activeJob._id;
      }
    }

    const state = await graphApp.getState({ configurable: { thread_id: id } });

    const rawTranscriptions =
      (state.values as any)?.messages
        ?.map((msg: any) => ({
          role: msg._getType(),
          text: stripMetadata(msg.content),
          timestamp: msg.additional_kwargs?.timestamp || msg.response_metadata?.timestamp || new Date(),
        }))
        .filter((m: any) => m.text && !isLikelyMetaLeak(m.text)) || [];

    const transcriptions: any[] = [];
    for (const msg of rawTranscriptions) {
      const last = transcriptions[transcriptions.length - 1];
      if (last && last.role === msg.role && msg.role === 'human') {
        last.text = `${last.text} ${msg.text}`.trim();
      } else {
        transcriptions.push(msg);
      }
    }

    const isCandidate = interview.userId.toString() === authUser!.id;
    let interviewObj = interview.toObject();

    // Secure candidate feedback from unauthorized exposure on B2B rounds
    if (isCandidate && interview.employerId) {
      delete (interviewObj as any).feedbackId;
      delete (interviewObj as any).score;
    }

    return res.status(200).json({
      success: true,
      message: MESSAGES.INTERVIEW.DETAILS_FETCHED,
      data: {
        ...interviewObj,
        transcriptions,
        activeJobId,
      },
    });
  },
);

export const getInterviewStats = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const stats = await interviewService.getStats(authUser!.id);
    return res.status(200).json({
      success: true,
      message: MESSAGES.INTERVIEW.STATS_FETCHED,
      data: stats,
    });
  },
);

export const getFeedbackHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const result = feedbackRequestSchema.safeParse(req.body);
    if (!result.success)
      throw new ValidationError(MESSAGES.INTERVIEW.INVALID_FEEDBACK_REQUEST);
    const fullUser = (req as any).fullUser;
    const isFreeTier = fullUser.subscriptionTier === "free";

    // Mark interview and invite as completed immediately
    await Interview.findByIdAndUpdate(result.data.threadId, { status: "completed" });
    await InterviewInvite.findOneAndUpdate(
      { interviewId: result.data.threadId },
      { status: "completed" }
    );

    // Create a background job
    const job = await interviewJobService.createJob(authUser!.id, "feedback-generation", {
      interviewId: result.data.threadId,
    });

    // Run feedback generation in background
    feedbackService.generateFeedback(
      result.data.threadId,
      result.data.actualDuration,
      authUser!.id,
      isFreeTier
    ).then(async (feedback) => {
      await interviewJobService.updateStatus(job._id.toString(), authUser!.id, "completed", {
        resultRef: { feedbackId: feedback._id.toString() },
      });
      
      const interview = await interviewService.getInterviewDetails(authUser!.id, result.data.threadId);
      
      if (interview.employerId) {
        await notificationService.createNotification({
          userId: interview.employerId.toString(),
          type: "success",
          title: "Candidate Interview Completed",
          message: `Candidate ${interview.candidateName || ""} has completed the interview for "${interview.jobTitle || "the role"}".`,
          link: `/dashboard/recruitment/${result.data.threadId}`
        });
      } else {
        await notificationService.createNotification({
          userId: authUser!.id,
          type: "success",
          title: "Interview Analysis Complete",
          message: `Your feedback for "${interview.jobTitle || "the interview session"}" is ready.`,
          link: `/interview/${result.data.threadId}`
        });
      }
    }).catch(async (err) => {
      await interviewJobService.updateStatus(job._id.toString(), authUser!.id, "failed", {
        error: err.message || "Unknown error during feedback generation",
      });
    });

    await interviewJobService.updateStatus(job._id.toString(), authUser!.id, "processing");

    return res.status(202).json({
      success: true,
      message: "Feedback generation started",
      data: {
        jobId: job._id,
        status: "processing",
      },
    });
  },
);

export const getJobStatusHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const { jobId } = req.params;

    const job = await interviewJobService.getJobById(jobId, authUser!.id);

    return res.status(200).json({
      success: true,
      data: job,
    });
  },
);


export const getScoreHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const history = await interviewService.getScoreHistory(authUser!.id);
    return res.status(200).json({
      success: true,
      message: MESSAGES.INTERVIEW.SCORE_HISTORY_FETCHED,
      data: history,
    });
  },
);
