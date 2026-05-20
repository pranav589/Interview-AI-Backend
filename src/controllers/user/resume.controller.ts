import { Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { AuthenticatedRequest } from "../../types/express";
import { resumeService } from "../../services/resume.service";
import { resumeAnalyzerService } from "../../services/resume-analyzer.service";
import { jdMatchService } from "../../services/jd-match.service";
import { resumeBuilderService } from "../../services/resume-builder.service";
import { resumeFileParserService } from "../../services/resume-file-parser.service";
import { pdfExportService } from "../../services/pdf-export.service";
import { notificationService } from "../../services/notification.service";
import { resumeJobService } from "../../services/resume-job.service";
import { AnalysisReportDocument } from "../../services/resume-export.model";
import { GeneratedResume } from "../../models/generated-resume.model";
import { JdMatch } from "../../models/jd-match.model";
import { MESSAGES, CREDITS } from "../../config/constants";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../../lib/errors";
import { isFeatureEnabled } from "../../utils/feature-flags";
import { logger } from "../../lib/logger";
import { resumeTemplateGeneratorService } from "../../services/resume-template-generator.service";

const toSafeString = (value: unknown) =>
  value === null || value === undefined ? "" : String(value).trim();

const normalizeBulletsForExport = (
  updatedResumeSections: unknown,
): Array<{ original: string; improved: string }> => {
  if (!updatedResumeSections) return [];

  if (Array.isArray(updatedResumeSections)) {
    return updatedResumeSections
      .map((item: any) => ({
        original: toSafeString(item?.original),
        improved: toSafeString(item?.improved),
      }))
      .filter((item) => item.original || item.improved);
  }

  if (typeof updatedResumeSections === "object") {
    return Object.entries(updatedResumeSections as Record<string, string>).map(
      ([original, improved]) => ({
        original: toSafeString(original),
        improved: toSafeString(improved),
      }),
    );
  }

  return [];
};

export const uploadResume = asyncHandler(
  async (req: Request, res: Response) => {
    if (!(await isFeatureEnabled("resume_upload_enabled"))) {
      throw new ForbiddenError(MESSAGES.SYSTEM.FEATURE_DISABLED);
    }
    const userId = (req as AuthenticatedRequest).user.id;
    if (!req.file) throw new ValidationError("Resume file is required");

    const name = req.body.name || req.file.originalname;
    const isDefault =
      req.body.isDefault === "true" || req.body.isDefault === true;
    const forceReextract =
      req.body.forceReextract === "true" ||
      req.body.forceReextract === true ||
      req.query.forceReextract === "true";

    const result = await resumeService.uploadResume(
      userId,
      req.file.path,
      req.file.mimetype,
      name,
      isDefault,
      forceReextract,
    );

    return res.json({
      success: true,
      message: result.startedExtraction
        ? "Resume uploaded. Details are being extracted in the background; we'll notify you when it's ready."
        : result.isDuplicate
          ? "This resume already exists."
          : MESSAGES.USER.RESUME.UPLOAD_SUCCESS,
      data: {
        resume: result.resume,
        resumeId: result.resume._id,
        jobId: result.jobId,
        extractionStatus:
          result.extractionStatus || result.resume.extractionStatus,
        isDuplicate: result.isDuplicate,
        startedExtraction: result.startedExtraction,
        requiresConfirmation: result.requiresConfirmation,
      },
    });
  },
);

export const getResumes = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const resumes = await resumeService.getUserResumes(userId);

  return res.json({
    success: true,
    message: MESSAGES.USER.RESUME.FETCH_SUCCESS,
    data: resumes,
  });
});

export const setDefaultResume = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;

    const resume = await resumeService.setDefaultResume(id, userId);

    return res.json({
      success: true,
      message: "Default resume updated",
      data: resume,
    });
  },
);

