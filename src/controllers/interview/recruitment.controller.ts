import { Request, Response } from "express";
import { Interview } from "../../models/interview.model";
import { User } from "../../models/user.model";
import { InterviewInvite } from "../../models/interview-invite.model";
import { RecruitmentJob } from "../../models/recruitment-job.model";
import {
  createAccessToken,
  createRefreshToken,
} from "../../services/token.service";
import { asyncHandler } from "../../lib/asyncHandler";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";
import { resumeFileParserService } from "../../services/resume-file-parser.service";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../config/env";
import { uploadInterviewVideo } from "../../providers/cloudinary.provider";

const getCookieOptions = (req: Request, maxAge: number) => {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    path: "/",
    maxAge,
    secure: isProd,
    sameSite: "lax" as const,
    domain: isProd ? env.COOKIE_DOMAIN || ".interviewai.in.net" : undefined,
  };
};

function setAuthCookies(
  res: Response,
  req: Request,
  accessToken: string,
  refreshToken: string,
) {
  res.cookie(
    "refreshToken",
    refreshToken,
    getCookieOptions(req, 7 * 24 * 60 * 60 * 1000),
  );
  res.cookie(
    "accessToken",
    accessToken,
    getCookieOptions(req, 1 * 60 * 60 * 1000),
  );
}

// Schedule Interview (Employer only)
export const scheduleInterview = asyncHandler(
  async (req: Request, res: Response) => {
    const employer = (req as AuthenticatedRequest).user;
    if (
      !employer ||
      (employer.role !== "employer" && employer.role !== "admin")
    ) {
      throw new ForbiddenError("Only employers can schedule interviews");
    }

    const {
      candidateName,
      candidateEmail,
      scheduledStart,
      scheduledEnd,
      jobId,
    } = req.body;

    if (!candidateName || !candidateEmail || !scheduledStart || !scheduledEnd) {
      throw new ValidationError("Missing candidate details or schedule time");
    }

    if (!jobId) {
      throw new ValidationError("Job selection is required");
    }

    const job = await RecruitmentJob.findById(jobId);
    if (!job) {
      throw new NotFoundError("Recruitment job not found");
    }

    const jobDetails = {
      jobTitle: job.title,
      company: job.company,
      interviewType: job.interviewType,
      difficultyLevel: job.difficultyLevel,
      duration: job.duration,
      numberOfQuestions: job.numberOfQuestions,
      customTopics: job.customTopics,
      jobDescription: job.description,
      companyStyle: job.companyStyle,
    };

    if (!req.file) {
      throw new ValidationError("Candidate resume file is required");
    }

    let parsedResumeText = "";
    try {
      parsedResumeText = await resumeFileParserService.parse(
        req.file.path,
        req.file.mimetype,
      );
    } catch (err: any) {
      throw new ValidationError(
        `Failed to parse candidate resume: ${err.message || err}`,
      );
    }

    // Find or create candidate User
    let candidate = await User.findOne({ email: candidateEmail.toLowerCase() });
    if (!candidate) {
      candidate = await User.create({
        email: candidateEmail.toLowerCase(),
        name: candidateName,
        passwordHash: crypto.randomBytes(32).toString("hex"), // dummy password
        role: "candidate",
        isEmailVerified: true,
      });
    }

    // Create Interview
    const interview = await Interview.create({
      userId: candidate._id,
      employerId: employer.id,
      candidateName,
      candidateEmail: candidateEmail.toLowerCase(),
      interviewType: jobDetails.interviewType,
      difficultyLevel: jobDetails.difficultyLevel,
      numberOfQuestions: jobDetails.numberOfQuestions,
      duration: jobDetails.duration,
      jobTitle: jobDetails.jobTitle,
      company: jobDetails.company,
      customTopics: jobDetails.customTopics,
      jobDescription: jobDetails.jobDescription,
      companyStyle: jobDetails.companyStyle,
      recruitmentJobId: jobId,
      status: "not-started",
      resume: parsedResumeText,
    });

    // Create Interview Invite
    const token = crypto.randomBytes(32).toString("hex");
    const invite = await InterviewInvite.create({
      token,
      interviewId: interview._id,
      employerId: employer.id,
      candidateEmail: candidateEmail.toLowerCase(),
      candidateName,
      scheduledStart: new Date(scheduledStart),
      scheduledEnd: new Date(scheduledEnd),
      jobId,
      status: "pending",
    });

    const inviteLink = `${env.FRONTEND_URL}/invite/${token}`;

    return res.status(201).json({
      success: true,
      message: "Interview scheduled successfully",
      data: {
        inviteLink,
        token,
        interviewId: interview._id,
      },
    });
  },
);

//  Get Invite Details (Public)
export const getInviteDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { token } = req.params;
    const invite = await InterviewInvite.findOne({ token }).populate(
      "interviewId",
    );

    if (!invite) {
      throw new NotFoundError("Invitation link not found");
    }

    const interview = invite.interviewId as any;
    const now = new Date();
    const start = new Date(invite.scheduledStart);
    const end = new Date(invite.scheduledEnd);

    // No buffer: let them enter only at the exact start time
    let status: "early" | "active" | "expired" | "completed" = "active";
    if (interview && interview.status === "completed") {
      status = "completed";
    } else if (now < start) {
      status = "early";
    } else if (now > end) {
      status = "expired";
    }

    return res.status(200).json({
      success: true,
      data: {
        status,
        candidateName: invite.candidateName,
        candidateEmail: invite.candidateEmail,
        scheduledStart: invite.scheduledStart,
        scheduledEnd: invite.scheduledEnd,
        jobTitle: interview?.jobTitle || "AI Interview",
        company: interview?.company || "AI Recruitment",
        duration: interview?.duration || 30,
        interviewType: interview?.interviewType || "technical",
        difficultyLevel: interview?.difficultyLevel || "intermediate",
        interviewId: invite.interviewId._id,
        numberOfQuestions: interview?.numberOfQuestions || 5,
        jobId: (invite as any).jobId,
      },
    });
  },
);

