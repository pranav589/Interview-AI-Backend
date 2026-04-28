import { createModuleLogger } from "../lib/logger";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  START,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { 
  invokeStructuredLLMWithFallback, 
  invokeLLMWithFallback,
  invokeLLMMessageWithFallback
} from "../lib/llm-with-fallback";

import { 
  getBehavioralSystemPrompt, 
  getTechnicalSystemPrompt, 
  getSysDesignSystemPrompt 
} from "../lib/prompts";
import { isFeatureEnabled } from "./feature-flags";
import { createWebSearchTool, hintGeneratorTool, codeEvaluatorTool, topicTrackerTool } from "./tools";
import { formatWebSearchResults } from "../lib/message-utils";
import { z } from "zod";

const logger = createModuleLogger("graph");

// --- Graph State Schema ---

const InterviewState = new StateSchema({
  messages: MessagesValue,
  resume: z.string().optional().default(""),
  interviewType: z.string().default("technical"),
  difficultyLevel: z.string().default("intermediate"),
  jobTitle: z.string().default(""),
  tempMessage: z.any().optional(), // Temporary storage for raw AI response


  company: z.string().default(""),
  customTopics: z.string().default(""),
  jobDescription: z.string().default(""),
  companyStyle: z.string().default(""),
  
  // Progress Tracking
  questionCount: z.number().default(0), // Managed by counter node now
  maxQuestions: z.number().default(5),
  isFinished: z.boolean().default(false),
  isCodingMode: z.boolean().default(false),
  
  // New Tracking Fields
  isNewQuestion: z.boolean().default(false),
  currentQuestionText: z.string().default(""),
  askedQuestions: new ReducedValue(z.array(z.string()).default([]), {
    reducer: (x: string[], y: string[]) => [...x, ...y],
  }),
  companyQuestionContext: z.string().default(""),
  interviewPhase: z.string().default("greeting"), // greeting | questioning | followup | closing

  // Safety & Efficiency Flags
  hasLoadedContext: z.boolean().default(false),
  toolCallCount: z.number().default(0),
});

type InterviewStateType = typeof InterviewState.State;

// --- Node Implementations ---

/**
 * Node: Context Loader
 * Runs web search ONCE at the start of the session if enabled.
 */
const contextLoaderNode = async (state: InterviewStateType) => {
  // Only search if we haven't searched yet and have sufficient data
  if (state.hasLoadedContext || (!state.company && !state.jobTitle)) {
    return { hasLoadedContext: true };
  }

  const searchEnabled = await isFeatureEnabled("web_search_enabled");
  if (!searchEnabled) return { hasLoadedContext: true };

  const webSearchTool = createWebSearchTool();
  if (!webSearchTool) return { hasLoadedContext: true };

  try {
    logger.info({ company: state.company, jobTitle: state.jobTitle }, "[GRA] Context loader: searching web...");
    const query = `${state.company || ""} ${state.jobTitle || ""} interview questions patterns 2024 2025`;
    const results = await webSearchTool.invoke({ query });
    const context = formatWebSearchResults(results);
    
    return { 
      companyQuestionContext: context,
      hasLoadedContext: true
    };
  } catch (err) {
    logger.error({ err }, "[GRA] Web search failed, continuing without it");
    // Mark as checked with fallback to avoid repeated failures in the same session
    return { 
      companyQuestionContext: "Web search context unavailable for this session.",
      hasLoadedContext: true 
    };
  }
};

/**
 * Common Response Schema for Structured Output
 */
const ResponseSchema = z.object({
  content: z.string().describe("The text response to the candidate."),
  isCodingMode: z.boolean().default(false).describe("Whether to trigger/continue CODING_MODE."),
  isNewQuestion: z.boolean().default(false).describe("TRUE if this response asks a new, distinct question."),
  currentQuestionText: z.string().default("").describe("A summary of the new question if isNewQuestion is TRUE."),
});

/**
 * Technical flow should never rely on parsing model text for state.
 * We generate the assistant message normally (tool-capable), then separately
 * classify state-changing flags using structured output.
 */
const TechnicalMetaSchema = z.object({
  isCodingMode: z.boolean().default(false),
  isNewQuestion: z.boolean().default(false),
  currentQuestionText: z.string().default(""),
});

const coerceBoolean = (value: unknown) => {
  return value === true || value === "true";
};

const normalizeMessageContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
};

const hasQuestionSignal = (content: string) => {
  const normalized = content.toLowerCase();
  return (
    content.includes("?") ||
    content.includes("[CODING_MODE]") ||
    normalized.includes("coding challenge") ||
    normalized.includes("design a ") ||
    normalized.includes("implement ")
  );
};

const getToolCalls = (message: unknown) => {
  const msg = message as any;
  return msg?.tool_calls || msg?.toolCalls || msg?.additional_kwargs?.tool_calls || [];
};

/**
 * Node: Technical Interviewer
 */