export const analyzeResume = asyncHandler(
  async (req: Request, res: Response) => {
    if (!(await isFeatureEnabled("resume_analyzer_enabled"))) {
      throw new ForbiddenError(MESSAGES.SYSTEM.FEATURE_DISABLED);
    }
    const userId = (req as AuthenticatedRequest).user.id;
    const { resumeId } = req.body;

    const resume = await resumeService.getResumeById(resumeId, userId);

    if (resume.extractionStatus === "pending" || resume.extractionStatus === "processing") {
      throw new ValidationError(
        "This resume is currently undergoing background details extraction. Please wait for it to complete.",
      );
    }

    /* 
  // Credit Check Logic (Commented out as per request)
  if (req.user.credits < CREDITS.RESUME_ANALYSIS) {
    throw new ValidationError(MESSAGES.SUBSCRIPTION.INSUFFICIENT_CREDITS);
  }
  */

    const job = await resumeJobService.createJob(userId, "resume-analysis", {
      resumeId,
    });

    // Run analysis in background
    resumeAnalyzerService
      .analyze(userId, resumeId, resume.resumeText)
      .then(async (analysis) => {
        await resumeJobService.updateStatus(
          job._id.toString(),
          userId,
          "completed",
          {
            resultRef: { analysisId: analysis._id.toString() },
          },
        );
        await notificationService.createNotification({
          userId,
          type: "success",
          title: "Analysis Complete",
          message: `Your analysis for "${resume.name}" is ready.`,
          link: `/resume/analyzer/${analysis._id}`,
        });
      })
      .catch(async (err) => {
        await resumeJobService.updateStatus(
          job._id.toString(),
          userId,
          "failed",
          {
            error: err?.message || "Resume analysis failed",
          },
        );
        await notificationService.createNotification({
          userId,
          type: "error",
          title: "Analysis Failed",
          message: `We couldn't analyze "${resume.name}". Please try again.`,
        });
      });

    await resumeJobService.updateStatus(
      job._id.toString(),
      userId,
      "processing",
    );

    return res.status(202).json({
      success: true,
      message:
        "Analysis started in background. We'll notify you when it's ready.",
      data: {
        jobId: job._id,
        status: "processing",
      },
    });
  },
);

export const runJdMatch = asyncHandler(async (req: Request, res: Response) => {
  if (!(await isFeatureEnabled("jd_matcher_enabled"))) {
    throw new ForbiddenError(MESSAGES.SYSTEM.FEATURE_DISABLED);
  }
  const userId = (req as AuthenticatedRequest).user.id;
  const { resumeId, shouldUpdateEntireResume } = req.body;
  let { jobDescription } = req.body;

  // If JD is uploaded as a file
  if (req.file) {
    jobDescription = await jdMatchService.parseJdFile(
      req.file.path,
      req.file.mimetype,
    );
  }

  if (!jobDescription)
    throw new ValidationError("Job description (text or file) is required");

  const resume = await resumeService.getResumeById(resumeId, userId);

  if (resume.extractionStatus === "pending" || resume.extractionStatus === "processing") {
    throw new ValidationError(
      "This resume is currently undergoing background details extraction. Please wait for it to complete.",
    );
  }

  /*
  // Credit Check Logic
  if (req.user.credits < CREDITS.JD_MATCH) {
    throw new ValidationError(MESSAGES.SUBSCRIPTION.INSUFFICIENT_CREDITS);
  }
  */

  const job = await resumeJobService.createJob(userId, "jd-match", {
    resumeId,
  });

  // Run JD match in background
  jdMatchService
    .match(
      userId,
      resumeId,
      resume.resumeText,
      jobDescription,
      shouldUpdateEntireResume === "true" || shouldUpdateEntireResume === true,
    )
    .then(async (match) => {
      await resumeJobService.updateStatus(
        job._id.toString(),
        userId,
        "completed",
        {
          resultRef: { jdMatchId: match._id.toString() },
        },
      );
      await notificationService.createNotification({
        userId,
        type: "success",
        title: "JD Match Ready",
        message: `Your match results for "${resume.name}" are ready.`,
        link: `/resume/jd-match/${match._id}`,
      });
    })
    .catch(async (err) => {
      await resumeJobService.updateStatus(
        job._id.toString(),
        userId,
        "failed",
        {
          error: err?.message || "JD match failed",
        },
      );
      await notificationService.createNotification({
        userId,
        type: "error",
        title: "JD Match Failed",
        message: `We couldn't process your JD match for "${resume.name}".`,
      });
    });

  await resumeJobService.updateStatus(job._id.toString(), userId, "processing");

  return res.status(202).json({
    success: true,
    message:
      "JD Matching started in background. We'll notify you when it's ready.",
    data: {
      jobId: job._id,
      status: "processing",
    },
  });
});

