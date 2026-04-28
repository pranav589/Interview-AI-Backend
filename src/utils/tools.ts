import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { TavilySearch } from "@langchain/tavily";
import { env } from "../config/env";
import { createLLM } from "../lib/llm";
import { createModuleLogger } from "../lib/logger";
import { isFeatureEnabled } from "./feature-flags";

const logger = createModuleLogger("tools");

/**
 * Web Search Tool (Tavily)
 * Used to gather context about specific company interview patterns.
 */
export const createWebSearchTool = () => {
  if (!env.TAVILY_API_KEY) {
    return null;
  }
  
  const search = new TavilySearch({
    tavilyApiKey: env.TAVILY_API_KEY,
    maxResults: 5,
  });

  const t = tool(
    async ({ query }: { query: string }) => {
      logger.info({ query }, "[TOOL] web_search invoked");
      const results = await search.invoke({ query });
      return results;
    },
    {
      name: "web_search",
      description: "Search the web for company and role-specific interview context, question patterns, and industry trends.",
      schema: z.object({
        query: z.string().describe("The search query for interview context"),
      }).strict(),
    }
  );
  return t;
};


/**
 * Hint Generator Tool
 * Generates a subtle, Socratic hint for a candidate without revealing the full answer.
 */
export const hintGeneratorTool = tool(
  async ({ question, candidateAnswer, difficulty }: { 
    question: string; 
    candidateAnswer: string; 
    difficulty: string; 
  }) => {
    const enabled = await isFeatureEnabled("hints_tool_enabled");
    if (!enabled) return "This tool is currently disabled.";

    logger.info({ difficulty }, "[TOOL] hint_generator invoked");
    const llm = createLLM({ timeout: 15000 });
    const prompt = `
      Question: ${question}
      Candidate's Work/Response: ${candidateAnswer}
      Difficulty: ${difficulty}
      
      Act as a helpful but firm interviewer. Suggest a subtle hint or a Socratic question 
      that helps the candidate move forward without giving them the direct solution. 
      Keep it to 15-20 words max.
    `;
    const response = await llm.invoke(prompt);
    return response.content;
  },
  {
    name: "hint_generator",
    description: "Generates a subtle hint for a candidate who is stuck or struggling.",
    schema: z.object({
      question: z.string().describe("The original interview question"),
      candidateAnswer: z.string().describe("What the candidate has said or done so far"),
      difficulty: z.string().describe("The interview difficulty level"),
    }).strict(),
  }
);

/**
 * Code Evaluator Tool
 * Provides a structured critique of candidate's code.
 */
export const codeEvaluatorTool = tool(
  async ({ code, language, question }: {
    code: string;
    language: string;
    question: string;
  }) => {
    const enabled = await isFeatureEnabled("code_eval_tool_enabled");
    if (!enabled) return "This tool is currently disabled.";

    logger.info({ language }, "[TOOL] code_evaluator invoked");
    const llm = createLLM({ jsonMode: true, timeout: 20000 });
    const prompt = `
      Question: ${question}
      Language: ${language}
      Candidate Code:
      \`\`\`${language}
      ${code}
      \`\`\`
      
      Evaluate this code for correctness, time complexity, and space complexity.
      Return a JSON object with: { correctness: string, timeComplexity: string, spaceComplexity: string, suggestions: string[] }
    `;
    const response = await llm.invoke(prompt);
    try {
      const parsed = JSON.parse(response.content as string);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return response.content;
    }
  },
  {
    name: "code_evaluator",
    description: "Evaluates a snippet of code for quality, correctness, and complexity.",
    schema: z.object({
      code: z.string().describe("The code snippet to evaluate"),
      language: z.string().describe("The programming language"),
      question: z.string().describe("The context of the problem being solved"),
    }).strict(),
  }
);


/**
 * Topic Tracker Tool
 * Recommends the next topic to cover based on what has already been discussed.
 */
export const topicTrackerTool = tool(
  async ({ currentTopics, interviewType, customTopics }: {
    currentTopics: string[];
    interviewType: string;
    customTopics: string;
  }) => {
    const enabled = await isFeatureEnabled("topic_tracker_tool_enabled");
    if (!enabled) return "This tool is currently disabled.";

    logger.info({ interviewType, count: currentTopics.length }, "[TOOL] topic_tracker invoked");
    const llm = createLLM({ timeout: 10000 });
    const prompt = `
      Interview Type: ${interviewType}
      Planned/Custom Topics: ${customTopics}
      Topics already covered: ${currentTopics.join(", ")}
      
      Suggest the single most important topic that should be covered next to ensure a comprehensive evaluation.
      Return only the topic name.
    `;
    const response = await llm.invoke(prompt);
    return response.content;
  },
  {
    name: "topic_tracker",
    description: "Suggests the next topic to cover to ensure balanced interview coverage.",
    schema: z.object({
      currentTopics: z.array(z.string()).describe("A list of topics already discussed"),
      interviewType: z.string().describe("The type of interview"),
      customTopics: z.string().describe("User-specified topics or job description context"),
    }).strict(),
  }
);

