import { createLLM, createFallbackLLM, LLMOptions } from "./llm";
import { createModuleLogger } from "./logger";
import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

const logger = createModuleLogger("llm-fallback");

import { BaseMessage } from "@langchain/core/messages";

// Wraps LLM invocation but returns the full Message object (for tool calls)
export async function invokeLLMMessageWithFallback(
  messages: any[],
  options: LLMOptions = {}
): Promise<BaseMessage> {
  let primary = createLLM(options);
  if (options.tools && options.tools.length > 0) {
    primary = (primary as any).bindTools(options.tools, { strict: true });
  }
  
  try {
    return await primary.invoke(messages);
  } catch (primaryError) {
    logger.warn({ err: primaryError }, "Primary LLM failed, trying fallback...");
    
    let fallback = createFallbackLLM(options);
    if (!fallback) {
      throw primaryError;
    }
    
    let activeFallback: any = fallback;
    if (options.tools && options.tools.length > 0) {
      activeFallback = (fallback as any).bindTools(options.tools);
    }
    
    try {
      return await activeFallback.invoke(messages);
    } catch (fallbackError) {
      logger.error({ primaryError, fallbackError }, "Both LLMs failed");
      throw new Error("AI service temporarily unavailable.");
    }
  }
}

export async function invokeLLMWithFallback(
  messages: any[],
  options: LLMOptions = {}
): Promise<string> {
  const response = await invokeLLMMessageWithFallback(messages, options);
  return response.content as string;
}

export async function invokeStructuredLLMWithFallback<T extends z.ZodTypeAny>(
  schema: T,
  messages: any[],
  options: LLMOptions = {}
): Promise<z.infer<T>> {
  let primaryModel = createLLM(options);
  if (options.tools && options.tools.length > 0) {
    primaryModel = (primaryModel as any).bindTools(options.tools, { strict: true });
  }
  const primary = primaryModel.withStructuredOutput(schema); // Removed strict: true for compatibility
  
  try {
    return await primary.invoke(messages) as any;
  } catch (primaryError) {
    logger.warn({ err: primaryError }, "Primary structured LLM failed, trying fallback...");

    let fallbackModel = createFallbackLLM(options);
    if (!fallbackModel) throw primaryError;

    let activeFallbackModel: any = fallbackModel;
    if (options.tools && options.tools.length > 0) {
      activeFallbackModel = (fallbackModel as any).bindTools(options.tools); // No strict for fallback
    }

    try {
      const fallback = activeFallbackModel.withStructuredOutput(schema);
      return await fallback.invoke(messages) as any;
    } catch (fallbackError) {
      logger.error({ primaryError, fallbackError }, "Both structured LLMs failed");
      throw new Error("AI analysis service temporarily unavailable.");
    }
  }
}

