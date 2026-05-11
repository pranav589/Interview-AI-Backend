import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { z } from "zod";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeLLMWithFallback, invokeStructuredLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("builder-graph");

const BuilderState = new StateSchema({
  messages: z.array(z.any()).default([]),
  resumeData: z.object({
    personalInfo: z.any().default({}),
    summary: z.string().default(""),
    experience: z.array(z.any()).default([]),
    education: z.array(z.any()).default([]),
    skills: z.array(z.string()).default([]),
    projects: z.array(z.any()).default([]),
    certifications: z.array(z.any()).default([]),
  }),
  currentStep: z.string().default("personal_info"),
  isFinished: z.boolean().default(false),
});

type BuilderStateType = typeof BuilderState.State;

const personalInfoNode = async (state: BuilderStateType) => {
  // Case 1: Initial call (no messages)
  if (state.messages.length === 0) {
    return {
      messages: [new AIMessage("Great! Let's start building your resume. What's your full name, email, and location?")],
      currentStep: "personal_info",
    };
  }

  // Case 2: Process user input
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  const schema = z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string().optional(),
    location: z.string().optional(),
  });

  try {
    const info = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract personal information from the user message."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    return {
      resumeData: { ...state.resumeData, personalInfo: info },
      messages: [new AIMessage(`Got it, ${info.name}. Now, give me a brief professional summary or your career goals.`)],
      currentStep: "summary",
    };
  } catch (e) {
    return {
      messages: [new AIMessage("I couldn't quite catch that. Could you please provide your name, email, and location clearly?")],
      currentStep: "personal_info",
    };
  }
};

const summaryNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  return {
    resumeData: { ...state.resumeData, summary: lastMessage },
    messages: [new AIMessage("Excellent. Now let's talk about your work experience. Tell me about your most recent role: Job Title, Company, and what you did there.")],
    currentStep: "experience",
  };
};

const experienceNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  const schema = z.object({
    role: z.string(),
    company: z.string(),
    startDate: z.string(),
    endDate: z.string().optional(),
    bullets: z.array(z.string()),
    hasMore: z.boolean().describe("True if the user mentioned another role to add"),
  });

  try {
    const exp = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract work experience details. If the user wants to add another role, set hasMore to true."), new HumanMessage(lastMessage)],
      { timeout: 20000 }
    );

    const updatedExp = [...state.resumeData.experience, exp];
    
    if (exp.hasMore) {
      return {
        resumeData: { ...state.resumeData, experience: updatedExp },
        messages: [new AIMessage("Added! Tell me about the next role.")],
        currentStep: "experience",
      };
    }

    return {
      resumeData: { ...state.resumeData, experience: updatedExp },
      messages: [new AIMessage("Great experience. Now, what about your education? (Degree, School, Graduation Year)")],
      currentStep: "education",
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Please provide the role, company, and some details about your responsibilities.")],
      currentStep: "experience",
    };
  }
};

const educationNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  const schema = z.object({
    degree: z.string(),
    school: z.string(),
    gradDate: z.string(),
    hasMore: z.boolean(),
  });

  try {
    const edu = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract education details."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    const updatedEdu = [...state.resumeData.education, edu];

    if (edu.hasMore) {
      return {
        resumeData: { ...state.resumeData, education: updatedEdu },
        messages: [new AIMessage("Added. Any other degrees or certifications?")],
        currentStep: "education",
      };
    }

    return {
      resumeData: { ...state.resumeData, education: updatedEdu },
      messages: [new AIMessage("Almost there! List your top skills (e.g., Python, Project Management, React).")],
      currentStep: "skills",
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Please share your degree and the school you attended.")],
      currentStep: "education",
    };
  }
};

const skillsNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  const schema = z.object({
    skills: z.array(z.string()),
  });

  try {
    const { skills } = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract a list of skills."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    return {
      resumeData: { ...state.resumeData, skills },
      messages: [new AIMessage("Perfect! Your resume data is complete. I'll now generate your resume. Which template would you prefer: Modern, Classic, or Minimalist?")],
      currentStep: "finish",
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Just list a few of your core skills.")],
      currentStep: "skills",
    };
  }
};

const finishNode = async (state: BuilderStateType) => {
  return {
    isFinished: true,
    messages: [new AIMessage("Your resume has been generated! You can preview and download it now.")],
  };
};

const workflow = new StateGraph(BuilderState)
  .addNode("personal_info", personalInfoNode)
  .addNode("summary", summaryNode)
  .addNode("experience", experienceNode)
  .addNode("education", educationNode)
  .addNode("skills", skillsNode)
  .addNode("finish", finishNode)
  .addConditionalEdges(START, (state) => state.currentStep)
  .addEdge("personal_info", END)
  .addEdge("summary", END)
  .addEdge("experience", END)
  .addEdge("education", END)
  .addEdge("skills", END)
  .addEdge("finish", END);

export const builderGraph = workflow.compile();
