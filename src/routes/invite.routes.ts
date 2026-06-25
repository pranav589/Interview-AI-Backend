import { Router } from "express";
import {
  scheduleInterview,
  getInviteDetails,
  startInterviewSession,
  listEmployerInvites,
} from "../controllers/interview/recruitment.controller";
import requireAuth from "../middleware/requireAuth";
import multer from "multer";

const router = Router();

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Employer only route to list all invites
router.get("/employer/list", requireAuth, listEmployerInvites);

// Employer only route to schedule an interview
router.post("/schedule", requireAuth, upload.single("resumeFile"), scheduleInterview);

// Public route to get details of the invite (pre-interview)
router.get("/:token", getInviteDetails);

// Public route to start the interview session (authenticates and starts)
router.post("/:token/start", startInterviewSession);

export default router;
