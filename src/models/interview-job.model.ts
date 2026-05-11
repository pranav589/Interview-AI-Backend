import { Schema, model, Document, Types } from "mongoose";

export type InterviewJobType = "feedback-generation";
export type InterviewJobStatus = "queued" | "processing" | "completed" | "failed";

export interface IInterviewJob extends Document {
  userId: Types.ObjectId;
  jobType: InterviewJobType;
  status: InterviewJobStatus;
  inputRef?: {
    interviewId?: Types.ObjectId;
  };
  resultRef?: {
    feedbackId?: Types.ObjectId;
  };
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const interviewJobSchema = new Schema<IInterviewJob>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    jobType: {
      type: String,
      enum: ["feedback-generation"],
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
      interviewId: { type: Schema.Types.ObjectId, ref: "Interview" },
    },
    resultRef: {
      feedbackId: { type: Schema.Types.ObjectId, ref: "Feedback" },
    },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

interviewJobSchema.index({ userId: 1, createdAt: -1 });

export const InterviewJob = model<IInterviewJob>("InterviewJob", interviewJobSchema);
