import { AnalysisSchema } from "../validators/resume.validator";
import { invokeStructuredLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { ResumeAnalysis } from "../models/resume-analysis.model";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createModuleLogger } from "../lib/logger";
import { Types } from "mongoose";
import { NotFoundError } from "../lib/errors";

const logger = createModuleLogger("resume-analyzer-service");

export class ResumeAnalyzerService {
  async analyze(userId: string, resumeId: string, resumeText: string) {
    logger.info({ userId, resumeId }, "Starting resume analysis");

    const systemPrompt = `
      You are an expert ATS (Applicant Tracking System) and professional resume reviewer.
      Your goal is to provide a detailed, objective analysis of the provided resume text.
      
      Score each section from 0-100 based on:
      - Content quality and impact
      - Formatting and readability
      - Use of action verbs
      - Quantifiable achievements
      
      Provide specific positives and negatives for each section.
      Identify keywords present and those commonly expected but missing for typical roles.
      Give top 3-5 actionable recommendations for improvement.
      
      Return the analysis in the requested JSON format.
    `.trim();

    const analysis = await invokeStructuredLLMWithFallback(
      AnalysisSchema,
      [
        new SystemMessage(systemPrompt),
        new HumanMessage(`Analyze this resume:\n\n${resumeText}`),
      ],
      { timeout: 45000 }
    );

    const savedAnalysis = await ResumeAnalysis.create({
      userId: new Types.ObjectId(userId),
      resumeId: new Types.ObjectId(resumeId),
      resumeText,
      ...analysis,
    });

    return savedAnalysis;
  }

  async getAnalysisById(id: string, userId: string) {
    const analysis = await ResumeAnalysis.findOne({ _id: id, userId });
    if (!analysis) throw new NotFoundError("Analysis not found");
    return analysis;
  }

  async getUserAnalyses(userId: string) {
    return ResumeAnalysis.find({ userId })
      .select("title createdAt atsScore")
      .sort({ createdAt: -1 });
  }
}

export const resumeAnalyzerService = new ResumeAnalyzerService();
