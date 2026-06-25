import { Router } from "express";
import {
  createInterview,
  getInterviews,
  getInterviewDetails,
  getInterviewStats,
  getFeedbackHandler,
  getJobStatusHandler,
  getScoreHistory,
} from "../controllers/interview/interview.controller";
import {
  uploadSnapshot,
  addProctorLog,
  streamSnapshot,
  uploadVideo,
  streamVideo,
} from "../controllers/interview/recruitment.controller";
import requireAuth from "../middleware/requireAuth";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

import { interviewRateLimiter } from "../middleware/rateLimiter";
import { checkSubscription, requireCredits } from "../middleware/subscription";

const router = Router();

router.use(checkSubscription);

router.post("/feedback", getFeedbackHandler);
router.get("/jobs/:jobId", getJobStatusHandler);
router.post("/", interviewRateLimiter, requireCredits, createInterview);
router.get("/", getInterviews);
router.get("/stats", getInterviewStats);
router.get("/score-history", getScoreHistory);
router.post("/:id/snapshot", requireAuth, uploadSnapshot);
router.post("/:id/proctor-log", requireAuth, addProctorLog);
router.post("/:id/video", requireAuth, upload.single("video"), uploadVideo);
router.get("/:id/video", requireAuth, streamVideo);
router.get("/:id/snapshots/:filename", requireAuth, streamSnapshot);
router.get("/:id", getInterviewDetails);

export default router;
