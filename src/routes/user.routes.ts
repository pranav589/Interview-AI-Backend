import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import multer from "multer";
import { getProfile, uploadResume, updateSettings } from "../controllers/user/user.controller";

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
router.get("/me", requireAuth, getProfile);

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
  uploadResume
);

// Update user settings
router.patch("/settings", requireAuth, updateSettings);

export default router;