//  Start Session / Authenticate Candidate (Public)
export const startInterviewSession = asyncHandler(
  async (req: Request, res: Response) => {
    const { token } = req.params;
    const invite = await InterviewInvite.findOne({ token });

    if (!invite) {
      throw new NotFoundError("Invitation not found");
    }

    const now = new Date();
    const start = new Date(invite.scheduledStart);
    const end = new Date(invite.scheduledEnd);
    if (now < start) {
      throw new ValidationError(
        "It is too early to start this interview session",
      );
    }
    if (now > end) {
      throw new ValidationError("This interview session window has closed");
    }

    // Find candidate User to generate tokens
    const candidate = await User.findOne({ email: invite.candidateEmail });
    if (!candidate) {
      throw new NotFoundError("Candidate account not found");
    }

    const accessToken = createAccessToken(
      candidate.id,
      "candidate",
      candidate.tokenVersion || 0,
    );

    const isProd = env.NODE_ENV === "production";
    const sessionCookieOptions = {
      httpOnly: true,
      path: "/",
      secure: isProd,
      sameSite: "lax" as const,
      domain: isProd ? env.COOKIE_DOMAIN || ".interviewai.in.net" : undefined,
    };

    res.cookie("accessToken", accessToken, sessionCookieOptions);
    res.clearCookie("refreshToken", { ...sessionCookieOptions, path: "/" });

    if (invite.status === "pending") {
      invite.status = "activated";
      await invite.save();
    }

    return res.status(200).json({
      success: true,
      message: "Candidate authenticated successfully",
      data: {
        interviewId: invite.interviewId,
      },
    });
  },
);

// Upload Webcam Snapshot (Authenticated Candidate only)
export const uploadSnapshot = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { image, trigger } = req.body; // base64 JPEG format e.g. "data:image/jpeg;base64,..."

    if (!image) {
      throw new ValidationError("No image data provided");
    }

    const interview = await Interview.findById(id);
    if (!interview) {
      throw new NotFoundError("Interview not found");
    }

    // Save base64 image to filesystem
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const uploadDir = path.join(__dirname, "../../../../uploads/snapshots", id);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `${timestamp}-${trigger || "snapshot"}.jpg`;
    const filePath = path.join(uploadDir, filename);

    fs.writeFileSync(filePath, buffer);

    // Append to snapshots array in DB
    interview.snapshots.push({
      timestamp: new Date(timestamp),
      filename,
      trigger: trigger || "random",
    });

    await interview.save();

    return res.status(200).json({
      success: true,
      message: "Snapshot uploaded successfully",
      data: {
        filename,
        timestamp,
      },
    });
  },
);

// Add Proctor Log (Authenticated Candidate only)
export const addProctorLog = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { event, details } = req.body;

    if (!event || !details) {
      throw new ValidationError("Missing event or details parameters");
    }

    const interview = await Interview.findById(id);
    if (!interview) {
      throw new NotFoundError("Interview not found");
    }

    interview.proctoringLogs.push({
      timestamp: new Date(),
      event,
      details,
    });

    await interview.save();

    return res.status(200).json({
      success: true,
      message: "Proctor log added",
    });
  },
);

// Stream Snapshot Securely (Employer only)
export const streamSnapshot = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const { id, filename } = req.params;

    const interview = await Interview.findById(id);
    if (!interview) {
      throw new NotFoundError("Interview not found");
    }

    // Security check: Only the employer who scheduled it or an admin can access snapshots
    if (
      !user ||
      (user.role !== "admin" && interview.employerId?.toString() !== user.id)
    ) {
      throw new ForbiddenError("Unauthorized to view this snapshot");
    }

    const filePath = path.join(
      __dirname,
      "../../../../uploads/snapshots",
      id,
      filename,
    );
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError("Snapshot file not found");
    }

    res.sendFile(filePath);
  },
);

//  List Employer Invites (Employer only)
export const listEmployerInvites = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || (user.role !== "employer" && user.role !== "admin")) {
      throw new ForbiddenError("Only employers can list invites");
    }

    const invites = await InterviewInvite.find({ employerId: user.id })
      .populate("interviewId")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: invites,
    });
  },
);

// Upload Interview Video (Authenticated Candidate/User only)
export const uploadVideo = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    throw new ValidationError("No video file uploaded");
  }

  const interview = await Interview.findById(id);
  if (!interview) {
    throw new NotFoundError("Interview not found");
  }

  // Upload buffer to Cloudinary in WebM format
  const filename = `interview-${id}-${Date.now()}.webm`;
  const videoUrl = await uploadInterviewVideo(file.buffer, filename);

  // Save secure URL to interview
  interview.videoFilename = videoUrl;
  await interview.save();

  return res.status(200).json({
    success: true,
    message: "Video uploaded successfully",
    data: {
      videoUrl,
    },
  });
});

// Stream/Get Interview Video URL (Employer only)
export const streamVideo = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const interview = await Interview.findById(id);
  if (!interview) {
    throw new NotFoundError("Interview not found");
  }

  // Security check: Only the employer who scheduled it or an admin can access
  if (
    !user ||
    (user.role !== "admin" && interview.employerId?.toString() !== user.id)
  ) {
    throw new ForbiddenError("Unauthorized to view this interview video");
  }

  if (!interview.videoFilename) {
    throw new NotFoundError("No video recorded for this interview");
  }

  return res.status(200).json({
    success: true,
    videoUrl: interview.videoFilename,
  });
});
