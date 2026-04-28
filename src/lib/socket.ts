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

const PARTIAL_TEXT_BACKPRESSURE_THRESHOLD_BYTES = 512 * 1024; // 512KB
// AssemblyAI endpointing: set slightly above the UX silence window (6s),
// so short thinking pauses don't become end_of_turn.
const AAI_MIN_TURN_SILENCE_MS = 8000;

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

const activeConnections = new Map<string, WebSocket>();

const USER_SILENCE_WINDOW_MS = 6000;

function isLikelyMetaLeak(text: string) {
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

function stripMetadata(text: string): string {
  const metaKeys = ["isCodingMode", "isNewQuestion", "currentQuestionText", "isFinished"];
  let content = text;
  
  // Aggressively strip any key-value pairs that look like our metadata schema
  metaKeys.forEach(key => {
    const regex = new RegExp(`"?${key}"?\\s*:\\s*(true|false|"[^"]*"|'[^']*')[,\\s]*`, "gi");
    content = content.replace(regex, "");
  });

  // Cleanup potential leftover braces or stray commas
  return content.replace(/[\{\}]/g, "").trim();
}

function safeSend(
  ws: WebSocket,
  payload: unknown,
  options: { dropIfBackpressured?: boolean } = {},
) {
  if (ws.readyState !== ws.OPEN) return;
  if (options.dropIfBackpressured && ws.bufferedAmount > PARTIAL_TEXT_BACKPRESSURE_THRESHOLD_BYTES) {
    return;
  }
  ws.send(JSON.stringify(payload));
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

// parseCodingMode removed - using structured graph output instead


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
    let processedTurns = new Set<number>();
    const addToProcessedTurns = (turn: number) => {
      processedTurns.add(turn);
      if (processedTurns.size > 100) {
        // Simple trim: clear half the set if too large
        const array = Array.from(processedTurns);
        processedTurns = new Set(array.slice(50));
      }
    };
    let isProcessingTurn = false;
    let isAISpeaking = false;
    let aiSpeechTimer: NodeJS.Timeout | null = null;
    let lastNonFinalTurnAt = 0;
    let pendingFinalTimer: NodeJS.Timeout | null = null;
    let pendingFinal: { turnOrder: number; text: string } | null = null;
    let audioBuffer = Buffer.alloc(0);
    let audioFlushTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let isReconnecting = false;

    // ---------- Extracted helpers ----------

    const extractAIResponse = (messages: any[]) => {
      const aiMessages = [];
      
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const role =
          msg.role || msg.type || (msg._getType ? msg._getType() : "");

        // Only collect non-empty AI messages (skips tool calls)
        if ((role === "ai" || role === "assistant") && msg.content) {
          const rawContent =
            typeof msg.content === "string" ? msg.content : String(msg.content);
          
          if (isLikelyMetaLeak(rawContent)) continue;

          const content = stripMetadata(rawContent);
          if (content) {
            aiMessages.unshift(content);
          }
        } else if (role === "tool") {
          // Keep going through tool calls to find the actual response
          continue;
        } else {
          break;
        }
      }
      return aiMessages.join("\n\n").trim();
    };

    const handleTranscriberTurn = async (turn: any) => {
      // Ignore all transcription while AI is processing or speaking
      if (isProcessingTurn || isAISpeaking) return;

      const text = turn.transcript;
      if (!text) return;

      const turnOrder = turn.turn_order;
      const isFinal = turn.end_of_turn;

      if (ws.readyState !== ws.OPEN) return;

      if (!isFinal) {
        lastNonFinalTurnAt = Date.now();
        if (pendingFinalTimer) {
          clearTimeout(pendingFinalTimer);
          pendingFinalTimer = null;
          pendingFinal = null;
        }
        safeSend(ws, { type: "partial_text", content: text }, { dropIfBackpressured: true });
      } else {
        if (processedTurns.has(turnOrder)) return;
        if (pendingFinal?.turnOrder === turnOrder) return;

        logger.info({ turnOrder, textLength: text.length }, "[AAI] FINAL Turn received");
        safeSend(ws, { type: "user_text", content: text });

        if (isProcessingTurn) {
          logger.warn(
            `[FLOW] Already processing a turn, skipping graph for ${turnOrder}`,
          );
          return;
        }

        const silenceMs = lastNonFinalTurnAt
          ? Date.now() - lastNonFinalTurnAt
          : USER_SILENCE_WINDOW_MS;
        const remainingMs = Math.max(0, USER_SILENCE_WINDOW_MS - silenceMs);
        pendingFinal = { turnOrder, text };
        if (pendingFinalTimer) {
          clearTimeout(pendingFinalTimer);
          pendingFinalTimer = null;
        }

        pendingFinalTimer = setTimeout(async () => {
          const payload = pendingFinal;
          pendingFinal = null;
          pendingFinalTimer = null;
          if (!payload) return;
          if (processedTurns.has(payload.turnOrder)) return;

          try {
            isProcessingTurn = true;
            addToProcessedTurns(payload.turnOrder);
            logger.debug(
              { turnOrder: payload.turnOrder, waitedMs: remainingMs },
              "[FLOW] Triggering AI (silence gate)",
            );
            if (!graphApp) {
              throw new Error(
                "AI orchestrator is not initialized. Please retry in a moment.",
              );
            }
            const result = (await invokeWithTimeout(
              graphApp.invoke(
                { messages: [{ role: "user", content: payload.text }] },
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
              const isCodingResult = !!result.isCodingMode;
              if (isCodingResult) {
                logger.info(
                  { fromGraph: isCodingResult },
                  "[FLOW] Coding mode detected from structured output",
                );

                safeSend(ws, {
                  type: "coding_question",
                  language: "javascript", // Default for now, graph can provide language later
                  questionText: aiText,
                  initialCode: "",
                });
              } else {
                safeSend(ws, {
                  type: "text",
                  content: aiText,
                  isFinished: !!result.isFinished,
                  isCodingMode: isCodingResult,
                });
              }

              // Lock microphone while AI is assumed to be speaking
              isAISpeaking = true;
              if (aiSpeechTimer) clearTimeout(aiSpeechTimer);

              //  Dynamic safety fallback based on text length (approx 150ms per char + 5s buffer)
              const estimatedDuration = Math.min(
                30000,
                Math.max(5000, aiText.length * 150),
              );

              aiSpeechTimer = setTimeout(() => {
                isAISpeaking = false;
                logger.debug(
                  { estimatedDuration },
                  "[FLOW] AI speech auto-unlocked (safety timeout)",
                );
              }, estimatedDuration);

              if (result.isFinished) {
                await closeTranscriber();
              }
            }
          } catch (err: any) {
            logger.error({ err }, "[GRAPH] Error");
            isAISpeaking = false; // Emergency unlock
            if (ws.readyState === ws.OPEN) {
              safeSend(ws, {
                type: "error",
                message: err.message || "Failed to get AI response",
              });
            }
          } finally {
            isProcessingTurn = false;
          }
        }, remainingMs);
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
          minTurnSilence: AAI_MIN_TURN_SILENCE_MS,
        });

        rt.on("turn", handleTranscriberTurn);
        rt.on("open", ({ id }: { id: string }) => {
          isReady = true;
          isConnecting = false;
          reconnectAttempts = 0;
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
      if (
        (!rt || !isReady) &&
        threadId &&
        !isInterviewStarting &&
        !isReconnecting &&
        reconnectAttempts < MAX_RECONNECT_ATTEMPTS
      ) {
        isReconnecting = true;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
        
        logger.info(
          { threadId, reconnectAttempts, delay },
          `[AAI] Scheduling reconnect (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms`,
        );

        setTimeout(async () => {
          try {
            await createAndConnectTranscriber();
            reconnectAttempts = 0; // Reset on success (if reached rt.connect)
          } catch (err) {
            reconnectAttempts++;
            logger.error({ err }, "[AAI] Reconnect attempt failed");
          } finally {
            isReconnecting = false;
          }
        }, delay);
      }
    };

    const closeTranscriber = async () => {
      reconnectAttempts = 0; // Essential for subsequent resume attempts
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
        if (!graphApp) {
          throw new Error("AI orchestrator is not initialized. Please retry in a moment.");
        }
        const state = await graphApp.getState({
          configurable: { thread_id: threadId },
        });
        if (state?.values?.messages) {
          //  Filter out tool messages and empty content to avoid raw JSON in UI
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

          if (ws.readyState === ws.OPEN) {
            safeSend(ws, {
              type: "history",
              messages: existingMessages,
              isCodingMode: !!state.values.isCodingMode,
            });
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
            safeSend(ws, {
              type: "error",
              message: "Invalid start message payload",
            });
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

          // Concurrent session guard
          if (activeConnections.has(threadId)) {
            const existingSocket = activeConnections.get(threadId);
            if (existingSocket && existingSocket !== ws && existingSocket.readyState === WebSocket.OPEN) {
              logger.warn({ threadId }, "[WS] Closing existing concurrent session (start)");
              existingSocket.send(JSON.stringify({ 
                type: "error", 
                message: "Another session has been opened. This connection is being closed." 
              }));
              existingSocket.close();
            }
          }
          activeConnections.set(threadId, ws);

          isInterviewStarting = true;
          const resume = data.resume;
          const maxQuestions = data.numberOfQuestions;
          processedTurns.clear();
          logger.info({ threadId, userId, maxQuestions }, "[WS] Start request");

          try {
            logger.debug("[START] Invoking graph...");
            if (!graphApp) {
              throw new Error("AI orchestrator is not initialized. Please retry in a moment.");
            }

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
              const isCodingResult = !!result.isCodingMode;

              if (isCodingResult) {
                logger.info(
                  { fromGraph: isCodingResult },
                  "[START] Coding mode detected in initial response",
                );

                safeSend(ws, {
                  type: "coding_question",
                  language: "typescript",
                  questionText: stripMetadata(aiText),
                  initialCode: "",
                });
              } else {
                safeSend(ws, {
                  type: "text",
                  content: stripMetadata(aiText),
                  isFinished: !!result.isFinished,
                  isCodingMode: isCodingResult,
                });
              }

              if (result.isFinished) {
                await closeTranscriber();
              }
            }

            // Connect AssemblyAI streaming transcriber unless the graph produced a closing turn.
            if (!result.isFinished) {
              await createAndConnectTranscriber();
            }
          } catch (err: any) {
            logger.error({ err }, "[START] Error during initialization");
          } finally {
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
            safeSend(ws, {
              type: "error",
              message: "Invalid resume payload",
            });
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
            safeSend(ws, {
              type: "error",
              message: "Cannot resume: interview not found or not paused",
            });
            ws.close(4003, "Forbidden");
            return;
          }

          // Concurrent session guard
          if (activeConnections.has(threadId)) {
            const existingSocket = activeConnections.get(threadId);
            if (existingSocket && existingSocket !== ws && existingSocket.readyState === WebSocket.OPEN) {
              logger.warn({ threadId }, "[WS] Closing existing concurrent session (resume)");
              existingSocket.send(JSON.stringify({ 
                type: "error", 
                message: "Another session has been opened. This connection is being closed." 
              }));
              existingSocket.close();
            }
          }
          activeConnections.set(threadId, ws);

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
              safeSend(ws, {
                type: "resumed",
                message: "Interview resumed",
              });
            }

            logger.info(
              { threadId, userId },
              "[WS] Interview resumed via reconnect",
            );
          } catch (err) {
            logger.error({ err }, "[RESUME] Failed to reconnect transcriber");
            if (ws.readyState === ws.OPEN) {
              safeSend(ws, {
                type: "error",
                message: "Failed to resume transcription. Please try again.",
              });
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
              safeSend(ws, {
                type: "resumed",
                message: "Interview resumed",
              });
            }
          } catch (err) {
            logger.error({ err }, "[RESUME] Failed to reconnect transcriber");
            if (ws.readyState === ws.OPEN) {
              safeSend(ws, {
                type: "error",
                message: "Failed to resume transcription. Please try again.",
              });
            }
          }
        } else if (rawData.type === "audio") {
          const result = wsAudioSchema.safeParse(rawData);
          if (!result.success) return;
          const data = result.data;

          // Auto-reconnect if needed
          await ensureTranscriber();

          // Ignore user audio if AI is processing or speaking
          if (isProcessingTurn || isAISpeaking) {
            return;
          }

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
            if (!graphApp) {
              throw new Error("AI orchestrator is not initialized. Please retry in a moment.");
            }

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
              safeSend(ws, {
                type: "text",
                content: aiEvaluation,
                isFinished: !!graphResult.isFinished,
              });
            }

            if (graphResult.isFinished) {
              await closeTranscriber();
            }
          } catch (err: any) {
            logger.error({ err }, "[CODE_SUBMIT] Error");
            isAISpeaking = false; // Emergency unlock
          } finally {
            isProcessingTurn = false;
          }
        } else if (rawData.type === "speech_finished") {
          logger.debug("[FLOW] AI speech finished, unlocking microphone.");
          isAISpeaking = false;
          if (aiSpeechTimer) {
            clearTimeout(aiSpeechTimer);
            aiSpeechTimer = null;
          }
        }
      } catch (err: any) {
        logger.error({ err }, "[WS] Error");
      }
    });

    ws.on("close", async () => {
      if (threadId) {
        activeConnections.delete(threadId);
      }
      logger.info({ userId }, "WebSocket client disconnected");
      isInterviewStarting = false;

      if (pendingFinalTimer) {
        clearTimeout(pendingFinalTimer);
        pendingFinalTimer = null;
        pendingFinal = null;
      }
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
