import { Request, Response } from "express";
import { User } from "../../models/user.model";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import fs from "node:fs/promises";
import { createModuleLogger } from "../../lib/logger";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError, NotFoundError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { updateSettingsSchema, resumeUploadSchema } from "./user.schema";
import { MESSAGES } from "../../config/constants";

const logger = createModuleLogger("user-controller");

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      hasResume: !!user.resume,
      twoFactorEnabled: user.twoFactorEnabled,
      subscriptionTier: user.subscriptionTier,
      credits: user.credits,
      lastCreditReset: user.lastCreditReset,
      weeklyEmailDigest: user.weeklyEmailDigest,
      onboardingCompleted: user.onboardingCompleted,
      interviewerStatus: user.interviewerStatus,
      maxCandidateExp: user.maxCandidateExp,
      expertiseTags: user.expertiseTags,
      interviewerApplication: user.interviewerApplication,
    },
  });
});

export const completeOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const user = await User.findByIdAndUpdate(
    userId,
    { onboardingCompleted: true },
    { new: true }
  );

  if (!user) {
    throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
  }

  return res.json({
    message: MESSAGES.USER.ONBOARDING_SUCCESS,
    user: {
      onboardingCompleted: user.onboardingCompleted,
    }
  });
});

export const uploadResume = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const result = resumeUploadSchema.safeParse(req.file);
  if (!result.success) {
    // If validation failed, delete the file if it was uploaded before erroring out
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    throw new ValidationError(result.error.issues[0].message);
  }

  const { path: filePath } = req.file!;

  try {
    const loader = new PDFLoader(filePath);
    const docs = await loader.load();
    let resumeText = docs.map((doc) => doc.pageContent).join("\n").trim();

    if (!resumeText) {
      throw new ValidationError(MESSAGES.USER.RESUME_EXTRACT_ERROR);
    }

    if (resumeText.length > 50000) {
      logger.warn({ userId, length: resumeText.length }, "Resume text truncated to 50,000 characters");
      resumeText = resumeText.slice(0, 50000);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { resume: resumeText },
      { new: true }
    );

    if (!updatedUser) {
      throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
    }

    return res.json({
      message: MESSAGES.USER.RESUME_UPLOAD_SUCCESS,
      resumeText: resumeText.slice(0, 100) + "...",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        isEmailVerified: updatedUser.isEmailVerified,
        hasResume: !!updatedUser.resume,
        twoFactorEnabled: updatedUser.twoFactorEnabled,
      }
    });
  } catch (err: any) {
    logger.error({ err, userId }, "Failed to process resume");
    throw err;
  } finally {
    if (filePath) await fs.unlink(filePath).catch(() => {});
  }
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const result = updateSettingsSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0].message);
  }

  const { weeklyEmailDigest } = result.data;

  const update: any = {};
  if (typeof weeklyEmailDigest === "boolean") {
    update.weeklyEmailDigest = weeklyEmailDigest;
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: update },
    { new: true }
  );

  if (!updatedUser) {
    throw new NotFoundError(MESSAGES.USER.NOT_FOUND);
  }

  return res.json({
    message: MESSAGES.USER.SETTINGS_UPDATE_SUCCESS,
    user: {
      id: updatedUser.id,
      weeklyEmailDigest: updatedUser.weeklyEmailDigest,
    }
  });
});
