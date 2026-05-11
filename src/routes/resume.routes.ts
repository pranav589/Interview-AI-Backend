import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import { checkSubscription } from "../middleware/subscription";
import multer from "multer";
import { 
  uploadResume, 
  getResumes, 
  analyzeResume, 
  runJdMatch, 
  startBuilder, 
  sendBuilderMessage, 
  exportResume,
  exportJdMatch,
  getResumeAnalysis,
  getUserAnalyses,
  getJdMatch,
  getUserJdMatches,
  getResumeJob,
  downloadResumeJobArtifact,
  exportResumeAnalysis
} from "../controllers/user/resume.controller";

const router = Router();

// Multer config for JD files (PDF, DOCX, Text)
const jdupload = multer({ 
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Multer for Resume upload
const resumeUpload = multer({ 
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(requireAuth);
router.use(checkSubscription);

router.post("/upload", resumeUpload.single("resume"), uploadResume);
router.get("/", getResumes);

// Analyzer
router.post("/analyze", analyzeResume);
router.get("/analyze", getUserAnalyses);
router.get("/analyze/:id", getResumeAnalysis);
router.get("/analyze/:id/export", exportResumeAnalysis);

// JD Match
router.post("/jd-match", jdupload.single("jdFile"), runJdMatch);
router.get("/jd-match", getUserJdMatches);
router.get("/jd-match/:id", getJdMatch);
router.post("/jd-match/:id/export", exportJdMatch);

// Builder
router.post("/builder/start", startBuilder);
router.post("/builder/message", sendBuilderMessage);
router.post("/builder/export", exportResume);

// Async jobs
router.get("/jobs/:id", getResumeJob);
router.get("/jobs/:id/download", downloadResumeJobArtifact);

export default router;
