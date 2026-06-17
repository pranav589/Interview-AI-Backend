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
 * Extracts ACTUAL interview Q&A pairs using the graph's authoritative askedQuestions list.
 *
 * The graph tracks each genuine question via `isNewQuestion` + `currentQuestionText` and
 * accumulates them in `askedQuestions[]`. This function pairs each item in that list with
 * all candidate responses that follow it in the message history — merging multi-turn answers
 * from follow-up probes into a single answer block.
 *
 * @param messages   Full message history from LangGraph state.
 * @param askedQuestions  The authoritative list of question summaries from state.askedQuestions.
 * @returns Array of { question, answer } pairs — one per actual interview question.
 */
export function extractActualQAPairs(
  messages: BaseMessage[],
  askedQuestions: string[],
): { question: string; answer: string }[] {
  if (!askedQuestions || askedQuestions.length === 0) return [];

  // Build an ordered list of [messageIndex, questionIndex] markers by finding
  // the first AIMessage that contains each question (substring match, case-insensitive).
  const questionMarkers: { msgIndex: number; questionIndex: number }[] = [];

  for (let qi = 0; qi < askedQuestions.length; qi++) {
    const questionText = askedQuestions[qi].toLowerCase().trim();
    // Search for the AI message containing this question text
    for (let mi = 0; mi < messages.length; mi++) {
      const role = messages[mi]._getType();
      if (role !== "ai") continue;
      const content = (messages[mi].content as string ?? "").toLowerCase();
      // Use first 60 chars of question for matching to avoid false positives on long texts
      const matchKey = questionText.slice(0, 60);
      if (content.includes(matchKey)) {
        // Only add if not already placed at an earlier index (avoid duplicates)
        const alreadyMarked = questionMarkers.some((m) => m.questionIndex === qi);
        if (!alreadyMarked) {
          questionMarkers.push({ msgIndex: mi, questionIndex: qi });
        }
        break;
      }
    }
  }

  // Sort markers by message order (they should already be, but be safe)
  questionMarkers.sort((a, b) => a.msgIndex - b.msgIndex);

  // For each question, collect all human messages between its AIMessage and the next question's AIMessage
  const pairs: { question: string; answer: string }[] = [];

  for (let i = 0; i < questionMarkers.length; i++) {
    const { msgIndex, questionIndex } = questionMarkers[i];
    const nextMsgIndex = questionMarkers[i + 1]?.msgIndex ?? messages.length;

    // Gather human messages in the window [msgIndex+1, nextMsgIndex)
    const answerParts: string[] = [];
    for (let mi = msgIndex + 1; mi < nextMsgIndex; mi++) {
      const role = messages[mi]._getType();
      if (role === "human" || role === "user") {
        const text = (messages[mi].content as string ?? "").trim();
        if (text) answerParts.push(text);
      }
    }

    pairs.push({
      question: askedQuestions[questionIndex],
      answer: answerParts.length > 0 ? answerParts.join(" ") : "Not Answered",
    });
  }

  // If some questions in askedQuestions were not found in messages (no matching AI turn),
  // append them as unanswered at the end.
  for (let qi = 0; qi < askedQuestions.length; qi++) {
    const alreadyIncluded = pairs.some(
      (p) => p.question === askedQuestions[qi]
    );
    if (!alreadyIncluded) {
      pairs.push({ question: askedQuestions[qi], answer: "Not Answered" });
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
export function isLikelyMetaLeak(text: string) {
  const t = text.trim();
  const hasAllKeys =
    t.includes("isCodingMode") &&
    t.includes("isNewQuestion") &&
    t.includes("currentQuestionText");
  if (!hasAllKeys) return false;

  const looksLikeBareObject =
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("(") && t.endsWith(")"));

  return looksLikeBareObject && t.length <= 500;
}

export function stripMetadata(text: string): string {
  if (typeof text !== "string") return "";
  const metaKeys = ["isCodingMode", "isNewQuestion", "currentQuestionText", "isFinished"];
  let content = text;
  
  metaKeys.forEach(key => {
    const regex = new RegExp(`"?${key}"?\\s*:\\s*(true|false|"[^"]*"|'[^']*')[,\\s]*`, "gi");
    content = content.replace(regex, "");
  });

  return content.replace(/[\{\}]/g, "").trim();
}
