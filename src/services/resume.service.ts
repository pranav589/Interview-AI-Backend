import { Resume, IResume } from "../models/resume.model";
import { NotFoundError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { createModuleLogger } from "../lib/logger";
import { Types } from "mongoose";
import { resumeFileParserService } from "./resume-file-parser.service";
import { resumeBuilderService } from "./resume-builder.service";
import { notificationService } from "./notification.service";
import { resumeJobService } from "./resume-job.service";

const logger = createModuleLogger("resume-service");

type UploadResumeResult = {
  resume: IResume;
  jobId?: string;
  extractionStatus?: IResume["extractionStatus"];
  isDuplicate: boolean;
  startedExtraction: boolean;
  requiresConfirmation?: boolean;
};

export class ResumeService {
  async getUserResumes(userId: string) {
    return await Resume.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  }

  async getResumeById(resumeId: string, userId: string) {
    const resume = await Resume.findOne({ _id: resumeId, userId });
    if (!resume) throw new NotFoundError(MESSAGES.USER.RESUME.NOT_FOUND);
    return resume;
  }

  async uploadResume(
    userId: string,
    filePath: string,
    fileType: string,
    name: string,
    isDefault: boolean = false,
    forceReextract: boolean = false,
  ): Promise<UploadResumeResult> {
    const resumeText = await resumeFileParserService.parse(filePath, fileType);

    if (resumeText.length >= 50000) {
      logger.warn({ userId, length: resumeText.length }, "Resume truncated");
    }

    // Check for duplicate resume
    const existingResume = await Resume.findOne({
      userId: new Types.ObjectId(userId),
      resumeText,
    });

    if (existingResume) {
      const existingName = existingResume.name || name;
      const latestExtractionJob = await resumeJobService.getLatestJobForResume(
        userId,
        "resume-extraction",
        String(existingResume._id),
      );
      const latestExtractionJobId = latestExtractionJob?._id.toString();

      // Handle duplicate if forceReextract is false
      if (!forceReextract) {
        const status = existingResume.extractionStatus;
        if (status === "completed") {
          logger.info({ userId, resumeId: existingResume._id }, "Duplicate resume uploaded. Reusing cached extraction.");

          await notificationService.createNotification({
            userId,
            type: "info",
            title: "Resume Cached",
            message: `Details from your resume "${existingName}" are already extracted and cached. Reusing cached details.`,
            link: "/resume/builder",
          });

          return {
            resume: existingResume,
            jobId: latestExtractionJobId,
            extractionStatus: status,
            isDuplicate: true,
            startedExtraction: false,
            requiresConfirmation: true,
          };
        } else if (status === "processing" || status === "pending") {
          logger.info({ userId, resumeId: existingResume._id }, "Duplicate resume uploaded. Extraction already in progress.");

          await notificationService.createNotification({
            userId,
            type: "info",
            title: "Extraction In Progress",
            message: `Your resume "${existingName}" is already undergoing background extraction. Please wait for it to complete.`,
          });

          return {
            resume: existingResume,
            jobId: latestExtractionJobId,
            extractionStatus: status,
            isDuplicate: true,
            startedExtraction: false,
          };
        } else {
          // Status is failed or unspecified, let them know they can force re-extraction
          logger.info({ userId, resumeId: existingResume._id }, "Duplicate resume uploaded. Previous extraction failed.");

          await notificationService.createNotification({
            userId,
            type: "warning",
            title: "Previous Extraction Failed",
            message: `Previous extraction for "${existingName}" failed. You can re-upload with force re-extraction enabled.`,
          });

          return {
            resume: existingResume,
            jobId: latestExtractionJobId,
            extractionStatus: status,
            isDuplicate: true,
            startedExtraction: false,
            requiresConfirmation: true,
          };
        }
      } else {
        // forceReextract is true, re-trigger extraction for existing resume
        logger.info({ userId, resumeId: existingResume._id }, "Force re-extract triggered for duplicate resume.");

        existingResume.resumeData = {
          personalInfo: {},
          summary: "",
          experience: [],
          education: [],
          skills: [],
          projects: [],
          certifications: [],
          languages: [],
          awards: [],
        };
        existingResume.intakeMetadata = {
          detectedExperienceYears: undefined,
          timelineGaps: [],
          missingFields: [],
          weakBullets: [],
          pendingQuestions: [],
        };
        existingResume.extractionStatus = "pending";
        existingResume.extractionError = undefined;
        await existingResume.save();

        const job = await resumeJobService.createJob(userId, "resume-extraction", {
          resumeId: String(existingResume._id),
        });

        await notificationService.createNotification({
          userId,
          type: "info",
          title: "Re-extraction Started",
          message: `Re-extraction has been triggered for your resume "${existingName}" and will continue in the background.`,
        });

        // Spawn background job
        this.extractResumeDetailsInBackground(String(existingResume._id), resumeText, job._id.toString()).catch((err) => {
          logger.error({ err, resumeId: existingResume._id }, "Background resume extraction unhandled rejection");
        });

        return {
          resume: existingResume,
          jobId: job._id.toString(),
          extractionStatus: "pending",
          isDuplicate: true,
          startedExtraction: true,
        };
      }
    }

    // If it's the first resume, make it default automatically
    const existingCount = await Resume.countDocuments({ userId });
    const finalIsDefault = existingCount === 0 ? true : isDefault;

    const resume = await Resume.create({
      userId: new Types.ObjectId(userId),
      name,
      resumeText,
      isDefault: finalIsDefault,
      extractionStatus: "pending",
    });

    const job = await resumeJobService.createJob(userId, "resume-extraction", {
      resumeId: String(resume._id),
    });

    await notificationService.createNotification({
      userId,
      type: "info",
      title: "Resume Uploaded",
      message: `Your resume "${name}" has been uploaded. Details are being extracted in the background.`,
    });

    // Spawn non-blocking background extraction
    this.extractResumeDetailsInBackground(String(resume._id), resumeText, job._id.toString()).catch((err) => {
      logger.error({ err, resumeId: resume._id }, "Background resume extraction unhandled rejection");
    });

    return {
      resume,
      jobId: job._id.toString(),
      extractionStatus: "pending",
      isDuplicate: false,
      startedExtraction: true,
    };
  }

  async extractResumeDetailsInBackground(resumeId: string, resumeText: string, jobId?: string): Promise<void> {
    logger.info({ resumeId }, "Starting background resume extraction...");

    const resumeDoc = await Resume.findById(resumeId);
    if (!resumeDoc) {
      logger.error({ resumeId }, "Resume not found in background job");
      return;
    }
    const resumeName = resumeDoc.name || "My Resume";
    const userIdStr = String(resumeDoc.userId);

    // Set status to processing
    await Resume.updateOne({ _id: resumeId }, { $set: { extractionStatus: "processing" } });
    if (jobId) {
      await resumeJobService.updateStatus(jobId, userIdStr, "processing");
    }

    try {
      const intake = await resumeBuilderService.extractAndProcessResume(resumeText);

      await Resume.updateOne(
        { _id: resumeId },
        {
          $set: {
            extractionStatus: "completed",
            resumeData: intake.resumeData,
            intakeMetadata: {
              detectedExperienceYears: intake.detectedExperienceYears,
              timelineGaps: intake.timelineGaps,
              missingFields: intake.missingFields,
              weakBullets: intake.weakBullets,
              pendingQuestions: intake.pendingQuestions,
            },
          },
        }
      );
      if (jobId) {
        await resumeJobService.updateStatus(jobId, userIdStr, "completed");
      }
      logger.info({ resumeId }, "Background resume extraction successfully completed and cached!");

      // Dispatch real-time success notification
      await notificationService.createNotification({
        userId: userIdStr,
        type: "success",
        title: "Resume Extracted",
        message: `Details from your resume "${resumeName}" have been successfully extracted and cached.`,
        link: "/resume/builder", // Link to resume builder/analyzer
      });

    } catch (error: any) {
      logger.error({ error, resumeId }, "Background resume extraction failed");
      await Resume.updateOne(
        { _id: resumeId },
        {
          $set: {
            extractionStatus: "failed",
            extractionError: error?.message || String(error),
          },
        }
      );
      if (jobId) {
        await resumeJobService.updateStatus(jobId, userIdStr, "failed", {
          error: error?.message || String(error),
        });
      }

      // Dispatch real-time error notification
      await notificationService.createNotification({
        userId: userIdStr,
        type: "error",
        title: "Extraction Failed",
        message: `Background details extraction for "${resumeName}" failed: ${error?.message || "Unknown error"}.`,
      });
    }
  }

  async setDefaultResume(resumeId: string, userId: string) {
    // Unset isDefault for all other resumes of this user
    await Resume.updateMany(
      { userId, _id: { $ne: resumeId } },
      { isDefault: false }
    );

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
