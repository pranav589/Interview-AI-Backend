import { Schema, model, Document, Types } from "mongoose";

export interface IGeneratedResume extends Document {
  userId: Types.ObjectId;
  name: string;
  templateId: string;
  resumeData: {
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
  chatHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  skipFlags: Record<string, boolean>;
  completionMap: Record<string, boolean>;
  generatedTemplates: {
    modern?: string;
    classic?: string;
    executive?: string;
  };
  source?: {
    fileName?: string;
    fileType?: string;
    resumeId?: string;
    extractedText?: string;
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
  status: "in-progress" | "completed";
  currentStep: string;
  fileKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const generatedResumeSchema = new Schema<IGeneratedResume>(
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
    },
    templateId: {
      type: String,
      enum: ["modern", "classic", "executive"],
      default: "modern",
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
    chatHistory: [
      {
        role: { type: String, enum: ["user", "assistant", "system"] },
        content: String,
      },
    ],
    skipFlags: { type: Schema.Types.Mixed, default: {} },
    completionMap: { type: Schema.Types.Mixed, default: {} },
    generatedTemplates: {
      modern: String,
      classic: String,
      executive: String,
    },
    source: {
      fileName: String,
      fileType: String,
      resumeId: String,
      extractedText: String,
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
    status: {
      type: String,
      enum: ["in-progress", "completed"],
      default: "in-progress",
    },
    currentStep: {
      type: String,
      default: "personalInfo",
    },
    fileKey: String,
  },
  {
    timestamps: true,
  }
);

export const GeneratedResume = model<IGeneratedResume>("GeneratedResume", generatedResumeSchema);