export const startBuilder = asyncHandler(
  async (req: Request, res: Response) => {
    if (!(await isFeatureEnabled("resume_builder_enabled"))) {
      throw new ForbiddenError(MESSAGES.SYSTEM.FEATURE_DISABLED);
    }
    const userId = (req as AuthenticatedRequest).user.id;
    const { name, resumeId } = req.body;

    if (resumeId && !req.file) {
      const resume = await resumeService.getResumeById(resumeId, userId);
      const session = await resumeBuilderService.startSessionFromSavedResume(
        userId,
        resume,
      );

      return res.json({
        success: true,
        message: MESSAGES.USER.RESUME.BUILDER_STARTED,
        data: session,
      });
    }

    if (!req.file)
      throw new ValidationError(
        "A resume file or a saved resumeId is required",
      );

    const extractedText = await resumeFileParserService.parse(
      req.file.path,
      req.file.mimetype,
    );

    const sessionName = name || req.file.originalname || "My Resume";

    const { session } = await resumeBuilderService.startSessionInBackground(
      userId,
      sessionName,
      extractedText,
      { fileName: req.file.originalname, fileType: req.file.mimetype },
    );

    const job = await resumeJobService.createJob(userId, "resume-extraction", {
      sessionId: session._id.toString(),
    });

    // Fire-and-forget background extraction
    resumeBuilderService
      .runBackgroundExtraction(
        session._id.toString(),
        userId,
        extractedText,
        job._id.toString(),
      )
      .catch((err) => {
        logger.error(
          { err, sessionId: session._id },
          "Builder background extraction unhandled rejection",
        );
      });

    return res.status(202).json({
      success: true,
      message:
        "Resume uploaded. Extraction is running in the background — we'll notify you when it's ready.",
      data: {
        session,
        sessionId: session._id,
        jobId: job._id,
        extractionStatus: "pending",
      },
    });
  },
);

export const sendBuilderMessage = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { sessionId, message } = req.body;

    const session = await resumeBuilderService.processMessage(
      sessionId,
      userId,
      message,
    );

    return res.json({
      success: true,
      data: session,
    });
  },
);

export const getBuilderSession = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;

    const session = await resumeBuilderService.getSession(id, userId);

    return res.json({
      success: true,
      data: session,
    });
  },
);

export const updateBuilderSession = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;
    const { resumeData, templateId, currentStep } = req.body;

    const session = await resumeBuilderService.updateSession(id, userId, {
      resumeData,
      templateId,
      currentStep,
    });

    return res.json({
      success: true,
      data: session,
    });
  },
);

export const completeBuilderSession = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;

    const session = await resumeBuilderService.completeSession(id, userId);

    return res.json({
      success: true,
      data: session,
    });
  },
);

export const runBuilderCommand = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;
    const {
      command,
      fieldPath,
      selectedText,
      fieldText,
      resumeData,
      targetContext,
    } = req.body;

    const result = await resumeBuilderService.runCommand(id, userId, {
      command,
      fieldPath,
      selectedText,
      fieldText,
      resumeData,
      targetContext,
    });

    return res.json({
      success: true,
      data: result,
    });
  },
);

export const exportResume = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    let { resumeData, templateId, sessionId } = req.body;

    // If sessionId is provided, fetch data from database
    if (sessionId && (!resumeData || Object.keys(resumeData).length === 0)) {
      const session = await GeneratedResume.findOne({ _id: sessionId, userId });
      if (!session) throw new NotFoundError("Resume session not found");
      resumeData = session.resumeData;
      templateId = templateId || session.templateId;
    }

    if (!resumeData)
      throw new ValidationError("Resume data is required for export");
    const exportDate = new Date().toISOString().slice(0, 10);
    const builderFileName = `Resume_Builder_${exportDate}.pdf`;

    const pdfBuffer = await pdfExportService.generateResumePdf(
      resumeData,
      templateId || "modern",
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${builderFileName}`,
    );
    return res.send(pdfBuffer);
  },
);

export const exportJdMatch = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;
    const { templateId } = req.body;

    const match = await JdMatch.findOne({ _id: id, userId });
    if (!match) throw new NotFoundError("Match analysis not found");

    const resume = await resumeService.getResumeById(
      match.resumeId.toString(),
      userId,
    );
    const exportDate = new Date().toISOString().slice(0, 10);

    const sectionedSummary: string[] = [
      `Role: ${toSafeString(match.jobTitle) || "Target role"}`,
      `Company: ${toSafeString(match.company) || "Target company"}`,
      `Match Score: ${toSafeString(match.matchScore)}%`,
      "",
    ];

    let resumeData: any = {
      personalInfo: { name: resume.name },
      summary: "",
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
    };

    if (match.shouldUpdateEntireResume) {
      sectionedSummary.push(
        "Full Rewritten Resume",
        toSafeString(match.updatedResumeSections),
      );
    } else {
      const bullets = normalizeBulletsForExport(match.updatedResumeSections);
      sectionedSummary.push("Optimized Highlights");
      bullets.forEach((item, index) => {
        sectionedSummary.push(`${index + 1}. Improved: ${item.improved}`);
        if (item.original) {
          sectionedSummary.push(`   Original: ${item.original}`);
        }
      });
      sectionedSummary.push(
        "",
        "Original Resume Reference",
        toSafeString(match.resumeText),
      );
    }

    resumeData.summary = sectionedSummary.filter(Boolean).join("\n");
    resumeData.skills = [
      ...(match.matchedKeywords || []),
      ...(match.missingKeywords || []).map((kw: string) => `${kw} (gap)`),
    ];

    const pdfBuffer = await pdfExportService.generateResumePdf(
      resumeData,
      templateId || "modern",
    );

    const fileName = `JD_Rewrite_${(match.jobTitle || resume.name || "Resume").replace(/[^a-zA-Z0-9_-]/g, "_")}_${exportDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    return res.send(pdfBuffer);
  },
);

