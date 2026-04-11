import { Request, Response } from "express";
import { User } from "../../models/user.model";
import { Availability } from "../../models/availability.model";
import { Booking } from "../../models/booking.model";
import { asyncHandler } from "../../lib/asyncHandler";
import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import {
  interviewerApplicationSchema,
  updateAvailabilitySchema,
  createBookingSchema,
  aiEvaluationSchema,
} from "./interviewer.schema";
import { invokeStructuredLLMWithFallback } from "../../lib/llm-with-fallback";
import { SystemMessage } from "@langchain/core/messages";
import { getVettingPrompt } from "../../lib/prompts";
import { format } from "date-fns";
import { createModuleLogger } from "../../lib/logger";
import { sendEmail } from "../../lib/email";
import {
  generateVideoSDKToken,
  createVideoSDKRoom,
} from "../../lib/videosdk.utils";

const logger = createModuleLogger("interviewer-controller");

/**
 * Submit an application to become an interviewer
 */
export const submitApplication = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const user = await User.findById(userId);

    if (!user) throw new NotFoundError("User not found");
    if (!user.resume)
      throw new ValidationError(
        "Please upload your resume first before applying.",
      );

    const result = interviewerApplicationSchema.safeParse(req.body);
    if (!result.success)
      throw new ValidationError(result.error.issues[0].message);

    const { answers } = result.data;

    // Update user status to pending
    user.interviewerStatus = "pending";
    user.interviewerApplication = {
      answers,
      aiFeedback: "",
    };
    await user.save();

    // Need to change it to backgound task
    evaluateApplicationWithAI(userId).catch((err) => {
      logger.error({ err, userId }, "Failed to evaluate application with AI");
    });

    return res.json({
      message:
        "Application submitted successfully. Our AI is reviewing your profile.",
      status: "pending",
    });
  },
);

/**
 * AI Logic to vet the interviewer
 */
async function evaluateApplicationWithAI(userId: string) {
  const user = await User.findById(userId);
  if (!user || user.interviewerStatus !== "pending") return;

  const prompt = getVettingPrompt(
    user.resume || "",
    user.interviewerApplication?.answers || [],
  );

  try {
    const evaluation = await invokeStructuredLLMWithFallback(
      aiEvaluationSchema,
      [new SystemMessage(prompt)],
      { jsonMode: true },
    );

    user.interviewerStatus = evaluation.status || "rejected";
    user.interviewerApplication!.aiFeedback = evaluation.aiFeedback;
    user.maxCandidateExp = evaluation.maxCandidateExp || 0;
    user.expertiseTags = evaluation.expertiseTags || [];

    await user.save();
    logger.info(
      { userId, status: user.interviewerStatus },
      "Interviewer application evaluated",
    );

    // TODO: Send email notification to user about the decision
  } catch (err) {
    logger.error({ err, userId }, "AI evaluation failed");
    user.interviewerStatus = "none"; // Reset so they can retry or we can re-trigger
    await user.save();
  }
}

/**
 * Set interviewer availability
 */
export const updateAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const user = await User.findById(userId);

    if (!user || user.interviewerStatus !== "approved") {
      throw new UnauthorizedError(
        "Only approved interviewers can set availability.",
      );
    }

    const result = updateAvailabilitySchema.safeParse(req.body);
    if (!result.success)
      throw new ValidationError(result.error.issues[0].message);

    const { weeklySlots, timezone } = result.data;

    const availability = await Availability.findOneAndUpdate(
      { interviewerId: userId },
      { weeklySlots, timezone, interviewerId: userId },
      { upsert: true, new: true },
    );

    return res.json({
      message: "Availability updated successfully.",
      availability,
    });
  },
);

/**
 * Get specific interviewer's availability for a date range
 */
export const getInterviewerAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    const { id: interviewerId } = req.params;

    const availability = await Availability.findOne({ interviewerId });
    if (!availability) {
      throw new NotFoundError("Interviewer availability not found.");
    }

    // Fetch existing bookings to exclude
    const bookings = await Booking.find({
      interviewerId,
      status: { $in: ["pending", "confirmed"] },
      startTime: { $gte: new Date() },
    });

    return res.json({
      availability,
      bookedSlots: bookings.map((b) => ({
        start: b.startTime,
        end: b.endTime,
      })),
    });
  },
);

