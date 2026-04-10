import mongoose, { Schema, model } from "mongoose";
import { INTERVIEW_TYPES, DIFFICULTY_LEVELS } from "../config/constants";

const interviewSchema = new Schema(
  {
    userId: {
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    interviewType: {
      type: String,
      enum: INTERVIEW_TYPES,
      required: true,
    },
    difficultyLevel: {
      type: String,
      enum: DIFFICULTY_LEVELS,
      required: true,
    },
    numberOfQuestions: {
      type: Number,
      default: 5,
      required: true,
    },
    duration: {
      type: Number,
      default: 30,
    },
    actualDuration: {
      type: Number,
      default: 0,
    },
    jobTitle: {
      type: String,
    },
    company: {
      type: String,
    },
    customTopics: {
      type: String,
    },
    jobDescription: {
      type: String,
    },
    companyStyle: {
      type: String,
    },
    status: {
      type: String,
      enum: ["not-started", "in-progress", "paused", "completed"],
      default: "not-started",
    },
    elapsedSeconds: {
      type: Number,
      default: 0,
    },
    score: { type: Number, default: 0 },
    feedbackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feedback"
    },
    resume: {
      type: String,
    }
  },
  {
    timestamps: true,
  },
);

interviewSchema.index({ userId: 1, createdAt: -1 }); // Dashboard listing
interviewSchema.index({ userId: 1, status: 1 }); // Status filtering

export const Interview = model("Interview", interviewSchema);
