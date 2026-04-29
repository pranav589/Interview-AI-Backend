import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import { MESSAGES } from "../config/constants";
import multer from "multer";
import { getProfile, uploadResume, updateSettings, completeOnboarding } from "../controllers/user/user.controller";

const router = Router();
const upload = multer({ 
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error(MESSAGES.USER.RESUME_INVALID_TYPE));
    }
    cb(null, true);
  }
});

// Get user profile
router.get("/me", requireAuth, getProfile);

// Complete onboarding
router.post("/complete-onboarding", requireAuth, completeOnboarding);

// Resume upload & parsing
router.post(
  "/resume", 
  requireAuth, 
  (req, res, next) => {
    upload.single("resume")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: MESSAGES.USER.RESUME_TOO_LARGE });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ message: MESSAGES.USER.UNEXPECTED_FIELD });
        }
        return res.status(400).json({ message: err.message });
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  uploadResume
);

// Update user settings
router.patch("/settings", requireAuth, updateSettings);

export default router;
