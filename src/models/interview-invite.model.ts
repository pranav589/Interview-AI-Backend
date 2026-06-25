import mongoose, { Schema, model } from "mongoose";

const interviewInviteSchema = new Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    interviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Interview",
      required: true,
      unique: true,
    },
    employerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    candidateEmail: {
      type: String,
      required: true,
    },
    candidateName: {
      type: String,
      required: true,
    },
    scheduledStart: {
      type: Date,
      required: true,
    },
    scheduledEnd: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "activated", "completed", "expired"],
      default: "pending",
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecruitmentJob",
      required: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const InterviewInvite = model("InterviewInvite", interviewInviteSchema);
