import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import z from "zod";
import * as cookie from "cookie";
import { aai } from "./assemblyai";
import { graphApp } from "../utils/graph";
import { createModuleLogger } from "./logger";
import { verifyAccessToken } from "./token";
import { User } from "../models/user.model";
import { Interview } from "../models/interview.model";
import { validateTicket } from "./ws-tickets";

const logger = createModuleLogger("socket");

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

const wsStartSchema = z.object({
  type: z.literal("start"),
  threadId: z.string().min(1),
  resume: z.string().optional().default(""),
  numberOfQuestions: z.number().int().positive().max(20).optional().default(5),
  interviewType: z
    .enum(["behavioral", "technical", "system-design"])
    .optional()
    .default("technical"),
  difficultyLevel: z
    .enum(["beginner", "intermediate", "advanced"])
    .optional()
    .default("intermediate"),
  jobTitle: z.string().optional().default(""),
  company: z.string().optional().default(""),
  customTopics: z.string().optional().default(""),
  jobDescription: z.string().optional().default(""),
  companyStyle: z.string().optional().default(""),
});

const wsAudioSchema = z.object({
  type: z.literal("audio"),
  chunk: z.string().min(1),
});

const wsPauseSchema = z.object({
  type: z.literal("pause"),
  elapsedSeconds: z.number().nonnegative(),
});

const wsResumeStartSchema = z.object({
  type: z.literal("resume"),
  threadId: z.string().min(1).optional(),
});

const wsCodeSchema = z.object({
  type: z.literal("code_submission"),
  content: z.string().min(1),
  language: z.string().optional(),
});

