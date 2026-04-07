import { Request, Response, Router } from "express";
import requireAuth from "../middleware/requireAuth";
import multer from "multer";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { User } from "../models/user.model";
import path from "node:path";
import fs from "node:fs/promises";
import { createModuleLogger } from "../lib/logger";
import { asyncHandler } from "../lib/asyncHandler";
import { ValidationError, NotFoundError } from "../lib/errors";
import { AuthenticatedRequest } from "../types/express";


const logger = createModuleLogger("user-routes");

const router = Router();
const upload = multer({ 
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  }
});

// Get user profile
router.get("/me", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;

  
  // Fetch fresh user from DB to ensure state is current
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
}));

// Resume upload & parsing
router.post(
  "/resume", 
  requireAuth, 
  (req, res, next) => {
    upload.single("resume")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: "File too large. Maximum size is 5MB." });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ message: "Unexpected file field." });
        }
        return res.status(400).json({ message: err.message });
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).user.id;

    if (!req.file) {
      throw new ValidationError("No file uploaded");
    }

    const filePath = req.file.path;

    try {
      // 1. Extract text from PDF
      const loader = new PDFLoader(filePath);
      const docs = await loader.load();
      let resumeText = docs.map((doc) => doc.pageContent).join("\n").trim();
      
      if (!resumeText) {
        throw new ValidationError("Could not extract text from PDF. Please ensure it's not an image-only PDF.");
      }

      // High character limit check
      if (resumeText.length > 50000) {
        logger.warn({ userId, length: resumeText.length }, "Resume text truncated to 50,000 characters");
        resumeText = resumeText.slice(0, 50000);
      }

      // 2. Save text to User model
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
        resumeText: resumeText.slice(0, 100) + "...", // Sending sample back
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
      // Cleanup even if failed or succeeded
      if (filePath) await fs.unlink(filePath).catch(() => {});
    }
  })
);

export default router;
