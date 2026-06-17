import mongoose, { Schema, model } from "mongoose";
import { INTERVIEW_TYPES, DIFFICULTY_LEVELS } from "../config/constants";

const recruitmentJobSchema = new Schema(
  {
    employerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    interviewType: {
      type: String,
      enum: INTERVIEW_TYPES,
      default: "technical",
    },
    difficultyLevel: {
      type: String,
      enum: DIFFICULTY_LEVELS,
      default: "intermediate",
    },
    duration: {
      type: Number,
      default: 30,
    },
    numberOfQuestions: {
      type: Number,
      default: 5,
    },
    customTopics: {
      type: String,
      default: "",
    },
    companyStyle: {
      type: String,
      default: "",
    },
    questionBankText: {
      type: String,
      default: "",
    },
    questionBankFilename: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const RecruitmentJob = model("RecruitmentJob", recruitmentJobSchema);
