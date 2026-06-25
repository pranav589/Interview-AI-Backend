import { Request, Response } from "express";
import { RecruitmentJob } from "../../models/recruitment-job.model";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError, NotFoundError, ForbiddenError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { resumeFileParserService } from "../../services/resume-file-parser.service";
import { z } from "zod";

const createJobSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  company: z.string().min(2, "Company must be at least 2 characters"),
  description: z.string().optional().default(""),
  interviewType: z.enum(["technical", "behavioral", "mixed"]).default("technical"),
  difficultyLevel: z.enum(["junior", "intermediate", "senior"]).default("intermediate"),
  duration: z.coerce.number().min(5).max(180).default(30),
  numberOfQuestions: z.coerce.number().min(1).max(50).default(5),
  customTopics: z.string().optional().default(""),
  companyStyle: z.string().optional().default(""),
});

const updateJobSchema = createJobSchema.partial().extend({
  status: z.enum(["active", "archived"]).optional(),
});

// Create Job (Employer/Admin only)
export const createJob = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user || (user.role !== "employer" && user.role !== "admin")) {
    throw new ForbiddenError("Only employers can create job postings");
  }

  const result = createJobSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0].message);
  }

  // Parse question bank file if uploaded
  let questionBankText = "";
  let questionBankFilename = "";
  if (req.file) {
    try {
      questionBankText = await resumeFileParserService.parse(req.file.path, req.file.mimetype);
      questionBankFilename = req.file.originalname;
    } catch (err: any) {
      throw new ValidationError(`Failed to parse question bank file: ${err.message || err}`);
    }
  }

  const job = await RecruitmentJob.create({
    ...result.data,
    employerId: user.id,
    questionBankText,
    questionBankFilename,
    status: "active",
  });

  return res.status(201).json({
    success: true,
    message: "Job opening created successfully",
    data: job,
  });
});

// List Jobs (Employer/Admin only)
export const listJobs = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user || (user.role !== "employer" && user.role !== "admin")) {
    throw new ForbiddenError("Only employers can view job postings list");
  }

  const jobs = await RecruitmentJob.find({
    employerId: user.id,
    status: "active",
  }).sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    data: jobs,
  });
});

// Get Job Details (Employer/Admin only)
export const getJobDetails = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  if (!user || (user.role !== "employer" && user.role !== "admin")) {
    throw new ForbiddenError("Only employers can view job details");
  }

  const job = await RecruitmentJob.findOne({
    _id: id,
    employerId: user.id,
  });

  if (!job) {
    throw new NotFoundError("Job opening not found");
  }

  return res.status(200).json({
    success: true,
    data: job,
  });
});

// Update Job (Employer/Admin only)
export const updateJob = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  if (!user || (user.role !== "employer" && user.role !== "admin")) {
    throw new ForbiddenError("Only employers can modify job postings");
  }

  const result = updateJobSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0].message);
  }

  const updateData: any = { ...result.data };

  // Parse question bank file if uploaded
  if (req.file) {
    try {
      updateData.questionBankText = await resumeFileParserService.parse(req.file.path, req.file.mimetype);
      updateData.questionBankFilename = req.file.originalname;
    } catch (err: any) {
      throw new ValidationError(`Failed to parse question bank file: ${err.message || err}`);
    }
  }

  const job = await RecruitmentJob.findOneAndUpdate(
    { _id: id, employerId: user.id },
    { $set: updateData },
    { new: true }
  );

  if (!job) {
    throw new NotFoundError("Job opening not found or unauthorized");
  }

  return res.status(200).json({
    success: true,
    message: "Job opening updated successfully",
    data: job,
  });
});
