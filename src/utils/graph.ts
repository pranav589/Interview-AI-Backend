import { createModuleLogger } from "../lib/logger";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  START,
  END,
} from "@langchain/langgraph";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { AIMessage } from "@langchain/core/messages";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { invokeStructuredLLMWithFallback } from "../lib/llm-with-fallback";
import { getInterviewerSystemPrompt } from "../lib/prompts";
import { isFeatureEnabled } from "./feature-flags";
import { z } from "zod";

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
    "LangGraph checkpointer initialized using shared MongoDB connection",
  );
};

const logger = createModuleLogger("graph");

const InterviewState = new StateSchema({
  messages: MessagesValue,
  resume: z.string().optional().default(""),
  interviewType: z.string().default("technical"),
  difficultyLevel: z.string().default("intermediate"),
  jobTitle: z.string().default(""),
  company: z.string().default(""),
  customTopics: z.string().default(""),
  jobDescription: z.string().default(""),
  companyStyle: z.string().default(""),
  questionCount: new ReducedValue(z.number().default(0), {
    reducer: (x: number, y: number) => x + y,
  }),
  maxQuestions: z.number().default(5),
  isFinished: z.boolean().default(false),
  isCodingMode: z.boolean().default(false),
});

type InterviewStateType = typeof InterviewState.State;

const interviewerNode = async (
  state: InterviewStateType,
): Promise<Partial<InterviewStateType>> => {
  logger.debug(
    `Entering interviewerNode. Question Count: ${state.questionCount}`,
  );

  if (state.questionCount >= state.maxQuestions) {
    logger.info("Interview limit reached.");
    return {
      isFinished: true,
      messages: [
        new AIMessage(
          "That covers all the main topics I wanted to discuss today. Thank you for your time, the interview is now complete.",
        ),
      ],
    };
  }

  const codingModeEnabled = await isFeatureEnabled("coding_mode_enabled");
  
  const systemPrompt = getInterviewerSystemPrompt({
    interviewType: state.interviewType,
    difficultyLevel: state.difficultyLevel,
    questionCount: state.questionCount,
    maxQuestions: state.maxQuestions,
    resume: state.resume,
    jobTitle: state.jobTitle,
    company: state.company,
    customTopics: state.customTopics,
    jobDescription: state.jobDescription,
    companyStyle: state.companyStyle,
    isCodingMode: codingModeEnabled ? state.isCodingMode : false,
    codingModeEnabled,
  });

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
  ]);

  const formattedMessages = await promptTemplate.formatMessages({
    messages: state.messages,
  });

  const ResponseSchema = z.object({
    content: z
      .string()
      .describe(
        "The text response to the candidate, including the coding block if applicable.",
      ),
    isCodingMode: z
      .boolean()
      .describe(
        "Whether the current response initiates or continues CODING_MODE.",
      ),
  });

  try {
    const result = await invokeStructuredLLMWithFallback(
      ResponseSchema,
      formattedMessages,
      {
        timeout: 15000,
      },
    );

    return {
      messages: [new AIMessage(result.content)],
      questionCount: 1,
      isCodingMode: codingModeEnabled ? result.isCodingMode : false,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.error({ err }, "LLM Error in interviewerNode");
    }
    throw err;
  }
};

const workflow = new StateGraph(InterviewState)
  .addNode("interviewer", interviewerNode)
  .addEdge(START, "interviewer")
  .addEdge("interviewer", END);

export const pool = null;
