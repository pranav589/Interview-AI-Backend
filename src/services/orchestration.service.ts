import { graphApp } from "../utils/graph";
import { createModuleLogger } from "../lib/logger";
import { stripMetadata, isLikelyMetaLeak } from "../helpers/message-utils";
import { MESSAGES } from "../config/constants";

const logger = createModuleLogger("orchestration-service");

async function invokeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs),
    ),
  ]);
}

export class OrchestrationService {
  async processUserTurn(threadId: string, text: string) {
    if (!graphApp) {
      throw new Error(MESSAGES.AI.ORCHESTRATOR_NOT_READY);
    }

    const result = (await invokeWithTimeout(
      graphApp.invoke(
        { messages: [{ role: "user", content: text }] },
        { configurable: { thread_id: threadId } },
      ),
      45000,
      "AI response timed out. Please try again.",
    )) as any;

    const aiText = this.extractAIResponse(result.messages);
    return {
      aiText,
      isFinished: !!result.isFinished,
      isCodingMode: !!result.isCodingMode,
    };
  }

  async startInterview(threadId: string, options: any) {
    if (!graphApp) {
      throw new Error(MESSAGES.AI.ORCHESTRATOR_NOT_READY);
    }

    const result = (await invokeWithTimeout(
      graphApp.invoke(
        {
          messages: [{ role: "user", content: "Start the interview." }],
          ...options,
        },
        { configurable: { thread_id: threadId } },
      ),
      45000,
      "AI response timed out. Please try again.",
    )) as any;

    const aiText = (result.messages.at(-1) as any).content;
    return {
      aiText: stripMetadata(aiText),
      isFinished: !!result.isFinished,
      isCodingMode: !!result.isCodingMode,
    };
  }

  async getConversationHistory(threadId: string) {
    if (!graphApp) return null;
    
    const state = await graphApp.getState({
      configurable: { thread_id: threadId },
    });

    if (!state?.values?.messages) return null;

    const existingMessages = state.values.messages
      .filter((msg: any) => {
        const role = msg._getType();
        return (role === "ai" || role === "human") && msg.content;
      })
      .map((msg: any) => ({
        role: msg._getType(),
        text: stripMetadata(
          typeof msg.content === "string" ? msg.content : String(msg.content)
        ),
      }))
      .filter((m: any) => m.text && !isLikelyMetaLeak(m.text));

    return {
      messages: existingMessages,
      isCodingMode: !!state.values.isCodingMode,
    };
  }

  private extractAIResponse(messages: any[]) {
    const aiMessages = [];
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const role =
        msg.role || msg.type || (msg._getType ? msg._getType() : "");

      if ((role === "ai" || role === "assistant") && msg.content) {
        const rawContent =
          typeof msg.content === "string" ? msg.content : String(msg.content);
        
        if (isLikelyMetaLeak(rawContent)) continue;

        const content = stripMetadata(rawContent);
        if (content) {
          aiMessages.unshift(content);
        }
      } else if (role === "tool") {
        continue;
      } else {
        break;
      }
    }
    return aiMessages.join("\n\n").trim();
  }
}

export const orchestrationService = new OrchestrationService();