function parseCodingMode(text: string) {
  if (!text) return { isCoding: false };
  const regex =
    /\[CODING[\s_-]*MODE:\s*([\w+\#\-]+)\]([\s\S]*?)\[\/CODING[\s_-]*MODE\]/i;
  const match = text.match(regex);
  if (match) {
    return {
      isCoding: true,
      language: match[1]
        .toLowerCase()
        .replace("c++", "cpp")
        .replace("c#", "csharp"),
      questionText: match[2].trim(),
    };
  }
  return { isCoding: false };
}

export const setupWebSocket = (wss: WebSocketServer) => {
  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    let userId: string | null = null;

    try {
      // Try Ticket Auth (Primary for cross-origin)
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const ticket = url.searchParams.get("ticket");

      if (ticket) {
        userId = validateTicket(ticket);
      }

      // Try Cookie Auth (Fallback for same-origin)
      if (!userId && req.headers.cookie) {
        const cookies = cookie.parse(req.headers.cookie);
        const accessToken = cookies.accessToken;
        if (accessToken) {
          const payload = verifyAccessToken(accessToken);
          const user = await User.findById(payload.sub);
          if (user && user.tokenVersion === payload.tokenVersion) {
            userId = user.id;
          }
        }
      }

      if (!userId) {
        logger.warn("WebSocket connection attempt rejected: Unauthorized");
        ws.close(4001, "Unauthorized");
        return;
      }

      logger.info({ userId }, "WebSocket client connected and authenticated");
    } catch (err) {
      logger.error({ err }, "Error during WebSocket authentication");
      ws.close(4001, "Unauthorized");
      return;
    }

    let threadId: string | null = null;
    let rt: any = null;
    let isReady = false;
    let isConnecting = false;
    let isInterviewStarting = false;
    let processedTurns = new Set();
    let isProcessingTurn = false;
    let audioBuffer = Buffer.alloc(0);
    let audioFlushTimeout: NodeJS.Timeout | null = null;

    // ---------- Extracted helpers ----------

    const extractAIResponse = (messages: any[]) => {
      const aiMessages = [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const role =
          msg.role || msg.type || (msg._getType ? msg._getType() : "");

        if (role === "ai" || role === "assistant") {
          aiMessages.unshift(msg.content);
        } else {
          break;
        }
      }
      return aiMessages.join("\n\n");
    };

    const handleTranscriberTurn = async (turn: any) => {
      const text = turn.transcript;
      if (!text) return;

      const turnOrder = turn.turn_order;
      const isFinal = turn.end_of_turn;

      if (ws.readyState !== ws.OPEN) return;

      if (!isFinal) {
        ws.send(JSON.stringify({ type: "partial_text", content: text }));
      } else {
        if (processedTurns.has(turnOrder)) return;
        processedTurns.add(turnOrder);

        logger.info({ turnOrder }, `[AAI] FINAL Turn: "${text}"`);
        ws.send(JSON.stringify({ type: "user_text", content: text }));

        if (isProcessingTurn) {
          logger.warn(
            `[FLOW] Already processing a turn, skipping graph for ${turnOrder}`,
          );
          return;
        }

        try {
          isProcessingTurn = true;
          logger.debug({ turnOrder }, "[FLOW] Triggering AI...");
          const result = (await invokeWithTimeout(
            graphApp.invoke(
              { messages: [{ role: "user", content: text }] },
              { configurable: { thread_id: threadId } },
            ),
            45000,
            "AI response timed out. Please try again.",
          )) as any;

          const aiText = extractAIResponse(result.messages);
          logger.info(
            { threadId, aiTextLength: aiText?.length },
            "[FLOW] AI Response received",
          );

          if (ws.readyState === ws.OPEN) {
            const codingInfo = parseCodingMode(aiText);

            if (codingInfo.isCoding) {
              logger.info(
                { language: codingInfo.language },
                "[FLOW] Coding mode detected",
              );

              const preText = aiText.split(/\[CODING_MODE/i)[0].trim();
              if (preText) {
                ws.send(JSON.stringify({ type: "text", content: preText }));
              }

              ws.send(
                JSON.stringify({
                  type: "coding_question",
                  language: codingInfo.language,
                  questionText: codingInfo.questionText,
                  initialCode: "",
                }),
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "text",
                  content: aiText,
                  isFinished: !!result.isFinished,
                }),
              );
            }

            if (result.isFinished) {
              await closeTranscriber();
            }
          }
        } catch (err: any) {
          logger.error({ err }, "[GRAPH] Error");
          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: err.message || "Failed to get AI response",
              }),
            );
          }
        } finally {
          isProcessingTurn = false;
        }
      }
    };

    const createAndConnectTranscriber = async () => {
      if (rt || isConnecting || isReady) return;

      isConnecting = true;
      try {
        rt = aai.streaming.transcriber({
          sampleRate: 16000,
          formatTurns: true,
          speechModel: "universal-streaming-english",
          minTurnSilence: 3000,
        });

        rt.on("turn", handleTranscriberTurn);
        rt.on("open", ({ id }: { id: string }) => {
          isReady = true;
          isConnecting = false;
          logger.info({ id }, "[AAI] Session started");
        });
        rt.on("close", (code: number, reason: string) => {
          isReady = false;
          isConnecting = false;
          logger.info({ code, reason }, "[AAI] Session closed");
        });
        rt.on("error", (err: any) => {
          // Prevent unhandled rejection crashes
          logger.error({ err }, "[AAI] Transcriber Error");
          isReady = false;
          isConnecting = false;
        });

        await rt.connect();
        logger.info("[AAI] Connected successfully");
      } catch (err) {
        logger.error({ err }, "[AAI] Error during connection");
        rt = null;
        isReady = false;
        isConnecting = false;
        throw err;
      }
    };

    const ensureTranscriber = async () => {
      if ((!rt || !isReady) && threadId && !isInterviewStarting) {
        logger.info(
          { threadId },
          "[AAI] Re-establishing transcriber session...",
        );
        try {
          await createAndConnectTranscriber();
        } catch (err) {
          logger.error({ err }, "[AAI] Failed to auto-reconnect transcriber");
        }
      }
    };

    const closeTranscriber = async () => {
      const transcriberToClose = rt;
      rt = null;
      isReady = false;
      isConnecting = false;

      if (transcriberToClose) {
        try {
          // If already closing or closed, this might throw but we catch it
          await transcriberToClose.close();
        } catch (e) {
          logger.debug(
            { err: e },
            "[AAI] Error during closeTranscriber (ignored)",
          );
        }
      }
      audioBuffer = Buffer.alloc(0);
      if (audioFlushTimeout) {
        clearTimeout(audioFlushTimeout);
        audioFlushTimeout = null;
      }
    };

    const sendConversationHistory = async () => {
      if (!threadId) return;
      try {
        const state = await graphApp.getState({
          configurable: { thread_id: threadId },
        });
        if (state?.values?.messages) {
          const existingMessages = state.values.messages.map((msg: any) => ({
            role: msg._getType(),
            text: msg.content,
          }));

          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: "history",
                messages: existingMessages,
              }),
            );
          }
        }
      } catch (err) {
        logger.error({ err }, "[HISTORY] Failed to load conversation history");
      }
    };

    // ---------- Message handler ----------

    ws.on("message", async (message: string) => {
      try {
        const rawData = JSON.parse(message);

        if (rawData.type === "start") {
          const result = wsStartSchema.safeParse(rawData);
          if (!result.success) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid start message payload",
              }),
            );
            return;
          }
          const data = result.data;

          if (isInterviewStarting) return;

          threadId = data.threadId;

          // Verify threadId belongs to authorized userId
          const interview = await Interview.findOne({ _id: threadId, userId });
          if (!interview) {
            logger.warn(
              { userId, threadId },
              "Unauthorized access attempt to thread",
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Unauthorized thread access",
              }),
            );
            ws.close(4003, "Forbidden");
            return;
          }

          isInterviewStarting = true;
          const resume = data.resume;
          const maxQuestions = data.numberOfQuestions;
          processedTurns.clear();
          logger.info({ threadId, userId, maxQuestions }, "[WS] Start request");

          try {
            logger.debug("[START] Invoking graph...");

            // Update status to in-progress
            await Interview.findByIdAndUpdate(threadId, {
              status: "in-progress",
            });
            logger.info({ threadId }, "Interview status set to in-progress");

            const result = (await invokeWithTimeout(
              graphApp.invoke(
                {
                  messages: [{ role: "user", content: "Start the interview." }],
                  resume,
                  maxQuestions,
                  interviewType: data.interviewType,
                  difficultyLevel: data.difficultyLevel,
                  jobTitle: data.jobTitle,
                  company: data.company,
                  customTopics: data.customTopics,
                  jobDescription: data.jobDescription,
                  companyStyle: data.companyStyle,
                },
                { configurable: { thread_id: threadId } },
              ),
              45000,
              "AI response timed out. Please try again.",
            )) as any;

            const aiText = (result.messages.at(-1) as any).content;
            logger.info(
              { threadId, aiTextLength: aiText?.length },
              "[START] AI Initial Response",
            );

            if (ws.readyState === ws.OPEN) {
              const codingInfo = parseCodingMode(aiText);

              if (codingInfo.isCoding) {
                logger.info(
                  { language: codingInfo.language },
                  "[START] Coding mode detected in initial response",
                );

                const preText = aiText.split(/\[CODING_MODE/i)[0].trim();
                if (preText) {
                  ws.send(JSON.stringify({ type: "text", content: preText }));
                }

                ws.send(
                  JSON.stringify({
                    type: "coding_question",
                    language: codingInfo.language,
                    questionText: codingInfo.questionText,
                    initialCode: "",
                  }),
                );
              } else {
                ws.send(
                  JSON.stringify({
                    type: "text",
                    content: aiText,
                    isFinished: !!result.isFinished,
                  }),
                );
              }

              if (result.isFinished) {
                await closeTranscriber();
              }
            }

            // Connect AssemblyAI streaming transcriber
            await createAndConnectTranscriber();
          } catch (err: any) {
            logger.error({ err }, "[START] Error during initialization");
            isInterviewStarting = false;
          }
        } else if (rawData.type === "pause") {
          // ---------- PAUSE handler ----------
          const result = wsPauseSchema.safeParse(rawData);
          if (!result.success) return;

          logger.info({ threadId, userId }, "[WS] Pause request");

          // Disconnect transcriber
          await closeTranscriber();

          // Update interview status
          if (threadId) {
            await Interview.findByIdAndUpdate(threadId, {
              status: "paused",
              elapsedSeconds: result.data.elapsedSeconds,
            });
          }

          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({ type: "paused", message: "Interview paused" }),
            );
          }
        } else if (rawData.type === "resume" && !threadId) {
          // ---------- RECONNECT RESUME handler (new WS connection to paused interview) ----------
          const result = wsResumeStartSchema.safeParse(rawData);
          if (!result.success || !result.data.threadId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid resume payload",
              }),
            );
            return;
          }

          threadId = result.data.threadId;

          // Verify ownership
          const interview = await Interview.findOne({ _id: threadId, userId });
          if (
            !interview ||
            (interview.status !== "paused" &&
              interview.status !== "in-progress")
          ) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Cannot resume: interview not found or not paused",
              }),
            );
            ws.close(4003, "Forbidden");
            return;
          }

          // Update status
          await Interview.findByIdAndUpdate(threadId, {
            status: "in-progress",
          });

          // Send existing conversation history
          await sendConversationHistory();

          // Connect transcriber
          try {
            await createAndConnectTranscriber();

            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "resumed",
                  message: "Interview resumed",
                }),
              );
            }

            logger.info(
              { threadId, userId },
              "[WS] Interview resumed via reconnect",
            );
          } catch (err) {
            logger.error({ err }, "[RESUME] Failed to reconnect transcriber");
            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Failed to resume transcription. Please try again.",
                }),
              );
            }
          }
        } else if (rawData.type === "resume" && threadId) {
          // ---------- MID-SESSION RESUME handler (same WS connection) ----------
          logger.info(
            { threadId, userId },
            "[WS] Resume request (mid-session)",
          );

          // Update interview status
          if (threadId) {
            await Interview.findByIdAndUpdate(threadId, {
              status: "in-progress",
            });
          }

          // Reconnect AssemblyAI transcriber
          try {
            await createAndConnectTranscriber();

            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "resumed",
                  message: "Interview resumed",
                }),
              );
            }
          } catch (err) {
            logger.error({ err }, "[RESUME] Failed to reconnect transcriber");
            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Failed to resume transcription. Please try again.",
                }),
              );
            }
          }
        } else if (rawData.type === "audio") {
          const result = wsAudioSchema.safeParse(rawData);
          if (!result.success) return;
          const data = result.data;

          // Auto-reconnect if needed
          await ensureTranscriber();

          if (rt && isReady) {
            try {
              let chunk = Buffer.from(data.chunk, "base64");

              if (
                chunk.length >= 44 &&
                chunk.slice(0, 4).toString() === "RIFF"
              ) {
                chunk = chunk.slice(44);
              }

              // Accumulate in buffer
              audioBuffer = Buffer.concat([audioBuffer, chunk]);

              const TARGET_SIZE = 8000;
              const MAX_SIZE = 32000;
              const MIN_SIZE = 1600;

              // Clear any pending flush
              if (audioFlushTimeout) {
                clearTimeout(audioFlushTimeout);
                audioFlushTimeout = null;
              }

              // Send full chunks
              while (audioBuffer.length >= TARGET_SIZE) {
                const chunkToSend = audioBuffer.slice(0, MAX_SIZE);
                rt.sendAudio(chunkToSend);
                audioBuffer = audioBuffer.slice(chunkToSend.length);
              }

              // If we have leftovers, set a timeout to flush them if no new audio arrives
              if (audioBuffer.length >= MIN_SIZE) {
                audioFlushTimeout = setTimeout(() => {
                  if (rt && isReady && audioBuffer.length >= MIN_SIZE) {
                    rt.sendAudio(audioBuffer);
                    audioBuffer = Buffer.alloc(0);
                  }
                }, 500); // 500ms wait before flushing tail
              }
            } catch (err: any) {
              if (err.message?.includes("Socket is not open")) {
                logger.debug(
                  "[AAI] Attempted to send audio to a closed session",
                );
                isReady = false;
              } else {
                logger.error({ err }, "[AAI] Error sending audio");
              }
            }
          }
        } else if (rawData.type === "code_submission") {
          const result = wsCodeSchema.safeParse(rawData);
          if (!result.success) return;

          logger.info({ threadId, userId }, "[WS] Code submission received");

          try {
            isProcessingTurn = true;

            const submitText = `I have submitted my code in ${result.data.language || "the requested language"}:\n\n\`\`\`\n${result.data.content}\n\`\`\``;

            const graphResult = (await invokeWithTimeout(
              graphApp.invoke(
                { messages: [{ role: "user", content: submitText }] },
                { configurable: { thread_id: threadId } },
              ),
              45000,
              "AI evaluation timed out.",
            )) as any;

            const aiEvaluation = extractAIResponse(graphResult.messages);

            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "text",
                  content: aiEvaluation,
                  isFinished: !!graphResult.isFinished,
                }),
              );
            }
          } catch (err: any) {
            logger.error({ err }, "[CODE_SUBMIT] Error");
          } finally {
            isProcessingTurn = false;
          }
        }
      } catch (err: any) {
        logger.error({ err }, "[WS] Error");
      }
    });

    ws.on("close", async () => {
      logger.info({ userId }, "WebSocket client disconnected");
      isInterviewStarting = false;

      await closeTranscriber();

      // If interview was in-progress when disconnected, auto-pause it
      if (threadId) {
        try {
          const interview = await Interview.findById(threadId);
          if (interview && interview.status === "in-progress") {
            await Interview.findByIdAndUpdate(threadId, { status: "paused" });
            logger.info({ threadId }, "Interview auto-paused on disconnect");
          }
        } catch (err) {
          logger.error({ err }, "[CLOSE] Failed to auto-pause interview");
        }
      }
    });

    ws.on("error", (err: any) => {
      logger.error({ err, userId }, "WebSocket error");
    });
  });
};
