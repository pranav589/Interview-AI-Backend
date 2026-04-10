import { Router } from "express";
import {
  createInterview,
  getInterviews,
  getInterviewDetails,
  getInterviewStats,
  getFeedbackHandler,
  getScoreHistory,
} from "../controllers/interview/interview.controller";
import requireAuth from "../middleware/requireAuth";

import { interviewRateLimiter } from "../middleware/rateLimiter";
import { checkSubscription, requireCredits } from "../middleware/subscription";

const router = Router();

router.use(checkSubscription);

router.post("/feedback", getFeedbackHandler);
router.post("/", interviewRateLimiter, requireCredits, createInterview);
router.get("/", getInterviews);
router.get("/stats", getInterviewStats);
router.get("/score-history", getScoreHistory);
router.get("/:id", getInterviewDetails);

export default router;
