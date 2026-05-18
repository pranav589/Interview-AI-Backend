import fs from "node:fs/promises";
import { User } from "../models/user.model";
import { NotFoundError, ValidationError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { createModuleLogger } from "../lib/logger";
import { resumeService } from "./resume.service";

const logger = createModuleLogger("user-service");

export class UserService {
  async getProfile(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
    return user;
  }

  async completeOnboarding(userId: string) {
    const user = await User.findByIdAndUpdate(userId, { onboardingCompleted: true }, { new: true });
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
      const { resume, jobId, extractionStatus, isDuplicate, startedExtraction, requiresConfirmation } = await resumeService.uploadResume(
        userId,
        filePath,
        fileType,
        originalName || "Uploaded Resume",
        true, // make it default
        forceReextract,
      );

      const resumeText = resume.resumeText;

      if (!resumeText) throw new ValidationError(MESSAGES.USER.RESUME_EXTRACT_ERROR);

      const updatedUser = await User.findByIdAndUpdate(userId, { resume: resumeText }, { new: true });
      if (!updatedUser) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);

      return { updatedUser, resumeText, isDuplicate, startedExtraction, requiresConfirmation, jobId, extractionStatus, resume };
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }

  async updateSettings(userId: string, settings: any) {
    const updatedUser = await User.findByIdAndUpdate(userId, { $set: settings }, { new: true });
    if (!updatedUser) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
    return updatedUser;
  }
}

export const userService = new UserService();
