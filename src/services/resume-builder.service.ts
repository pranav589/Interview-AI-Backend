import { GeneratedResume } from "../models/generated-resume.model";
import { builderGraph } from "../utils/builder-graph";
import { createModuleLogger } from "../lib/logger";
import { Types } from "mongoose";
import { NotFoundError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { BaseMessage } from "@langchain/core/messages";

const logger = createModuleLogger("resume-builder-service");

export class ResumeBuilderService {
  async startSession(userId: string, name: string) {
    const session = await GeneratedResume.create({
      userId: new Types.ObjectId(userId),
      name,
      status: "in-progress",
    });

    // Invoke graph to get the first question
    const result = await builderGraph.invoke({ messages: [] });
    
    session.chatHistory = this.serializeMessages(result.messages);
    session.currentStep = result.currentStep;
    await session.save();

    return session;
  }

  async processMessage(sessionId: string, userId: string, message: string) {
    const session = await GeneratedResume.findOne({ _id: sessionId, userId });
    if (!session) throw new NotFoundError("Session not found");

    // We only pass the messages to the graph that it needs to see.
    // Usually, just the last few or the full history. 
    // Since we're using StateGraph, we'll recreate the state.
    const result = await builderGraph.invoke({
      messages: this.deserializeMessages(session.chatHistory).concat({ role: "user", content: message }),
      resumeData: session.resumeData,
      currentStep: session.currentStep as any,
    });

    // Append new messages to history
    // result.messages usually contains the FULL state history in LangGraph if reducer is used,
    // but here it returns the new messages if the reducer isn't specified on StateSchema.
    // Given the current BuilderState, it might overwrite.
    // However, our nodes return { messages: [new_one] }, so result.messages should be the new ones.
    
    const userMsg = { role: "user" as const, content: message };
    const aiMsgs = this.serializeMessages(result.messages);
    
    session.chatHistory = [...session.chatHistory, userMsg, ...aiMsgs];
    session.resumeData = result.resumeData || session.resumeData;
    session.currentStep = result.currentStep || session.currentStep;
    if (result.isFinished) {
      session.status = "completed";
    }

    await session.save();
    return session;
  }

  private serializeMessages(messages: any[]): any[] {
    return messages.map(m => {
      if (m instanceof BaseMessage || (m._getType && typeof m._getType === 'function')) {
        const type = m._getType();
        return {
          role: type === 'ai' ? 'assistant' : type === 'human' ? 'user' : type,
          content: m.content
        };
      }
      return m;
    });
  }

  private deserializeMessages(history: any[]): any[] {
    return history.map(m => ({
      role: m.role,
      content: m.content
    }));
  }
}

export const resumeBuilderService = new ResumeBuilderService();
