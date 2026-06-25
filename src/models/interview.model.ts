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
    },
    employerId: {
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    candidateName: {
      type: String,
      required: false,
    },
    candidateEmail: {
      type: String,
      required: false,
    },
    snapshots: [
      {
        timestamp: { type: Date, default: Date.now },
        filename: { type: String, required: true },
        cloudinaryUrl: { type: String, required: false },
        trigger: {
          type: String,
          enum: ["random", "tab-switch", "start", "finish"],
          required: true,
        },
      },
    ],
    proctoringLogs: [
      {
        timestamp: { type: Date, default: Date.now },
        event: { type: String, required: true },
        details: { type: String, required: true },
      },
    ],
    recruitmentJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecruitmentJob",
      required: false,
      index: true,
    },
    videoFilename: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

interviewSchema.index({ userId: 1, createdAt: -1 }); // Dashboard listing
interviewSchema.index({ userId: 1, status: 1 }); // Status filtering

export const Interview = model("Interview", interviewSchema);
