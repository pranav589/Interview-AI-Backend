import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("llm");

export interface LLMOptions {
  jsonMode?: boolean;
  timeout?: number;
  maxRetries?: number;
  tools?: any[];
  maxTokens?: number;
  traceName?: string;
  userId?: string;
}

export function createLLM(options: LLMOptions = {}) {
  const {
    jsonMode = false,
    timeout = 120000,
    maxRetries = 2,
    maxTokens = 16384,
  } = options;

  return new ChatOpenAI({
    model: "openrouter/free",
    apiKey: env.OPENROUTER_API_KEY,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    timeout,
    maxRetries,
    maxTokens,
    ...(jsonMode && {
      modelKwargs: { response_format: { type: "json_object" } },
    }),
  });

  /*
  // NVIDIA DeepSeek Configuration
  return new ChatOpenAI({
    model: "deepseek-ai/deepseek-v4-pro",
    apiKey: env.NVIDIA_API_KEY,
    configuration: { baseURL: "https://integrate.api.nvidia.com/v1" },
    timeout,
    maxRetries,
    maxTokens,
    temperature: 1,
    topP: 0.95,
    callbacks,
    ...(jsonMode && {
      modelKwargs: { 
        response_format: { type: "json_object" },
      },
    }),
    ...(!jsonMode && {
      modelKwargs: { 
        chat_template_kwargs: { thinking: false }
      }
    })
  });
  */
}

export function createFallbackLLM(options: LLMOptions = {}) {
  const {
    jsonMode = false,
    timeout = 60000,
    maxRetries = 1,
    maxTokens = 4096,
  } = options;

  // Only create if Groq API key is available
  if (!env.GROQ_API_KEY) {
    logger.warn("No GROQ_API_KEY set — fallback LLM (Groq) unavailable");
    return null;
  }

  return new ChatOpenAI({
    model: "llama-3.3-70b-versatile",
    apiKey: env.GROQ_API_KEY,
    configuration: { baseURL: "https://api.groq.com/openai/v1" },
    timeout,
    maxRetries,
    maxTokens,
    ...(jsonMode && {
      modelKwargs: { response_format: { type: "json_object" } },
    }),
  });
}