export const getResumeAnalysis = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;

    const analysis = await resumeAnalyzerService.getAnalysisById(id, userId);

    return res.json({
      success: true,
      data: analysis,
    });
  },
);

export const exportResumeAnalysis = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;

    const analysis = await resumeAnalyzerService.getAnalysisById(id, userId);
    const resume = await resumeService.getResumeById(
      analysis.resumeId.toString(),
      userId,
    );
    const exportDate = new Date().toISOString().slice(0, 10);

    // Map analysis to a structured report document
    const reportData: AnalysisReportDocument = {
      title: `Analysis Report: ${resume.name}`,
      userName: resume.name,
      date: exportDate,
      atsScore: analysis.atsScore,
      overallAssessment:
        analysis.atsScore >= 80
          ? "Exceptional. Your profile is optimized for elite-tier applications."
          : analysis.atsScore >= 60
            ? "Strong. Targeted refinements will maximize your conversion rate."
            : "Needs Work. We've identified critical gaps in your resume structure.",
      sections: {
        contact: analysis.sections.contact,
        summary: analysis.sections.summary,
        experience: analysis.sections.experience,
        education: analysis.sections.education,
        skills: analysis.sections.skills,
        projects: analysis.sections.projects,
        certifications: analysis.sections.certifications,
      },
      topRecommendations: analysis.topRecommendations || [],
      overallPositives: analysis.overallPositives || [],
      overallNegatives: analysis.overallNegatives || [],
      keywordsFound: analysis.keywordsFound || [],
      keywordsMissing: analysis.keywordsMissing || [],
    };

    const pdfBuffer =
      await pdfExportService.generateAnalysisReportPdf(reportData);

    const fileName = `Analysis_Report_${(resume.name || "Resume").replace(/[^a-zA-Z0-9_-]/g, "_")}_${exportDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    return res.send(pdfBuffer);
  },
);

export const getUserAnalyses = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const analyses = await resumeAnalyzerService.getUserAnalyses(userId);

    return res.json({
      success: true,
      data: analyses,
    });
  },
);

export const getJdMatch = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const { id } = req.params;

  const match = await jdMatchService.getMatchById(id, userId);

  return res.json({
    success: true,
    data: match,
  });
});

export const getUserJdMatches = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const matches = await jdMatchService.getUserMatches(userId);

    return res.json({
      success: true,
      data: matches,
    });
  },
);

export const getResumeJob = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;
    const job = await resumeJobService.getJobById(id, userId);

    return res.json({
      success: true,
      data: job,
    });
  },
);

export const downloadResumeJobArtifact = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id } = req.params;
    const job = await resumeJobService.getJobById(id, userId);

    if (job.status !== "completed") {
      throw new ValidationError("Job is not completed yet");
    }

    if (!job.artifact?.contentBase64 || !job.artifact.mimeType) {
      throw new NotFoundError("No downloadable artifact found for this job");
    }

    const fileBuffer = Buffer.from(job.artifact.contentBase64, "base64");
    res.setHeader("Content-Type", job.artifact.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${job.artifact.fileName || "resume.pdf"}`,
    );
    return res.send(fileBuffer);
  },
);

export const generateTemplates = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { sessionId } = req.body;

    await resumeBuilderService.generateTemplates(sessionId, userId);

    return res.json({
      success: true,
      data: {
        templates: [
          {
            id: "modern",
            name: "Modern Template",
            description: "Sleek, two-column layout with blue accents.",
          },
          {
            id: "classic",
            name: "Classic Template",
            description: "Conservative, single-column serif design.",
          },
          {
            id: "executive",
            name: "Executive Template",
            description: "High-density layout with charcoal sidebar.",
          },
        ],
      },
    });
  },
);

export const previewTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id: sessionId, template: templateId } = req.params;

    const buffer = await resumeBuilderService.getTemplateBuffer(
      sessionId,
      userId,
      templateId,
      "pdf",
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    return res.send(buffer);
  },
);

export const downloadTemplate = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user.id;
    const { id: sessionId, template: templateId } = req.params;
    const format = (req.query.format as "pdf" | "docx") || "pdf";

    const buffer = await resumeBuilderService.getTemplateBuffer(
      sessionId,
      userId,
      templateId,
      format,
    );

    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const extension = format === "pdf" ? "pdf" : "docx";
    const fileName = `Resume_${templateId}_${new Date().getTime()}.${extension}`;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    return res.send(buffer);
  },
);
