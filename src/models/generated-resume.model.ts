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
  };
  chatHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
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
      enum: ["modern", "classic", "minimalist"],
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
    },
    chatHistory: [
      {
        role: { type: String, enum: ["user", "assistant", "system"] },
        content: String,
      },
    ],
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
