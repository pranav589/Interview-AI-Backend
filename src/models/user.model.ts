import { Schema, model } from "mongoose";
import { SUBSCRIPTION_TIERS, DEFAULT_FREE_CREDITS } from "../config/constants";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    name: {
      type: String,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      default: undefined,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    resetPasswordToken: {
      type: String,
      default: undefined,
    },
    resetPasswordExpires: {
      type: Date,
      default: undefined,
    },
    subscriptionTier: {
      type: String,
      enum: Object.values(SUBSCRIPTION_TIERS),
      default: SUBSCRIPTION_TIERS.FREE,
    },
    credits: {
      type: Number,
      default: DEFAULT_FREE_CREDITS,
    },
    lastCreditReset: {
      type: Date,
      default: Date.now,
    },
    resume: {
      type: String,
      default: undefined,
    },
    weeklyEmailDigest: {
      type: Boolean,
      default: true,
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    interviewerStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
    interviewerApplication: {
      answers: [String],
      aiFeedback: String,
    },
    maxCandidateExp: {
      type: Number,
      default: 0,
    },
    expertiseTags: [String],
  },
  {
    timestamps: true,
  },
);

userSchema.index({ resetPasswordToken: 1 }, { sparse: true }); // Password reset lookup

export const User = model("User", userSchema);
