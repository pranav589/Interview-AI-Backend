import fs from "node:fs/promises";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import { Resume } from "../models/resume.model";
import { ResumeAnalysis } from "../models/resume-analysis.model";
import { JdMatch } from "../models/jd-match.model";
import { NotFoundError, ValidationError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { createModuleLogger } from "../lib/logger";
import { resumeService } from "./resume.service";
import { interviewService } from "./interview.service";

const logger = createModuleLogger("user-service");

export class UserService {
  async getProfile(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
    return user;
  }

  async completeOnboarding(userId: string) {
    const user = await User.findByIdAndUpdate(
      userId,
      { onboardingCompleted: true },
      { new: true },
    );
    if (!user) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
    return user;
  }

  async uploadResume(
    userId: string,
    filePath: string,
    fileType: string,
    originalName: string,
    forceReextract: boolean = false,
  ) {
    try {
      // Delegate to resumeService to parse, store, and trigger background extraction
      const {
        resume,
        jobId,
        extractionStatus,
        isDuplicate,
        startedExtraction,
        requiresConfirmation,
      } = await resumeService.uploadResume(
        userId,
        filePath,
        fileType,
        originalName || "Uploaded Resume",
        true, // make it default
        forceReextract,
      );

      const resumeText = resume.resumeText;

      if (!resumeText)
        throw new ValidationError(MESSAGES.USER.RESUME_EXTRACT_ERROR);

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { resume: resumeText },
        { new: true },
      );
      if (!updatedUser) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);

      return {
        updatedUser,
        resumeText,
        isDuplicate,
        startedExtraction,
        requiresConfirmation,
        jobId,
        extractionStatus,
        resume,
      };
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }

  async updateSettings(userId: string, settings: any) {
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: settings },
      { new: true },
    );
    if (!updatedUser) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
    return updatedUser;
  }

  async getDashboardStats(userId: string) {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const interviewStats = await interviewService.getStats(userId);

    const totalResumes = await Resume.countDocuments({ userId: userObjectId });

    const atsStatsResult = await ResumeAnalysis.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          avgAtsScore: { $avg: "$atsScore" },
          maxAtsScore: { $max: "$atsScore" },
        },
      },
    ]);

    const totalJdMatches = await JdMatch.countDocuments({
      userId: userObjectId,
    });
    const jdStatsResult = await JdMatch.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          avgJdMatchScore: { $avg: "$matchScore" },
          maxJdMatchScore: { $max: "$matchScore" },
        },
      },
    ]);

    const atsStats = atsStatsResult[0] || { avgAtsScore: 0, maxAtsScore: 0 };
    const jdStats = jdStatsResult[0] || {
      avgJdMatchScore: 0,
      maxJdMatchScore: 0,
    };

    return {
      interviewStats,
      resumeStats: {
        totalResumes,
        avgAtsScore: Math.round(atsStats.avgAtsScore || 0),
        maxAtsScore: Math.round(atsStats.maxAtsScore || 0),
        totalJdMatches,
        avgJdMatchScore: Math.round(jdStats.avgJdMatchScore || 0),
        maxJdMatchScore: Math.round(jdStats.maxJdMatchScore || 0),
      },
    };
  }
}

export const userService = new UserService();
