import { createLLM, createFallbackLLM, LLMOptions } from "./llm";
import { createModuleLogger } from "./logger";
import { z } from "zod";

const logger = createModuleLogger("llm-fallback");

// Wraps LLM invocation with primary → fallback → error pattern
export async function invokeLLMWithFallback(
  messages: any[],
  options: LLMOptions = {}
): Promise<string> {
  const primary = createLLM(options);
  
  try {
    const response = await primary.invoke(messages);
    return response.content as string;
  } catch (primaryError) {
    logger.warn({ err: primaryError }, "Primary LLM failed, trying fallback...");
    
    const fallback = createFallbackLLM(options);
    if (!fallback) {
      throw primaryError; // No fallback available, rethrow
    }
    
    try {
      const response = await fallback.invoke(messages);
      return response.content as string;
    } catch (fallbackError) {
      logger.error({ primaryError, fallbackError }, "Both LLMs failed");
      throw new Error("AI service temporarily unavailable. Please try again.");
    }
  }
}

export async function invokeStructuredLLMWithFallback<T extends z.ZodTypeAny>(
  schema: T,
  messages: any[],
  options: LLMOptions = {}
): Promise<z.infer<T>> {
  const primary = createLLM(options).withStructuredOutput(schema);

  try {
    return await primary.invoke(messages) as any;
  } catch (primaryError) {
    logger.warn({ err: primaryError }, "Primary structured LLM failed, trying fallback...");

    const fallbackModel = createFallbackLLM(options);
    if (!fallbackModel) throw primaryError;

    try {
      const fallback = fallbackModel.withStructuredOutput(schema);
      return await fallback.invoke(messages) as any;
    } catch (fallbackError) {
      logger.error({ primaryError, fallbackError }, "Both structured LLMs failed");
      throw new Error("AI analysis service temporarily unavailable.");
    }
  }
}