const technicalNode = async (state: InterviewStateType) => {
  const codingModeEnabled = await isFeatureEnabled("coding_mode_enabled");
  
  const systemPrompt = getTechnicalSystemPrompt({
    ...state,
    codingModeEnabled,
    skipTrackingProtocol: true,
  });

  // Tools Collection
  let tools = [];
  const hintsEnabled = await isFeatureEnabled("hints_tool_enabled");
  const codeEvalEnabled = await isFeatureEnabled("code_eval_tool_enabled");
  const topicTrackerEnabled = await isFeatureEnabled("topic_tracker_tool_enabled");
  if (hintsEnabled) tools.push(hintGeneratorTool);
  if (codeEvalEnabled) tools.push(codeEvaluatorTool);
  if (topicTrackerEnabled) tools.push(topicTrackerTool);

  const trimmedMessages = trimMessages(state.messages, 10);
  const toolInstructions = [
    codeEvalEnabled
      ? '- If the user has submitted code, you MUST call the "code_evaluator" tool before giving your feedback.'
      : "- If the user has submitted code, evaluate it yourself because the code_evaluator tool is disabled.",
    hintsEnabled ? '- If the user seems stuck, you MAY use the "hint_generator".' : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Note: We use a raw message call to support tool-calling loops.
  // State-changing flags are computed separately via structured output
  // (we do NOT parse JSON out of model text).
  const promptWithFormating = `
    ${systemPrompt}
    
    IMPORTANT:
    - MAINTAIN YOUR PERSONA. You are a professional interviewer, not a chatbot.
    ${toolInstructions}
    - You may call tools if needed. When you respond to the candidate, respond normally in plain text.
  `;

  const messages = [
    new SystemMessage(promptWithFormating),
    ...trimmedMessages
  ];

  const result = await invokeLLMMessageWithFallback(messages, { 
    timeout: 30000, 
    tools 
  });

  // If there are tool calls, we MUST add to history so tools node can see it
  if (getToolCalls(result).length > 0) {
    // Guard against infinite tool loops
    if (state.toolCallCount >= 3) {
      logger.warn({ threadId: (state as any).threadId }, "[GRA] Max tool calls reached, aborting loop.");
      return {
        messages: [new AIMessage("I've analyzed the technical details. Let's move forward.")],
        isCodingMode: false,
        isNewQuestion: false,
        currentQuestionText: "",
        toolCallCount: 0
      };
    }

    return {
      messages: [result],
      tempMessage: null, // Back-compat: ensure no stale temp message
      toolCallCount: state.toolCallCount + 1
    };
  }

  // Final assistant response (no tool calls). Compute flags via structured output.
  const assistantText = normalizeMessageContent(result.content);
  const metaPrompt = `
You are a strict classifier for interview orchestration state.

Return ONLY a JSON object matching this schema:
{
  "isCodingMode": boolean,
  "isNewQuestion": boolean,
  "currentQuestionText": string
}

Rules:
- "isNewQuestion" must be TRUE only if the assistant is asking a completely new, distinct interview question.
- "isNewQuestion" must be FALSE for acknowledgments, hints, follow-ups, evaluations, or transitions.
- "isCodingMode" must be TRUE only if the assistant is asking the candidate to write code now (a coding challenge), otherwise FALSE.
- If "isNewQuestion" is TRUE, "currentQuestionText" should be a short summary of that new question. Otherwise empty string.
  `.trim();

  const meta = await invokeStructuredLLMWithFallback(
    TechnicalMetaSchema,
    [
      new SystemMessage(metaPrompt),
      ...trimmedMessages,
      new HumanMessage(`Assistant response to classify:\n\n${assistantText}`),
    ],
    { timeout: 15000 },
  );

  return {
    messages: [new AIMessage(assistantText)],
    isCodingMode: meta.isCodingMode,
    isNewQuestion: meta.isNewQuestion,
    currentQuestionText: meta.isNewQuestion ? meta.currentQuestionText || "" : "",
    tempMessage: null,
    toolCallCount: 0, // Reset on successful response
  };
};

/**
 * Tool Node Definition
 */
const toolNode = new ToolNode([hintGeneratorTool, codeEvaluatorTool, topicTrackerTool]);

/**
 * Conditional Edge: Should Continue
 * Decides whether to route to tools or move forward.
 */
const shouldContinue = (state: InterviewStateType) => {
  const msg = state.messages[state.messages.length - 1];
  if (getToolCalls(msg).length > 0) {
    return "tools";
  }
  return "question_counter";
};


/**
 * Node: Behavioral Interviewer
 */
const behavioralNode = async (state: InterviewStateType) => {
  const systemPrompt = getBehavioralSystemPrompt(state);
  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
  ]);

  const trimmedMessages = trimMessages(state.messages, 10);
  const formattedMessages = await promptTemplate.formatMessages({
    messages: trimmedMessages,
  });

  const result = await invokeStructuredLLMWithFallback(
    ResponseSchema,
    formattedMessages,
    { timeout: 20000 }
  );

  logger.info(
    { 
      isNewQuestion: result.isNewQuestion,
      aiTextPrefix: result.content.substring(0, 50) + "..."
    }, 
    "[GRA] Behavioral Node finished"
  );

  return {
    messages: [new AIMessage(result.content)],
    isCodingMode: false, // Behavioral never has coding mode
    isNewQuestion: result.isNewQuestion,
    currentQuestionText: result.currentQuestionText || "",
  };
};

