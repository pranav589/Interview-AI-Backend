import { Schema, model, Document, Types } from "mongoose";

export type ResumeJobType = "resume-analysis" | "jd-match" | "builder-export" | "jd-match-export";
export type ResumeJobStatus = "queued" | "processing" | "completed" | "failed";

export interface IResumeJob extends Document {
  userId: Types.ObjectId;
  jobType: ResumeJobType;
  status: ResumeJobStatus;
  inputRef?: {
    resumeId?: Types.ObjectId;
    sessionId?: Types.ObjectId;
  };
  resultRef?: {
    analysisId?: Types.ObjectId;
    jdMatchId?: Types.ObjectId;
    generatedResumeId?: Types.ObjectId;
  };
  artifact?: {
    fileName: string;
    mimeType: string;
    contentBase64: string;
  };
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const resumeJobSchema = new Schema<IResumeJob>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    jobType: {
      type: String,
      enum: ["resume-analysis", "jd-match", "builder-export", "jd-match-export"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed"],
      default: "queued",
      index: true,
    },
    inputRef: {
      resumeId: { type: Schema.Types.ObjectId, ref: "Resume" },
      sessionId: { type: Schema.Types.ObjectId, ref: "GeneratedResume" },
    },
    resultRef: {
      analysisId: { type: Schema.Types.ObjectId, ref: "ResumeAnalysis" },
      jdMatchId: { type: Schema.Types.ObjectId, ref: "JdMatch" },
      generatedResumeId: { type: Schema.Types.ObjectId, ref: "GeneratedResume" },
    },
    artifact: {
      fileName: { type: String },
      mimeType: { type: String },
      contentBase64: { type: String },
    },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

resumeJobSchema.index({ userId: 1, createdAt: -1 });

export const ResumeJob = model<IResumeJob>("ResumeJob", resumeJobSchema);
