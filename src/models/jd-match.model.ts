import { Schema, model, Document, Types } from "mongoose";

export interface IJdMatch extends Document {
  userId: Types.ObjectId;
  resumeId: Types.ObjectId;
  resumeText: string;
  jobDescription: string;
  jobTitle?: string;
  company?: string;
  matchScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  sectionFeedback: Array<{
    section: string;
    gap: string;
    suggestion: string;
  }>;
  updatedResumeSections?: any; // AI-rewritten parts
  shouldUpdateEntireResume: boolean;
  pdfFileKey?: string;
  createdAt: Date;
}

const jdMatchSchema = new Schema<IJdMatch>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    resumeId: {
      type: Schema.Types.ObjectId,
      ref: "Resume",
      required: true,
    },
    resumeText: {
      type: String,
      required: true,
    },
    jobDescription: {
      type: String,
      required: true,
    },
    jobTitle: String,
    company: String,
    matchScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    matchedKeywords: [String],
    missingKeywords: [String],
    sectionFeedback: [
      {
        section: String,
        gap: String,
        suggestion: String,
      },
    ],
    updatedResumeSections: Schema.Types.Mixed,
    shouldUpdateEntireResume: {
      type: Boolean,
      default: false,
    },
    pdfFileKey: String,
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const JdMatch = model<IJdMatch>("JdMatch", jdMatchSchema);
