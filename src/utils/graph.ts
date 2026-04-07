import { env } from "../config/env";
import { createModuleLogger } from "../lib/logger";
import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { AIMessage } from "@langchain/core/messages";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { createLLM } from "../lib/llm";
import { getInterviewerSystemPrompt } from "../lib/prompts";

let checkpointer: MongoDBSaver | null = null;
export let graphApp: any;

export const setupGraph = async (client: MongoClient) => {
  if (graphApp) return;

  checkpointer = new MongoDBSaver({
    client: client as any,
    checkpointCollectionName: "checkpoints",
  });
  graphApp = workflow.compile({ checkpointer });
  logger.info("LangGraph checkpointer initialized using shared MongoDB connection");
};

const logger = createModuleLogger("graph");

const InterviewState = Annotation.Root({
  ...MessagesAnnotation.spec,
  resume: Annotation<string>(),
  interviewType: Annotation<string>({ value: (_, y) => y, default: () => "technical" }),
  difficultyLevel: Annotation<string>({ value: (_, y) => y, default: () => "intermediate" }),
  jobTitle: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  company: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  customTopics: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  jobDescription: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  companyStyle: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  questionCount: Annotation<number>({
    reducer: (x, y) => x + y,
    default: () => 0,
  }),
  maxQuestions: Annotation<number>({ value: (_, y) => y, default: () => 5 }),
  isFinished: Annotation<boolean>({
    value: (_, y) => y,
    default: () => false,
  }),
});

type InterviewStateType = typeof InterviewState.State;

const interviewerNode = async (
  state: InterviewStateType,
): Promise<Partial<InterviewStateType>> => {
  logger.debug(
    `Entering interviewerNode. Question Count: ${state.questionCount}`,
  );

  const llm = createLLM({ timeout: 15000 });

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
  });

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
  ]);

  try {
    const chain = promptTemplate.pipe(llm);
    const response = await chain.invoke({
      messages: state.messages,
    });

    return {
      messages: [response],
      questionCount: 1,
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