/**
 * List all approved interviewers suitable for the candidate's level
 */
export const listInterviewers = asyncHandler(
  async (req: Request, res: Response) => {
    const user = await User.findById((req as AuthenticatedRequest).user.id);
    // Assume user's experience is 0 if not set, or fetch from profile
    const candidateExp = 0; // TODO: Get from user profile stats/onboarding

    const interviewers = await User.find({
      interviewerStatus: "approved",
      maxCandidateExp: { $gte: candidateExp },
    }).select("name resume expertiseTags maxCandidateExp");

    return res.json({ interviewers });
  },
);

/**
 * Handle booking an interview slot
 */
export const createBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const candidateId = (req as AuthenticatedRequest).user.id;
    const result = createBookingSchema.safeParse(req.body);

    if (!result.success)
      throw new ValidationError(result.error.issues[0].message);

    const { interviewerId, startTime, endTime } = result.data;

    // Verify availability and ensure no double booking
    const existingBooking = await Booking.findOne({
      interviewerId,
      $or: [
        { startTime: { $lt: new Date(endTime), $gte: new Date(startTime) } },
        { endTime: { $gt: new Date(startTime), $lte: new Date(endTime) } },
      ],
      status: { $in: ["pending", "confirmed"] },
    });

    if (existingBooking) {
      throw new ValidationError("This slot is already booked.");
    }

    // Create VideoSDK Room
    let roomUrl = "";

    try {
      const token = generateVideoSDKToken();
      const roomId = await createVideoSDKRoom(token);
      roomUrl = roomId; // We store just the roomId; frontend will prepend it with VideoSDK domain if needed, or we use it directly in the Prebuilt SDK
      logger.info({ roomId, interviewerId }, "VideoSDK room created");
    } catch (err: any) {
      logger.error({ err, interviewerId }, "Failed to create VideoSDK room");
      throw new ValidationError(
        err.message || "Failed to initialize video room. Please try again.",
      );
    }

    // Save Booking
    const booking = await Booking.create({
      interviewerId,
      candidateId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      roomUrl,
      status: "confirmed", // Auto-confirm for now
    });

    // Send emails to both parties
    const interviewer = await User.findById(interviewerId);
    const candidate = (req as AuthenticatedRequest).user;
    const formattedTime = format(new Date(startTime), "PPPP 'at' p");

    if (interviewer && candidate) {
      // Notify Interviewer
      await sendEmail(
        interviewer.email,
        "New Interview Booking Received",
        `<h1>You have a new interview!</h1>
       <p>Candidate: ${candidate.name}</p>
       <p>Time: ${formattedTime}</p>
       <p>Room URL: <a href="${process.env.FRONTEND_URL}/interview/human/${booking._id}">${process.env.FRONTEND_URL}/interview/human/${booking._id}</a></p>`,
      ).catch((err) =>
        logger.error({ err, interviewerId }, "Interviewer email failed"),
      );

      // Notify Candidate
      await sendEmail(
        candidate.email,
        "Interview Booking Confirmed",
        `<h1>Your interview is confirmed!</h1>
       <p>Interviewer: ${interviewer.name}</p>
       <p>Time: ${formattedTime}</p>
       <p>Room URL: <a href="${process.env.FRONTEND_URL}/interview/human/${booking._id}">${process.env.FRONTEND_URL}/interview/human/${booking._id}</a></p>`,
      ).catch((err) =>
        logger.error({ err, candidateId }, "Candidate email failed"),
      );
    }

    return res.json({
      message: "Booking confirmed!",
      booking,
    });
  },
);

/**
 * Get details for a specific booking
 */
