import mongoose, { Schema, model } from "mongoose";

const bookingSchema = new Schema(
  {
    interviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled"],
      default: "pending",
    },
    transcriptionSummary: {
      type: String,
    },
    transcriptionId: {
      type: String, // AssemblyAI transcription ID
    },
    interviewerFeedback: {
      type: String,
    },
    interviewerScore: {
      type: Number,
      min: 0,
      max: 5,
    },
    feedbackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feedback",
    },
    roomUrl: {
      type: String,
    },
    actualDuration: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

// Prevent double bookings for the same interviewer at the same time
bookingSchema.index({ interviewerId: 1, startTime: 1 }, { unique: true });

export const Booking = model("Booking", bookingSchema);
