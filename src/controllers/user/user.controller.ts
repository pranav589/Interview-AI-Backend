import { Request, Response } from "express";
import { User } from "../../models/user.model";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import fs from "node:fs/promises";
import { createModuleLogger } from "../../lib/logger";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError, NotFoundError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { updateSettingsSchema, resumeUploadSchema } from "./user.schema";

const logger = createModuleLogger("user-controller");

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError("User not found");
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
    },
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
      throw new ValidationError("Could not extract text from PDF. Please ensure it's not an image-only PDF.");
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
      throw new NotFoundError("User not found");
    }

    return res.json({
      message: "Resume uploaded and processed successfully",
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
    throw new NotFoundError("User not found");
  }

  return res.json({
    message: "Settings updated successfully",
    user: {
      id: updatedUser.id,
      weeklyEmailDigest: updatedUser.weeklyEmailDigest,
    }
  });
});