export const getBookingDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const booking = await Booking.findById(id).populate(
      "interviewerId candidateId",
      "name expertiseTags",
    );

    if (!booking) throw new NotFoundError("Booking not found");

    // Security: Check if user is either the candidate or the interviewer
    const userId = (req as AuthenticatedRequest).user.id;
    if (
      booking.candidateId._id.toString() !== userId &&
      booking.interviewerId._id.toString() !== userId
    ) {
      throw new UnauthorizedError(
        "You are not authorized to view this booking.",
      );
    }

    const token = generateVideoSDKToken();

    // If roomUrl is missing (e.g. from old bookings or failed creation), generate it now
    // We check the latest database state to avoid race conditions between candidate and interviewer
    if (!booking.roomUrl) {
      // Re-fetch to see if another user just created it
      const latestBooking = await Booking.findById(id);
      if (latestBooking?.roomUrl) {
        booking.roomUrl = latestBooking.roomUrl;
      } else {
        try {
          const roomId = await createVideoSDKRoom(token);

          // Atomically set roomUrl if it's still missing in DB
          const result = await Booking.findOneAndUpdate(
            {
              _id: id,
              $or: [
                { roomUrl: { $exists: false } },
                { roomUrl: "" },
                { roomUrl: null },
              ],
            },
            { roomUrl: roomId },
            { new: true },
          );

          if (result) {
            booking.roomUrl = roomId;
            logger.info(
              { bookingId: id, roomId },
              "Lazily created VideoSDK room for booking",
            );
          } else {
            // Someone else beat us to it, use theirs
            const beatUs = await Booking.findById(id);
            booking.roomUrl = beatUs?.roomUrl;
            logger.info({ bookingId: id }, "Used concurrently created roomUrl");
          }
        } catch (err) {
          logger.error(
            { err, bookingId: id },
            "Failed to lazily create VideoSDK room",
          );
        }
      }
    }

    return res.json({ booking, videoSDKToken: token });
  },
);

/**
 * Mark a booking as completed (called when interviewer leaves the room)
 */
export const completeBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const booking = await Booking.findById(id);

    if (!booking) throw new NotFoundError("Booking not found");

    // Verify only the interviewer can mark as complete
    const userId = (req as AuthenticatedRequest).user.id;
    if (booking.interviewerId.toString() !== userId) {
      throw new UnauthorizedError(
        "Only the interviewer can formally end the session.",
      );
    }

    if (booking.status !== "completed") {
      booking.status = "completed";
      if (req.body.actualDuration) {
        booking.actualDuration = req.body.actualDuration;
      }
      await booking.save();
      logger.info(
        { bookingId: id, duration: booking.actualDuration },
        "Booking marked as completed by interviewer",
      );
    }

    return res.json({ message: "Session marked as completed", booking });
  },
);

/**
 * Submit feedback for an interview session
 */
export const submitFeedback = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { feedback, score } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) throw new NotFoundError("Booking not found");

    // Verify only interviewer can submit feedback
    const userId = (req as AuthenticatedRequest).user.id;
    if (booking.interviewerId.toString() !== userId) {
      throw new UnauthorizedError("Only the interviewer can submit feedback.");
    }

    booking.interviewerFeedback = feedback;
    booking.interviewerScore = score;
    booking.status = "completed";
    if (req.body.actualDuration) {
      booking.actualDuration = req.body.actualDuration;
    }
    await booking.save();

    // TODO: Trigger AI to refine the transcriptionSummary if needed

    return res.json({ message: "Feedback submitted successfully", booking });
  },
);

/**
 * Get all bookings for an interviewer
 */
export const getMyInterviewerBookings = asyncHandler(
  async (req: Request, res: Response) => {
    const interviewerId = (req as AuthenticatedRequest).user.id;
    const bookings = await Booking.find({ interviewerId })
      .populate("candidateId", "name email")
      .sort({ startTime: 1 });

    return res.json({ bookings });
  },
);

/**
 * Get all bookings for a candidate
 */
export const getMyCandidateBookings = asyncHandler(
  async (req: Request, res: Response) => {
    const candidateId = (req as AuthenticatedRequest).user.id;
    const bookings = await Booking.find({ candidateId })
      .populate("interviewerId", "name email expertiseTags")
      .sort({ startTime: 1 });

    return res.json({ bookings });
  },
);
