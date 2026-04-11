import { Router } from "express";
import * as interviewerController from "../controllers/interviewer/interviewer.controller";
import requireAuth from "../middleware/requireAuth";

const router = Router();

// Applying requireAuth middleware to all routes
router.use(requireAuth);

// Interviewer Application
router.post("/application", interviewerController.submitApplication);

// Availability Management
router.get(
  "/availability/:id",
  interviewerController.getInterviewerAvailability,
);
router.post("/availability", interviewerController.updateAvailability);

// Interviewer Discovery
router.get("/list", interviewerController.listInterviewers);

// Bookings
router.post("/bookings", interviewerController.createBooking);
router.get("/bookings/:id", interviewerController.getBookingDetails);
router.post("/bookings/:id/complete", interviewerController.completeBooking);
router.post("/bookings/:id/feedback", interviewerController.submitFeedback);

// My Bookings
router.get(
  "/my-bookings/interviewer",
  interviewerController.getMyInterviewerBookings,
);
router.get(
  "/my-bookings/candidate",
  interviewerController.getMyCandidateBookings,
);

export default router;
