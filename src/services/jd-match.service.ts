import { MatchSchema, OptimizedBulletsSchema } from "../validators/resume.validator";
import { invokeStructuredLLMWithFallback, invokeLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { JdMatch } from "../models/jd-match.model";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createModuleLogger } from "../lib/logger";
import { Types } from "mongoose";
import { NotFoundError } from "../lib/errors";
import { resumeFileParserService } from "./resume-file-parser.service";

const logger = createModuleLogger("jd-match-service");



export class JdMatchService {
  async parseJdFile(filePath: string, fileType: string): Promise<string> {
    return resumeFileParserService.parse(filePath, fileType);
  }

  async match(userId: string, resumeId: string, resumeText: string, jobDescription: string, shouldUpdateEntireResume: boolean) {
    logger.info({ userId, resumeId }, "Starting JD match analysis");

    // Call 1: Analysis
    const matchAnalysis = await invokeStructuredLLMWithFallback(
      MatchSchema,
      [
        new SystemMessage("You are an expert recruiter. Analyze how well this resume matches the job description. IMPORTANT: You must provide a 'jobTitle' and 'company' name from the JD. If they are not found, use 'Not specified'."),
        new HumanMessage(`Job Description:\n${jobDescription}\n\nResume:\n${resumeText}`),
      ],
      { timeout: 90000 }
    );

    // Call 2: Rewrite (Conditional)
    let updatedSections = null;
    if (shouldUpdateEntireResume) {
      updatedSections = await this.rewriteEntireResume(resumeText, jobDescription);
    } else {
      updatedSections = await this.rewriteBulletPoints(resumeText, jobDescription);
    }

    const savedMatch = await JdMatch.create({
      userId: new Types.ObjectId(userId),
      resumeId: new Types.ObjectId(resumeId),
      resumeText,
      jobDescription,
      ...matchAnalysis,
      updatedResumeSections: updatedSections,
      shouldUpdateEntireResume,
    });

    return savedMatch;
  }

  private async rewriteEntireResume(resumeText: string, jobDescription: string) {
    const prompt = `
      You are a professional resume writer. Rewrite the entire resume text provided below to best match the job description.
      Maintain the user's actual experience and facts, but optimize the phrasing, emphasis, and skills to align with the JD.
      Ensure it remains professional and honest.
      Return the full rewritten resume text.
    `.trim();

    return await invokeLLMWithFallback(
      [
        new SystemMessage(prompt),
        new HumanMessage(`Job Description:\n${jobDescription}\n\nOriginal Resume:\n${resumeText}`),
      ],
      { timeout: 60000 }
    );
  }

  private async rewriteBulletPoints(resumeText: string, jobDescription: string) {
    const prompt = `
      You are a professional resume writer. Identify the 5-7 most impactful bullet points in the provided resume that could be improved to match the job description.
      Rewrite them to be more relevant while staying true to the user's experience.
      Return the result as a JSON object with an 'optimizedBullets' array.
    `.trim();

    const result = await invokeStructuredLLMWithFallback(
      OptimizedBulletsSchema,
      [
        new SystemMessage(prompt),
        new HumanMessage(`Job Description:\n${jobDescription}\n\nResume:\n${resumeText}`),
      ],
      { timeout: 90000 }
    );

    return result.optimizedBullets.map((bullet) => ({
      original: bullet.original,
      improved: bullet.improved,
    }));
  }

  async getMatchById(id: string, userId: string) {
    const match = await JdMatch.findOne({ _id: id, userId });
    if (!match) throw new NotFoundError("Match analysis not found");
    return match;
  }

  async getUserMatches(userId: string) {
    return JdMatch.find({ userId })
      .select("jobTitle company matchScore createdAt")
      .sort({ createdAt: -1 });
  }
}

export const jdMatchService = new JdMatchService();
