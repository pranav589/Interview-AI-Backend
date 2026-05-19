import { Types } from "mongoose";
import { NotFoundError } from "../lib/errors";
import { IResumeJob, ResumeJob, ResumeJobStatus, ResumeJobType } from "../models/resume-job.model";

type JobInputRef = {
  resumeId?: string;
  sessionId?: string;
};

type JobResultRef = {
  analysisId?: string;
  jdMatchId?: string;
  generatedResumeId?: string;
};

export class ResumeJobService {
  async createJob(userId: string, jobType: ResumeJobType, inputRef?: JobInputRef) {
    return ResumeJob.create({
      userId: new Types.ObjectId(userId),
      jobType,
      status: "queued",
      inputRef: this.toObjectIdRef(inputRef),
    });
  }

  async updateStatus(jobId: string, userId: string, status: ResumeJobStatus, payload?: { resultRef?: JobResultRef; error?: string }) {
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

    await ResumeJob.updateOne({ _id: jobId, userId }, { $set: update });
  }

  async attachArtifact(jobId: string, userId: string, artifact: { fileName: string; mimeType: string; contentBase64: string }) {
    await ResumeJob.updateOne({ _id: jobId, userId }, { $set: { artifact } });
  }

  async getLatestJobForResume(userId: string, jobType: ResumeJobType, resumeId: string): Promise<IResumeJob | null> {
    return ResumeJob.findOne({
      userId,
      jobType,
      "inputRef.resumeId": new Types.ObjectId(resumeId),
    }).sort({ createdAt: -1 });
  }

  async getJobById(jobId: string, userId: string): Promise<IResumeJob> {
    const job = await ResumeJob.findOne({ _id: jobId, userId });
    if (!job) throw new NotFoundError("Job not found");
    return job;
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

export const resumeJobService = new ResumeJobService();
