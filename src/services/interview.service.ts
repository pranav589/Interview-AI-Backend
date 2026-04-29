import mongoose from "mongoose";
import { Interview } from "../models/interview.model";
import { User } from "../models/user.model";
import { Feedback } from "../models/feedback.model";
import { SUBSCRIPTION_TIERS, MESSAGES } from "../config/constants";
import { isFeatureEnabled } from "../utils/feature-flags";
import { NotFoundError } from "../lib/errors";

export class InterviewService {
  async createInterview(userId: string, data: any, fullUser: any) {
    const newInterview = await Interview.create({
      userId,
      ...data,
      resume: fullUser?.resume,
    });

    if (await isFeatureEnabled("credits_system_enabled")) {
      if (fullUser.subscriptionTier === SUBSCRIPTION_TIERS.FREE) {
        fullUser.credits = Math.max(0, fullUser.credits - 1);
        await fullUser.save();
      }
    }

    return newInterview;
  }

  async getInterviews(userId: string, filters: any) {
    const { page, limit, type, difficulty, status } = filters;
    const skip = (page - 1) * limit;

    const query: any = { userId };
    if (type && type !== "all") query.interviewType = type;
    if (difficulty && difficulty !== "all") query.difficultyLevel = difficulty;
    if (status && status !== "all") query.status = status;

    const interviews = await Interview.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Interview.countDocuments(query);

    return {
      interviews,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getInterviewDetails(userId: string, interviewId: string) {
    const interview = await Interview.findOne({
      _id: interviewId,
      userId,
    }).populate("feedbackId");

    if (!interview) {
      throw new NotFoundError(MESSAGES.INTERVIEW.NOT_FOUND);
    }

    return interview;
  }

  async getStats(userId: string) {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const aggregationResult = await Interview.aggregate([
      { $match: { userId: userObjectId, status: "completed" } },
      {
        $group: {
          _id: null,
          totalInterviews: { $sum: 1 },
          avgScore: { $avg: "$score" },
          totalDuration: { $sum: "$actualDuration" },
        },
      },
    ]);

    const stats = aggregationResult[0] || {
      totalInterviews: 0,
      avgScore: 0,
      totalDuration: 0,
    };

    const radarAggregation = await Feedback.aggregate([
      {
        $lookup: {
          from: "interviews",
          localField: "interviewId",
          foreignField: "_id",
          as: "interview",
        },
      },
      { $unwind: "$interview" },
      { $match: { "interview.userId": userObjectId } },
      {
        $group: {
          _id: null,
          communication: { $avg: "$communicationScore" },
          technical: { $avg: "$technicalScore" },
          confidence: { $avg: "$confidenceScore" },
        },
      },
    ]);

    const radarData = radarAggregation[0]
      ? {
          communication: Math.round(radarAggregation[0].communication || 0),
          technical: Math.round(radarAggregation[0].technical || 0),
          confidence: Math.round(radarAggregation[0].confidence || 0),
        }
      : { communication: 0, technical: 0, confidence: 0 };

    const streak = await this.calculateStreak(userId);
    const percentile = await this.calculatePercentile(userId, stats.avgScore);

    return {
      totalInterviews: stats.totalInterviews,
      avgScore: Math.round(stats.avgScore || 0),
      totalDuration: stats.totalDuration,
      radarData,
      streak,
      percentile,
    };
  }

  async getScoreHistory(userId: string) {
    const interviews = await Interview.find({
      userId,
      status: "completed",
      score: { $gt: 0 },
    })
      .sort({ createdAt: 1 })
      .select("score interviewType createdAt")
      .limit(20);

    return interviews.map((i) => ({
      date: i.createdAt,
      score: i.score,
      type: i.interviewType,
    }));
  }

  private async calculateStreak(userId: string) {
    const interviews = await Interview.find({
      userId,
      status: "completed",
    })
      .sort({ createdAt: -1 })
      .select("createdAt");

    if (interviews.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let lastDate = new Date(interviews[0].createdAt);
    lastDate.setHours(0, 0, 0, 0);

    const diff = (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diff > 1) return 0;

    let streak = 1;
    let currentCheckDate = lastDate;

    for (let i = 1; i < interviews.length; i++) {
      const nextDate = new Date(interviews[i].createdAt);
      nextDate.setHours(0, 0, 0, 0);

      const dayDiff = (currentCheckDate.getTime() - nextDate.getTime()) / (1000 * 60 * 60 * 24);
      if (dayDiff === 1) {
        streak++;
        currentCheckDate = nextDate;
      } else if (dayDiff > 1) {
        break;
      }
    }
    return streak;
  }

  private async calculatePercentile(userId: string, userAvgScore: number) {
    const allUsersStats = await Interview.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: "$userId",
          avgScore: { $avg: "$score" },
        },
      },
    ]);

    if (allUsersStats.length <= 1) return 100;

    const lowerScores = allUsersStats.filter((u) => u.avgScore < userAvgScore).length;
    return Math.round((lowerScores / (allUsersStats.length - 1)) * 100);
  }
}

export const interviewService = new InterviewService();
