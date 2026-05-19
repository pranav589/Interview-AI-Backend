import { GeneratedResume, IGeneratedResume } from "../models/generated-resume.model";
import { createModuleLogger } from "../lib/logger";
import { Types } from "mongoose";
import { NotFoundError, ValidationError } from "../lib/errors";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { resumeTemplateGeneratorService } from "./resume-template-generator.service";
import { NormalizedResumeDocument, normalizeResumeDocument } from "./resume-export.model";
import { resumeFileParserService } from "./resume-file-parser.service";
import { invokeStructuredLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { z } from "zod";

const logger = createModuleLogger("resume-builder-service");

const IntakeQuestionSchema = z.object({
  id: z.string(),
  category: z.string(),
  question: z.string(),
  resolved: z.boolean().default(false),
});

const ResumeDataSchema = z.object({
  personalInfo: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(z.string()).default([]),
  }).default({ links: [] }),
  summary: z.string().default(""),
  experience: z.array(z.object({
    role: z.string().default(""),
    company: z.string().default(""),
    location: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    bullets: z.array(z.string()).default([]),
  })).default([]),
  education: z.array(z.object({
    degree: z.string().default(""),
    school: z.string().default(""),
    location: z.string().optional(),
    gradDate: z.string().optional(),
    details: z.array(z.string()).default([]),
  })).default([]),
  skills: z.array(z.string()).default([]),
  projects: z.array(z.object({
    name: z.string().default(""),
    description: z.string().optional(),
    bullets: z.array(z.string()).default([]),
  })).default([]),
  certifications: z.array(z.object({
    name: z.string().default(""),
    issuer: z.string().optional(),
    date: z.string().optional(),
  })).default([]),
  languages: z.array(z.string()).default([]),
  awards: z.array(z.union([z.string(), z.any()])).default([]),
});

const IntakeExtractionSchema = z.object({
  resumeData: ResumeDataSchema,
  detectedExperienceYears: z.number().optional(),
  timelineGaps: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  weakBullets: z.array(z.string()).default([]),
  pendingQuestions: z.array(IntakeQuestionSchema).default([]),
});

const IntakeMergeSchema = z.object({
  resumeData: ResumeDataSchema,
  resolvedQuestionId: z.string().optional(),
  detectedExperienceYears: z.number().optional(),
  timelineGaps: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  weakBullets: z.array(z.string()).default([]),
  pendingQuestions: z.array(IntakeQuestionSchema).default([]),
});

const BuilderCommandSchema = z.object({
  replacementText: z.string(),
  explanation: z.string().optional(),
});

const BuilderCommandNameSchema = z.enum(["bullet", "shorten", "expand", "quantify", "tone", "keywords"]);

type IntakeQuestion = z.infer<typeof IntakeQuestionSchema>;
type BuilderCommandName = z.infer<typeof BuilderCommandNameSchema>;

const safeJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const sourceSnapshot = (text: string) => text.slice(0, 12000);
const compactLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export class ResumeBuilderService {
  async startSession(userId: string, name: string, file?: Express.Multer.File) {
    if (!file) throw new ValidationError("Resume or LinkedIn export file is required");

    const extractedText = await resumeFileParserService.parse(file.path, file.mimetype);
    return this.createSessionFromText(userId, name, extractedText, {
      fileName: file.originalname,
      fileType: file.mimetype,
    });
  }

  async startSessionFromSavedResume(
    userId: string,
    resume: {
      name: string;
      resumeText: string;
      _id: unknown;
      extractionStatus?: string;
      resumeData?: any;
      intakeMetadata?: any;
    },
  ) {
    if (!resume.resumeText?.trim()) throw new ValidationError("Saved resume text is empty");

    if (resume.extractionStatus === "processing" || resume.extractionStatus === "pending") {
      throw new ValidationError("This resume is currently being analyzed in the background. Please wait for the extraction to finish.");
    }

    if (resume.extractionStatus === "completed" && resume.resumeData) {
      logger.info({ resumeId: resume._id }, "Using cached structured resume data to start builder session");
      const intake = {
        resumeData: resume.resumeData,
        detectedExperienceYears: resume.intakeMetadata?.detectedExperienceYears,
        timelineGaps: resume.intakeMetadata?.timelineGaps || [],
        missingFields: resume.intakeMetadata?.missingFields || [],
        weakBullets: resume.intakeMetadata?.weakBullets || [],
        pendingQuestions: resume.intakeMetadata?.pendingQuestions || [],
      };
      return this.createSessionFromIntake(userId, resume.name || "Saved Resume", resume.resumeText, {
        fileName: resume.name,
        fileType: "saved-resume",
        resumeId: String(resume._id),
      }, intake);
    }

    return this.createSessionFromText(userId, resume.name || "Saved Resume", resume.resumeText, {
      fileName: resume.name,
      fileType: "saved-resume",
      resumeId: String(resume._id),
    });
  }

  /**
   * Creates a placeholder session immediately and kicks off LLM extraction in the
   * background. Returns the session (with currentStep "extracting") and a jobId so
   * the client can poll for completion.
   */
  async startSessionInBackground(
    userId: string,
    name: string,
    extractedText: string,
    source: { fileName?: string; fileType?: string; resumeId?: string },
  ): Promise<{ session: IGeneratedResume; jobId: string }> {
    // Create a lightweight placeholder session right away
    const session = await GeneratedResume.create({
      userId: new Types.ObjectId(userId),
      name,
      resumeData: {
        personalInfo: {},
        summary: "",
        experience: [],
        education: [],
        skills: [],
        projects: [],
        certifications: [],
        languages: [],
        awards: [],
      },
      chatHistory: [],
      completionMap: {},
      currentStep: "extracting",
      extractionStatus: "pending",
      source: {
        fileName: source.fileName,
        fileType: source.fileType,
        resumeId: source.resumeId,
        extractedText: sourceSnapshot(extractedText),
      },
      status: "in-progress",
    });

    return { session, jobId: "" }; // jobId filled by caller after ResumeJob is created
  }

  /**
   * Runs the LLM intake extraction and updates the session in-place.
   * Called as a fire-and-forget from the controller.
   */
  async runBackgroundExtraction(
    sessionId: string,
    userId: string,
    extractedText: string,
    jobId: string,
  ): Promise<void> {
    const { resumeJobService } = await import("./resume-job.service");
    const { notificationService } = await import("./notification.service");

    logger.info({ sessionId }, "Starting background builder extraction");

    await GeneratedResume.updateOne(
      { _id: sessionId },
      { $set: { extractionStatus: "processing", currentStep: "extracting" } },
    );
    await resumeJobService.updateStatus(jobId, userId, "processing");

    try {
      const intake = await this.extractAndProcessResume(extractedText);

      const firstQuestion = intake.pendingQuestions.find((q: any) => !q.resolved);

      await GeneratedResume.updateOne(
        { _id: sessionId },
        {
          $set: {
            extractionStatus: "completed",
            currentStep: firstQuestion ? "intake_chat" : "review_ready",
            resumeData: intake.resumeData,
            completionMap: this.createCompletionMap(intake.resumeData),
            chatHistory: [
              {
                role: "assistant",
                content: this.createOpeningMessage(intake, firstQuestion?.question),
              },
            ],
            intakeMetadata: {
              detectedExperienceYears: intake.detectedExperienceYears,
              timelineGaps: intake.timelineGaps,
              missingFields: intake.missingFields,
              weakBullets: intake.weakBullets,
              pendingQuestions: intake.pendingQuestions,
            },
          },
        },
      );

      await resumeJobService.updateStatus(jobId, userId, "completed", {
        resultRef: { generatedResumeId: sessionId },
      });

      logger.info({ sessionId }, "Background builder extraction completed");

      await notificationService.createNotification({
        userId,
        type: "success",
        title: "Resume Ready",
        message: "Your resume details have been extracted. Click Continue to open the builder.",
        link: `/resume/builder/session/${sessionId}/continue`,
      });
    } catch (error: any) {
      logger.error({ error, sessionId }, "Background builder extraction failed");

      await GeneratedResume.updateOne(
        { _id: sessionId },
        {
          $set: {
            extractionStatus: "failed",
            extractionError: error?.message || String(error),
            currentStep: "extraction_failed",
          },
        },
      );

      await resumeJobService.updateStatus(jobId, userId, "failed", {
        error: error?.message || "Builder extraction failed",
      });

      await notificationService.createNotification({
        userId,
        type: "error",
        title: "Extraction Failed",
        message: "We couldn't extract your resume details. Please try uploading again.",
      });
    }
  }

  async extractAndProcessResume(extractedText: string) {
    if (!extractedText?.trim()) {
      throw new ValidationError("Extracted resume text is empty");
    }
    const rawIntake = await this.extractIntake(extractedText);
    return this.postProcessIntake(rawIntake, extractedText);
  }

  private async createSessionFromText(
    userId: string,
    name: string,
    extractedText: string,
    source: { fileName?: string; fileType?: string; resumeId?: string },
  ) {
    const intake = this.postProcessIntake(await this.extractIntake(extractedText), extractedText);
    return this.createSessionFromIntake(userId, name, extractedText, source, intake);
  }

  private async createSessionFromIntake(
    userId: string,
    name: string,
    extractedText: string,
    source: { fileName?: string; fileType?: string; resumeId?: string },
    intake: {
      resumeData: any;
      detectedExperienceYears?: number;
      timelineGaps: string[];
      missingFields: string[];
      weakBullets: string[];
      pendingQuestions: any[];
    },
  ) {
    const firstQuestion = intake.pendingQuestions.find((question: IntakeQuestion) => !question.resolved);

    const session = await GeneratedResume.create({
      userId: new Types.ObjectId(userId),
      name,
      resumeData: intake.resumeData,
      chatHistory: [
        {
          role: "assistant",
          content: this.createOpeningMessage(intake, firstQuestion?.question),
        },
      ],
      completionMap: this.createCompletionMap(intake.resumeData),
      currentStep: firstQuestion ? "intake_chat" : "review_ready",
      source: {
        fileName: source.fileName,
        fileType: source.fileType,
        resumeId: source.resumeId,
        extractedText: sourceSnapshot(extractedText),
      },
      intakeMetadata: {
        detectedExperienceYears: intake.detectedExperienceYears,
        timelineGaps: intake.timelineGaps,
        missingFields: intake.missingFields,
        weakBullets: intake.weakBullets,
        pendingQuestions: intake.pendingQuestions,
      },
      status: "in-progress",
    });

    return session;
  }

  async processMessage(sessionId: string, userId: string, message: string) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");

    const activeQuestion = session.intakeMetadata?.pendingQuestions?.find((question) => !question.resolved);
    const merge = await this.mergeIntakeAnswer(session.resumeData, session.intakeMetadata, activeQuestion, message);
    const pendingQuestions = merge.pendingQuestions.map((question: IntakeQuestion) => ({
      ...question,
      resolved: question.id === merge.resolvedQuestionId ? true : question.resolved,
    }));
    const nextQuestion = pendingQuestions.find((question: IntakeQuestion) => !question.resolved);

    session.chatHistory = [
      ...session.chatHistory,
      { role: "user", content: message },
      {
        role: "assistant",
        content: nextQuestion
          ? nextQuestion.question
          : "Great, I have enough to prepare your resume foundation. Review the extracted sections below, and Phase 2 will open this into the side-by-side editor.",
      },
    ];
    session.resumeData = merge.resumeData as any;
    session.intakeMetadata = {
      detectedExperienceYears: merge.detectedExperienceYears ?? session.intakeMetadata?.detectedExperienceYears,
      timelineGaps: merge.timelineGaps,
      missingFields: merge.missingFields,
      weakBullets: merge.weakBullets,
      pendingQuestions,
    };
    session.completionMap = this.createCompletionMap(merge.resumeData);
    session.currentStep = nextQuestion ? "intake_chat" : "review_ready";

    await session.save();
    return session;
  }

  async getSession(sessionId: string, userId: string) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");
    return session;
  }

  async updateSession(
    sessionId: string,
    userId: string,
    updates: { resumeData?: any; templateId?: string; currentStep?: string },
  ) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");

    if (updates.resumeData) {
      session.resumeData = updates.resumeData;
      session.completionMap = this.createCompletionMap(updates.resumeData);
    }
    if (updates.templateId) {
      session.templateId = updates.templateId;
    }
    if (updates.currentStep) {
      session.currentStep = updates.currentStep;
    }

    await session.save();
    return session;
  }

  async completeSession(sessionId: string, userId: string) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");

    session.status = "completed";
    session.currentStep = "completed";
    session.completionMap = this.createCompletionMap(session.resumeData);

    await session.save();
    return session;
  }

  async runCommand(
    sessionId: string,
    userId: string,
    input: {
      command: string;
      fieldPath: string;
      selectedText?: string;
      fieldText: string;
      resumeData: any;
      targetContext?: string;
    },
  ) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");

    const command = BuilderCommandNameSchema.safeParse(input.command);
    if (!command.success) throw new ValidationError("Unsupported builder command");
    if (command.data === "keywords" && !input.targetContext?.trim()) {
      throw new ValidationError("Target role or job description is required for /keywords");
    }

    const textToTransform = (input.selectedText || input.fieldText || "").trim();
    if (!textToTransform) throw new ValidationError("Text is required for command");

    return invokeStructuredLLMWithFallback(
      BuilderCommandSchema,
      [
        new SystemMessage(`
You are an expert resume editor. Transform only the user's provided text for the requested command.
Never invent companies, dates, tools, exact metrics, employers, awards, or outcomes.
If a useful metric is missing, use a bracketed placeholder like [X%], [N users], or [time saved].
Return only replacementText and a short optional explanation.

Command behavior:
- bullet: convert the text into one strong resume bullet without a leading bullet symbol.
- shorten: make the text tighter while preserving meaning.
- expand: add clarity and resume-style detail without inventing facts.
- quantify: make wording metric-ready and use placeholders for unknown numbers.
- tone: make text professional, concise, and ATS-friendly.
- keywords: align wording with the target context while staying honest.
        `.trim()),
        new HumanMessage(`
Command: ${command.data}
Field path: ${input.fieldPath}
Selected text:
${textToTransform}

Full field text:
${input.fieldText || ""}

Target context:
${input.targetContext || ""}

Current resume data:
${safeJson(input.resumeData)}
        `.trim()),
      ],
      { timeout: 60000 },
    );
  }

  async generateTemplates(sessionId: string, userId: string) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== "completed") throw new Error("Resume session is not completed yet");

    const normalizedResume = normalizeResumeDocument(session.resumeData);

    const templates = await resumeTemplateGeneratorService.generateAll(normalizedResume);
    
    // In a real app, we might upload these to S3 and save the URLs.
    // For now, we'll return them. We won't store the large buffers in MongoDB.
    // Instead, the controllers will call this on demand or we cache them in Redis.
    
    return templates;
  }

  async getTemplateBuffer(sessionId: string, userId: string, templateId: string, format: "pdf" | "docx") {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");

    const normalizedResume = normalizeResumeDocument(session.resumeData);

    if (format === "pdf") {
      const { pdfReactRendererService } = await import("./pdf-react-renderer.service");
      return pdfReactRendererService.render(normalizedResume, templateId as any);
    } else {
      const { docxRendererService } = await import("./docx-renderer.service");
      return docxRendererService.render(normalizedResume, templateId as any);
    }
  }

  private async extractIntake(extractedText: string): Promise<z.infer<typeof IntakeExtractionSchema>> {
    try {
      return await invokeStructuredLLMWithFallback(
        IntakeExtractionSchema,
        [
          new SystemMessage(`
You are an expert resume intake interviewer. Parse the uploaded LinkedIn export or resume into structured resume data.
Also audit the profile for only high-value follow-up questions: timeline gaps, missing core fields, weak/vague bullets, or missing metrics.
Ask at most 5 pending questions. Each question must be specific and human, not generic. Do not invent facts.
Use stable lowercase ids like "gap_2024" or "metric_frontend_role".
Important parsing rules:
- Treat links written as "linkedin/name", "linkedIn/name", "github/name", portfolio domains, or full URLs as personalInfo.links.
- Sections titled "PROJECT", "PROJECTS", "PERSONAL PROJECT", or "PERSONAL PROJECTS" must populate projects, not experience.
- Do not treat a project as work experience unless it has an employer/company and employment dates.
- Year-only employment dates are acceptable. Do not ask follow-up questions just because a date has only a year.
- Ongoing dates like "Present" are acceptable and should not be considered timeline gaps.
          `.trim()),
          new HumanMessage(`Uploaded resume text:\n\n${extractedText}`),
        ],
        { timeout: 90000 },
      );
    } catch (err) {
      logger.error({ err }, "Builder intake extraction failed");
      return {
        resumeData: {
          personalInfo: { links: [] },
          summary: "",
          experience: [],
          education: [],
          skills: [],
          projects: [],
          certifications: [],
          languages: [],
          awards: [],
        },
        detectedExperienceYears: undefined,
        timelineGaps: [],
        missingFields: ["structured resume details"],
        weakBullets: [],
        pendingQuestions: [
          {
            id: "intake_summary",
            category: "missing_fields",
            question: "I could read the file text, but I need your help structuring it. What role are you targeting, and what are your most important recent achievements?",
            resolved: false,
          },
        ],
      };
    }
  }

  private async mergeIntakeAnswer(resumeData: any, intakeMetadata: any, activeQuestion: any, message: string) {
    try {
      return await invokeStructuredLLMWithFallback(
        IntakeMergeSchema,
        [
          new SystemMessage(`
You update structured resume intake data using the user's latest answer.
Preserve existing facts. Only add or revise information supported by the user answer.
Mark the active question resolved when the answer addresses it.
Return any remaining high-priority questions, with at most 4 unresolved questions total.
Do not ask broad interview questions; focus on gaps, missing fields, weak bullets, and missing metrics.
          `.trim()),
          new HumanMessage(`
Current resumeData:
${safeJson(resumeData)}

Current intake metadata:
${safeJson(intakeMetadata)}

Active question:
${safeJson(activeQuestion)}

User answer:
${message}
          `.trim()),
        ],
        { timeout: 90000 },
      );
    } catch (err) {
      logger.error({ err }, "Builder intake merge failed");
      const pendingQuestions = (intakeMetadata?.pendingQuestions || []).map((question: any) =>
        question.id === activeQuestion?.id ? { ...question, resolved: true } : question,
      );

      return {
        resumeData,
        resolvedQuestionId: activeQuestion?.id,
        detectedExperienceYears: intakeMetadata?.detectedExperienceYears,
        timelineGaps: intakeMetadata?.timelineGaps || [],
        missingFields: intakeMetadata?.missingFields || [],
        weakBullets: intakeMetadata?.weakBullets || [],
        pendingQuestions,
      };
    }
  }

  private createOpeningMessage(intake: z.infer<typeof IntakeExtractionSchema>, firstQuestion?: string) {
    const facts: string[] = [];
    if (typeof intake.detectedExperienceYears === "number") {
      facts.push(`I've extracted about ${intake.detectedExperienceYears} years of experience.`);
    }
    if (intake.timelineGaps.length) {
      facts.push(`I noticed ${intake.timelineGaps.length} possible timeline gap${intake.timelineGaps.length === 1 ? "" : "s"}.`);
    }
    if (intake.missingFields.length) {
      facts.push(`A few useful details are still missing: ${intake.missingFields.slice(0, 3).join(", ")}.`);
    }
    if (!facts.length) {
      facts.push("I've extracted the main resume sections from your file.");
    }

    return `${facts.join(" ")}\n\n${firstQuestion || "Everything important looks covered for Phase 1. Please review the extracted sections below."}`;
  }

  private createCompletionMap(resumeData: any) {
    return {
      personalInfo: Boolean(resumeData?.personalInfo?.name || resumeData?.personalInfo?.email),
      summary: Boolean(resumeData?.summary),
      experience: Array.isArray(resumeData?.experience) && resumeData.experience.length > 0,
      education: Array.isArray(resumeData?.education) && resumeData.education.length > 0,
      skills: Array.isArray(resumeData?.skills) && resumeData.skills.length > 0,
      projects: Array.isArray(resumeData?.projects) && resumeData.projects.length > 0,
      certifications: Array.isArray(resumeData?.certifications) && resumeData.certifications.length > 0,
    };
  }

  private postProcessIntake(intake: z.infer<typeof IntakeExtractionSchema>, extractedText: string) {
    const resumeData = {
      ...intake.resumeData,
      personalInfo: {
        ...intake.resumeData.personalInfo,
        links: this.mergeUnique([
          ...(intake.resumeData.personalInfo.links || []),
          ...this.extractPersonalLinks(extractedText),
        ]),
      },
    };

    const projectFromSection = this.extractPersonalProject(extractedText);
    if (projectFromSection && !this.hasProject(resumeData.projects, projectFromSection.name)) {
      resumeData.projects = [...(resumeData.projects || []), projectFromSection];
    }

    const projectNames = new Set(
      (resumeData.projects || []).map((project: any) => String(project?.name || "").toLowerCase()),
    );
    resumeData.experience = (resumeData.experience || []).filter((item: any) => {
      const role = String(item?.role || "").toLowerCase();
      const company = String(item?.company || "").toLowerCase();
      const hasDates = Boolean(item?.startDate || item?.endDate);
      if (projectNames.has(role) || projectNames.has(company)) return false;
      if (!hasDates && (role.includes("project") || company.includes("project"))) return false;
      return true;
    });

    const pendingQuestions = (intake.pendingQuestions || []).filter((question) => {
      const text = `${question.category} ${question.question}`.toLowerCase();
      const asksOnlyForDatePrecision = text.includes("date") && (text.includes("month") || text.includes("specific"));
      return !asksOnlyForDatePrecision;
    });

    return {
      ...intake,
      resumeData,
      missingFields: (intake.missingFields || []).filter((field) => !String(field).toLowerCase().includes("month")),
      pendingQuestions,
    };
  }

  private extractPersonalLinks(text: string) {
    const links = new Set<string>();
    const urlMatches = text.match(/https?:\/\/[^\s|)]+/gi) || [];
    urlMatches.forEach((url) => links.add(url.replace(/[.,;]+$/, "")));

    const linkedinMatches = text.match(/\blinked\s*in\/[a-z0-9-_%]+|\blinkedin\/[a-z0-9-_%]+/gi) || [];
    linkedinMatches.forEach((match) => {
      const slug = match.split("/").pop()?.trim();
      if (slug) links.add(`https://www.linkedin.com/in/${slug}`);
    });

    const githubMatches = text.match(/\bgithub\/[a-z0-9-_%]+/gi) || [];
    githubMatches.forEach((match) => {
      const slug = match.split("/").pop()?.trim();
      if (slug) links.add(`https://github.com/${slug}`);
    });

    return [...links];
  }

  private extractPersonalProject(text: string) {
    const lines = compactLines(text);
    const startIndex = lines.findIndex((line) => /^personal projects?$|^projects?$/i.test(line));
    if (startIndex === -1) return null;

    const endIndex = lines.findIndex((line, index) =>
      index > startIndex && /^(skills|education|certifications|awards|languages|work experience|experience)$/i.test(line),
    );
    const section = lines.slice(startIndex + 1, endIndex === -1 ? lines.length : endIndex);
    const name = section.find((line) => !/^[•●-]?$/.test(line));
    if (!name) return null;

    const bullets: string[] = [];
    let currentBullet = "";
    for (const rawLine of section.slice(section.indexOf(name) + 1)) {
      const line = rawLine.replace(/^[•●-]\s*/, "").trim();
      if (!line || /^stack:/i.test(line)) continue;

      const startsNewBullet = /^[A-Z][A-Za-z0-9 /-]{2,60}:\s/.test(line);
      if (startsNewBullet && currentBullet) {
        bullets.push(currentBullet.trim());
        currentBullet = line;
      } else {
        currentBullet = currentBullet ? `${currentBullet} ${line}` : line;
      }
    }
    if (currentBullet) bullets.push(currentBullet.trim());

    const stackLine = section.find((line) => /^stack:/i.test(line));
    return {
      name,
      description: stackLine || undefined,
      bullets,
    };
  }

  private hasProject(projects: any[], name: string) {
    const normalized = name.toLowerCase();
    return (projects || []).some((project) => String(project?.name || "").toLowerCase() === normalized);
  }

  private mergeUnique(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }
}

export const resumeBuilderService = new ResumeBuilderService();
