import { BaseMessage } from "@langchain/core/messages";

/**
 * Extracts distinct Q&A pairs from the conversation history.
 * Groups consecutive AI messages and matches them with subsequent human responses.
 * Used for token-efficient feedback generation.
 */
export function extractQAPairs(messages: BaseMessage[]): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = [];
  let currentAIQuestion = "";

  for (const msg of messages) {
    const role = msg._getType();

    if (role === "ai") {
      // Accumulate AI messages if consecutive
      if (currentAIQuestion) {
        currentAIQuestion += "\n" + msg.content;
      } else {
        currentAIQuestion = msg.content as string;
      }
    } else if (role === "human" || role === "user") {
      if (currentAIQuestion) {
        pairs.push({
          question: currentAIQuestion.trim(),
          answer: (msg.content as string).trim() || "No verbal response detected",
        });
        currentAIQuestion = ""; // Reset for next pair
      }
    }
  }

  return pairs;
}

/**
 * Formats web search results from Tavily into a concise string for the LLM context.
 */
export function formatWebSearchResults(results: any): string {
  if (!results) return "No specific company/role patterns found on the web.";

  // If results is a string (common when calling .invoke() on a LangChain tool), 
  // try to parse it as JSON first.
  let resultsArray = results;
  if (typeof results === "string") {
    try {
      resultsArray = JSON.parse(results);
    } catch {
      // If it's not JSON, it might just be the direct content string
      return results;
    }
  }

  if (!Array.isArray(resultsArray) || resultsArray.length === 0) {
    return "No specific company/role patterns found on the web.";
  }

  return resultsArray
    .map(
      (res, i) =>
        `[Source ${i + 1}]: ${res.title || "No Title"}\nContent: ${res.content}\nURL: ${res.url}`,
    )
    .join("\n\n");
}