/**
 * Node: System Design Interviewer
 */
const sysdesignNode = async (state: InterviewStateType) => {
  const systemPrompt = getSysDesignSystemPrompt(state);
  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
  ]);

  const trimmedMessages = trimMessages(state.messages, 10);
  const formattedMessages = await promptTemplate.formatMessages({
    messages: trimmedMessages,
  });

  const result = await invokeStructuredLLMWithFallback(
    ResponseSchema,
    formattedMessages,
    { timeout: 20000 }
  );

  logger.info(
    { 
      isNewQuestion: result.isNewQuestion,
      aiTextPrefix: result.content.substring(0, 50) + "..."
    }, 
    "[GRA] System Design Node finished"
  );

  return {
    messages: [new AIMessage(result.content)],
    isCodingMode: false,
    isNewQuestion: result.isNewQuestion,
    currentQuestionText: result.currentQuestionText || "",
  };
};

/**
 * Node: Question Counter
 * Increments questionCount only if isNewQuestion is TRUE.
 */
const questionCounterNode = (state: InterviewStateType) => {
  if (!state.isNewQuestion) {
    logger.debug("[GRA] Follow-up detected (isNewQuestion=false), skipping count increment.");
    return { interviewPhase: "followup" };
  }

  const newCount = state.questionCount + 1;

  logger.info(
    { prevCount: state.questionCount, newCount, question: state.currentQuestionText },
    "[GRA] New question detected! Incrementing counter."
  );

  const updates: any = {
    questionCount: newCount,
    interviewPhase: "questioning",
    isFinished: false,
  };
  
  if (state.currentQuestionText) {
    updates.askedQuestions = [state.currentQuestionText]; // Append via reducer
  }
  
  return updates;
};

const routeAfterCounter = (state: InterviewStateType) => {
  if (!state.isNewQuestion && state.questionCount >= state.maxQuestions) {
    return "finish";
  }
  return "end";
};

/**
 * Helper: Trim messages to last N to avoid context overflow
 */
const trimMessages = (messages: BaseMessage[], limit = 15) => {
  if (messages.length <= limit) return messages;
  
  let sliced = messages.slice(-limit);
  
  while (sliced.length > 0 && (sliced[0] as any)._getType() === "tool") {
    sliced = sliced.slice(1);
  }
  
  return sliced;
};

/**
 * Node: Finish
 * Graceful closing message generated by LLM.
 */
const finishNode = async (state: InterviewStateType) => {
  const trimmed = trimMessages(state.messages, 8);
  
  const systemPrompt = `
    The interview is now over. 
    Wrap up the conversation by briefly acknowledging the candidate's last answer and thanking them for their time.
    Keep the tone professional and warm.
    Tell them they can find their detailed feedback on the dashboard.
    Do NOT ask any more questions.
  `;

  const closingText = await invokeLLMWithFallback([
    new SystemMessage(systemPrompt),
    ...trimmed
  ]);

  return {
    isFinished: true,
    isCodingMode: false,
    isNewQuestion: false,
    currentQuestionText: "",
    interviewPhase: "closing",
    messages: [new AIMessage(closingText)],
  };
};

/**
 * Routing Logic
 */
const routeByType = (state: InterviewStateType) => {
  if (state.isFinished) {
    return "finish";
  }
  switch (state.interviewType) {
    case "behavioral":    return "behavioral";
    case "system-design": return "sysdesign";
    case "technical":
    default:              return "technical";
  }
};

// --- Graph Compilation ---

const workflow = new StateGraph(InterviewState)
  .addNode("context_loader", contextLoaderNode)
  .addNode("technical", technicalNode)
  .addNode("behavioral", behavioralNode)
  .addNode("sysdesign", sysdesignNode)
  .addNode("tools", toolNode)
  .addNode("question_counter", questionCounterNode)
  .addNode("finish", finishNode)

  .addEdge(START, "context_loader")
  .addConditionalEdges("context_loader", routeByType, {
    technical: "technical",
    behavioral: "behavioral",
    sysdesign: "sysdesign",
    finish: "finish",
  })
  
  // Technical Loop with Tools
  .addConditionalEdges("technical", shouldContinue, {
    tools: "tools",
    question_counter: "question_counter",
  })
  .addEdge("tools", "technical") // Loop back to technical after tool execution

  .addEdge("behavioral", "question_counter")
  .addEdge("sysdesign", "question_counter")
  .addConditionalEdges("question_counter", routeAfterCounter, {
    finish: "finish",
    end: END,
  })
  .addEdge("finish", END);

// --- Initialization ---

let checkpointer: MongoDBSaver | null = null;
export let graphApp: any;

export const setupGraph = async (client: MongoClient) => {
  if (graphApp) return;

  checkpointer = new MongoDBSaver({
    client: client as any,
    checkpointCollectionName: "checkpoints",
  });
  
  graphApp = workflow.compile({ checkpointer });
  logger.info(
    "LangGraph orchestrator refactored into multi-node architecture"
  );
};

export const pool = null;
