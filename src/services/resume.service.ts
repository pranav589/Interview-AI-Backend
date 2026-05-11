import fs from "node:fs/promises";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Resume, IResume } from "../models/resume.model";
import { NotFoundError, ValidationError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { createModuleLogger } from "../lib/logger";
import { Types } from "mongoose";

const logger = createModuleLogger("resume-service");

export class ResumeService {
  async getUserResumes(userId: string) {
    return await Resume.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  }

  async getResumeById(resumeId: string, userId: string) {
    const resume = await Resume.findOne({ _id: resumeId, userId });
    if (!resume) throw new NotFoundError(MESSAGES.USER.RESUME.NOT_FOUND);
    return resume;
  }

  async uploadResume(userId: string, filePath: string, name: string, isDefault: boolean = false) {
    try {
      const loader = new PDFLoader(filePath);
      const docs = await loader.load();
      let resumeText = docs.map((doc) => doc.pageContent).join("\n").trim();

      if (!resumeText) throw new ValidationError(MESSAGES.USER.RESUME_EXTRACT_ERROR);

      if (resumeText.length > 50000) {
        logger.warn({ userId, length: resumeText.length }, "Resume truncated");
        resumeText = resumeText.slice(0, 50000);
      }

      // If it's the first resume, make it default automatically
      const existingCount = await Resume.countDocuments({ userId });
      const finalIsDefault = existingCount === 0 ? true : isDefault;

      const resume = await Resume.create({
        userId: new Types.ObjectId(userId),
        name,
        resumeText,
        isDefault: finalIsDefault,
      });

      return resume;
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }

  async setDefaultResume(resumeId: string, userId: string) {
    const resume = await Resume.findOneAndUpdate(
      { _id: resumeId, userId },
      { isDefault: true },
      { new: true }
    );
    if (!resume) throw new NotFoundError(MESSAGES.USER.RESUME.NOT_FOUND);
    return resume;
  }

  async deleteResume(resumeId: string, userId: string) {
    const resume = await Resume.findOneAndDelete({ _id: resumeId, userId });
    if (!resume) throw new NotFoundError(MESSAGES.USER.RESUME.NOT_FOUND);
    
    // If we deleted the default one, pick another one to be default
    if (resume.isDefault) {
      const anotherResume = await Resume.findOne({ userId }).sort({ createdAt: -1 });
      if (anotherResume) {
        anotherResume.isDefault = true;
        await anotherResume.save();
      }
    }
    
    return resume;
  }
}

export const resumeService = new ResumeService();
