import { Types } from "mongoose";
import { NotFoundError } from "../lib/errors";
import { IInterviewJob, InterviewJob, InterviewJobStatus, InterviewJobType } from "../models/interview-job.model";

type JobInputRef = {
  interviewId?: string;
};

type JobResultRef = {
  feedbackId?: string;
};

export class InterviewJobService {
  async createJob(userId: string, jobType: InterviewJobType, inputRef?: JobInputRef) {
    return InterviewJob.create({
      userId: new Types.ObjectId(userId),
      jobType,
      status: "queued",
      inputRef: this.toObjectIdRef(inputRef),
    });
  }

  async updateStatus(jobId: string, userId: string, status: InterviewJobStatus, payload?: { resultRef?: JobResultRef; error?: string }) {
    const update: any = {
      status,
    };

    if (status === "processing") {
      update.startedAt = new Date();
    }

    if (status === "completed" || status === "failed") {
      update.completedAt = new Date();
    }

    if (payload?.resultRef) {
      update.resultRef = this.toObjectIdRef(payload.resultRef);
    }

    if (payload?.error) {
      update.error = payload.error;
    }

    await InterviewJob.updateOne({ _id: jobId, userId }, { $set: update });
  }

  async getJobById(jobId: string, userId: string): Promise<IInterviewJob> {
    const job = await InterviewJob.findOne({ _id: jobId, userId });
    if (!job) throw new NotFoundError("Job not found");
    return job;
  }

  async findActiveJobForInterview(interviewId: string, userId: string): Promise<IInterviewJob | null> {
    return InterviewJob.findOne({
      userId: new Types.ObjectId(userId),
      "inputRef.interviewId": new Types.ObjectId(interviewId),
      jobType: "feedback-generation",
      status: { $in: ["queued", "processing"] }
    }).sort({ createdAt: -1 });
  }

  private toObjectIdRef(ref?: Record<string, string | undefined>) {
    if (!ref) return undefined;
    return Object.entries(ref).reduce((acc: Record<string, Types.ObjectId>, [key, value]) => {
      if (value) {
        acc[key] = new Types.ObjectId(value);
      }
      return acc;
    }, {});
  }
}

export const interviewJobService = new InterviewJobService();
