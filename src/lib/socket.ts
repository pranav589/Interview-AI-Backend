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

export const setupWebSocket = (wss: WebSocketServer) => {
  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    let userId: string | null = null;

    try {
      // 1. Try Ticket Auth (Primary for cross-origin)
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const ticket = url.searchParams.get("ticket");

      if (ticket) {
        userId = validateTicket(ticket);
      }

      // 2. Try Cookie Auth (Fallback for same-origin)
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
    let isInterviewStarting = false;
    let processedTurns = new Set();
    let isProcessingTurn = false;

    // ---------- Extracted helpers ----------

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

          const aiText = (result.messages.at(-1) as any).content;
          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: "text",
                content: aiText,
                isFinished: !!result.isFinished,
              }),
            );

            if (result.isFinished && rt) {
              try {
                await rt.close();
              } catch (e) {
                /* ignore */
              }
              rt = null;
              isReady = false;
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
      rt = aai.streaming.transcriber({
        sampleRate: 16000,
        formatTurns: true,
        speechModel: "universal-streaming-english",
        minTurnSilence: 3000,
      });

      rt.on("turn", handleTranscriberTurn);
      rt.on("open", ({ id }: { id: string }) => {
        isReady = true;
        logger.info({ id }, "[AAI] Session started");
      });
      rt.on("close", (code: number, reason: string) => {
        isReady = false;
        logger.info({ code, reason }, "[AAI] Session closed");
      });
      rt.on("error", (err: any) => {
        logger.error({ err }, "[AAI] Transcriber Error");
        isReady = false;
      });

      await rt.connect();
      logger.info("[AAI] Connected successfully");
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
            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "text",
                  content: aiText,
                  isFinished: !!result.isFinished,
                }),
              );

              if (result.isFinished && rt) {
                try {
                  await rt.close();
                } catch (e) {
                  /* ignore */
                }
                rt = null;
                isReady = false;
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

          // Disconnect transcriber to stop billing
          if (rt) {
            try {
              await rt.close();
            } catch (e) {
              /* ignore */
            }
            rt = null;
            isReady = false;
          }

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

          if (rt && isReady) {
            let chunk = Buffer.from(data.chunk, "base64");

            if (chunk.length < 100) {
              logger.debug({ length: chunk.length, threadId }, "[WS] Received unusually small or empty audio chunk");
            }
            if (chunk.length >= 44 && chunk.slice(0, 4).toString() === "RIFF") {
              chunk = chunk.slice(44);
            }
            rt.sendAudio(chunk);
          }
        }
      } catch (err: any) {
        logger.error({ err }, "[WS] Error");
      }
    });

    ws.on("close", async () => {
      logger.info({ userId }, "WebSocket client disconnected");
      isInterviewStarting = false;

      if (rt) {
        try {
          await rt.close();
        } catch (e) {
          /* ignore */
        }
      }

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
