import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { env } from "../config/env";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("llm");

export interface LLMOptions {
  jsonMode?: boolean;   // force JSON response format
  timeout?: number;     // ms, default 30000
  maxRetries?: number;  // default 2
}

export function createLLM(options: LLMOptions = {}) {
  const { jsonMode = false, timeout = 30000, maxRetries = 2 } = options;

  return new ChatOpenAI({
    model: "openai/gpt-4o-mini",
    apiKey: env.OPENROUTER_API_KEY,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    timeout,
    maxRetries,
    ...(jsonMode && { modelKwargs: { response_format: { type: "json_object" } } }),
  });
}

export function createFallbackLLM(options: LLMOptions = {}) {
  const { jsonMode = false, timeout = 30000, maxRetries = 1 } = options;
  
  // Only create if Google API key is available
  if (!env.GOOGLE_API_KEY) {
    logger.warn("No GOOGLE_API_KEY set — fallback LLM unavailable");
    return null;
  }

  return new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    apiKey: env.GOOGLE_API_KEY,
    maxRetries,
    ...(jsonMode && { modelKwargs: { response_format: { type: "json_object" } } }),
  });
}
