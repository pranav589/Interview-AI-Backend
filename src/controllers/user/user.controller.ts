import { Request, Response } from "express";
import { userService } from "../../services/user.service";
import { createModuleLogger } from "../../lib/logger";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { updateSettingsSchema, resumeUploadSchema } from "../../validators/user.validator";
import { MESSAGES } from "../../config/constants";
import fs from "node:fs/promises";

const logger = createModuleLogger("user-controller");

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const user = await userService.getProfile(userId);

  return res.json({
    success: true,
    message: MESSAGES.USER.PROFILE_FETCHED,
    data: sanitizeUser(user),
  });
});

export const completeOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const user = await userService.completeOnboarding(userId);

  return res.json({
    success: true,
    message: MESSAGES.USER.ONBOARDING_SUCCESS,
    data: { onboardingCompleted: user.onboardingCompleted },
  });
});

export const uploadResume = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const result = resumeUploadSchema.safeParse(req.file);
  
  if (!result.success) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    throw new ValidationError(result.error.issues[0].message);
  }

  const { updatedUser, resumeText } = await userService.uploadResume(userId, req.file!.path);

  return res.json({
    success: true,
    message: MESSAGES.USER.RESUME_UPLOAD_SUCCESS,
    data: {
      resumeText: resumeText.slice(0, 100) + "...",
      user: sanitizeUser(updatedUser),
    }
  });
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const result = updateSettingsSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);

  const updatedUser = await userService.updateSettings(userId, result.data);

  return res.json({
    success: true,
    message: MESSAGES.USER.SETTINGS_UPDATE_SUCCESS,
    data: {
      id: updatedUser.id,
      weeklyEmailDigest: updatedUser.weeklyEmailDigest,
    }
  });
});

function sanitizeUser(user: any) {
  return {
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
  };
}
