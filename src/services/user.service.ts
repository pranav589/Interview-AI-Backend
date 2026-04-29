import fs from "node:fs/promises";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { User } from "../models/user.model";
import { NotFoundError, ValidationError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { createModuleLogger } from "../lib/logger";

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

  async uploadResume(userId: string, filePath: string) {
    try {
      const loader = new PDFLoader(filePath);
      const docs = await loader.load();
      let resumeText = docs.map((doc) => doc.pageContent).join("\n").trim();

      if (!resumeText) throw new ValidationError(MESSAGES.USER.RESUME_EXTRACT_ERROR);

      if (resumeText.length > 50000) {
        logger.warn({ userId, length: resumeText.length }, "Resume truncated");
        resumeText = resumeText.slice(0, 50000);
      }

      const updatedUser = await User.findByIdAndUpdate(userId, { resume: resumeText }, { new: true });
      if (!updatedUser) throw new NotFoundError(MESSAGES.USER.NOT_FOUND);

      return { updatedUser, resumeText };
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
