import { createLLM, createFallbackLLM, LLMOptions } from "./llm.provider";
import { createModuleLogger } from "../lib/logger";
import { z } from "zod";
import { MESSAGES } from "../config/constants";

const logger = createModuleLogger("llm-fallback");

import { BaseMessage } from "@langchain/core/messages";

// Wraps LLM invocation but returns the full Message object (for tool calls)
export async function invokeLLMMessageWithFallback(
  messages: any[],
  options: LLMOptions = {},
): Promise<BaseMessage> {
  const tags = options.userId ? [options.userId] : undefined;
  const metadata = options.userId ? { userId: options.userId } : undefined;

  let primary = createLLM(options);
  if (options.tools && options.tools.length > 0) {
    primary = (primary as any).bindTools(options.tools, { strict: true });
  }

  try {
    const result = await primary.invoke(messages, { 
      runName: options.traceName ? `${options.traceName} (Primary)` : undefined,
      tags,
      metadata,
    });
    return result;
  } catch (primaryError) {
    logger.warn(
      { err: primaryError },
      "Primary LLM failed, trying fallback...",
    );

    let fallback = createFallbackLLM(options);
    if (!fallback) {
      throw primaryError;
    }

    let activeFallback: any = fallback;
    if (options.tools && options.tools.length > 0) {
      activeFallback = (fallback as any).bindTools(options.tools);
    }

    try {
      const result = await activeFallback.invoke(messages, { 
        runName: options.traceName ? `${options.traceName} (Fallback)` : undefined,
        tags,
        metadata,
      });
      return result;
    } catch (fallbackError) {
      logger.error({ primaryError, fallbackError }, "Both LLMs failed");
      throw new Error(MESSAGES.AI.UNAVAILABLE);
    }
  }
}

export async function invokeLLMWithFallback(
  messages: any[],
  options: LLMOptions = {},
): Promise<string> {
  const response = await invokeLLMMessageWithFallback(messages, options);
  return response.content as string;
}

export async function invokeStructuredLLMWithFallback<T extends z.ZodTypeAny>(
  schema: T,
  messages: any[],
  options: LLMOptions = {},
): Promise<z.infer<T>> {
  const tags = options.userId ? [options.userId] : undefined;
  const metadata = options.userId ? { userId: options.userId } : undefined;

  let primaryModel = createLLM(options);
  if (options.tools && options.tools.length > 0) {
    primaryModel = (primaryModel as any).bindTools(options.tools, {
      strict: true,
    });
  }
  const primary = primaryModel.withStructuredOutput(schema); // Removed strict: true for compatibility

  try {
    return (await primary.invoke(messages, {
      runName: options.traceName ? `${options.traceName} (Primary)` : undefined,
      tags,
      metadata,
    })) as any;
  } catch (primaryError) {
    logger.warn(
      { err: primaryError },
      "Primary structured LLM failed, trying fallback...",
    );

    let fallbackModel = createFallbackLLM(options);
    if (!fallbackModel) throw primaryError;

    let activeFallbackModel: any = fallbackModel;
    if (options.tools && options.tools.length > 0) {
      activeFallbackModel = (fallbackModel as any).bindTools(options.tools); // No strict for fallback
    }

    try {
      const fallback = activeFallbackModel.withStructuredOutput(schema, {
        method: "functionCalling",
      });
      const result = (await fallback.invoke(messages, { 
        runName: options.traceName ? `${options.traceName} (Fallback)` : undefined,
        tags,
        metadata,
      })) as any;
      return result;
    } catch (fallbackError) {
      logger.error(
        { primaryError, fallbackError },
        "Both structured LLMs failed",
      );
      throw new Error(MESSAGES.AI.ANALYSIS_UNAVAILABLE);
    }
  }
}
