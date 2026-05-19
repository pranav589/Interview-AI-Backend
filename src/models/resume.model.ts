import { Schema, model, Document, Types } from "mongoose";

export interface IResume extends Document {
  userId: Types.ObjectId;
  name: string;
  resumeText: string;
  fileKey?: string;
  isDefault: boolean;
  resumeData?: {
    personalInfo: any;
    summary: string;
    experience: any[];
    education: any[];
    skills: string[];
    projects: any[];
    certifications: any[];
    languages?: string[];
    awards?: string[];
  };
  intakeMetadata?: {
    detectedExperienceYears?: number;
    timelineGaps?: string[];
    missingFields?: string[];
    weakBullets?: string[];
    pendingQuestions?: Array<{
      id: string;
      category: string;
      question: string;
      resolved?: boolean;
    }>;
  };
  extractionStatus?: "pending" | "processing" | "completed" | "failed";
  extractionError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const resumeSchema = new Schema<IResume>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    resumeText: {
      type: String,
      required: true,
    },
    fileKey: {
      type: String,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    resumeData: {
      personalInfo: { type: Schema.Types.Mixed, default: {} },
      summary: { type: String, default: "" },
      experience: { type: [Schema.Types.Mixed], default: [] },
      education: { type: [Schema.Types.Mixed], default: [] },
      skills: { type: [String], default: [] },
      projects: { type: [Schema.Types.Mixed], default: [] },
      certifications: { type: [Schema.Types.Mixed], default: [] },
      languages: { type: [String], default: [] },
      awards: { type: [Schema.Types.Mixed], default: [] },
    },
    intakeMetadata: {
      detectedExperienceYears: Number,
      timelineGaps: { type: [String], default: [] },
      missingFields: { type: [String], default: [] },
      weakBullets: { type: [String], default: [] },
      pendingQuestions: {
        type: [
          {
            id: String,
            category: String,
            question: String,
            resolved: { type: Boolean, default: false },
          },
        ],
        default: [],
      },
    },
    extractionStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    extractionError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// Ensure only one default resume per user
resumeSchema.pre("save", async function () {
  if (this.isDefault) {
    await (this.constructor as any).updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { $set: { isDefault: false } },
    );
  }
});

export const Resume = model<IResume>("Resume", resumeSchema);
