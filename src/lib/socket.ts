import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import * as cookie from "cookie";
import { createModuleLogger } from "./logger";
import { verifyAccessToken } from "../services/token.service";
import { User } from "../models/user.model";
import { Interview } from "../models/interview.model";
import { RecruitmentJob } from "../models/recruitment-job.model";
import { validateTicket } from "./ws-tickets";
import { TranscriptionProvider } from "../providers/transcription.provider";
import { orchestrationService } from "../services/orchestration.service";
import { 
  wsStartSchema, 
  wsAudioSchema, 
  wsPauseSchema, 
  wsResumeStartSchema,
  wsCodeSchema,
  wsUserSpeakingSchema,
  wsUserSilentSchema,
} from "../validators/socket.validator";
import { MESSAGES } from "../config/constants";
import { sseManager } from "./sse";
import { env } from "../config/env";
import { graphApp } from "../utils/graph";
import { AIMessage } from "@langchain/core/messages";

const logger = createModuleLogger("socket");

const PARTIAL_TEXT_BACKPRESSURE_THRESHOLD_BYTES = 512 * 1024;
// This is a SHORT MERGE WINDOW, not a silence detector.
// AssemblyAI handles silence detection via minTurnSilence (3500ms).
// This only merges consecutive final turns emitted in quick succession by AssemblyAI.
// Target: AAI 3.5s + socket 2s = ~5.5s post-last-word lag — natural conversational beat.
const USER_SILENCE_WINDOW_MS = 1500;
// Max characters to accumulate before force-triggering AI turn
const MAX_PENDING_CHARS = 2000;
//  Heartbeat interval in ms
const HEARTBEAT_INTERVAL_MS = 30000;

const activeConnections = new Map<string, WebSocket>();
const userConnections = new Map<string, Set<WebSocket>>();

interface SessionState {
  isProcessingTurn: boolean;
  isAISpeaking: boolean;
  currentLLMTurnId: number;
  aiSpeechTimer: NodeJS.Timeout | null;
  pendingFinalTimer: NodeJS.Timeout | null;
  pendingFinal: { turnOrder: number; text: string } | null;
  processedTurns: Set<number>;
  candidateSilenceTimer: NodeJS.Timeout | null;
  silencePromptCount: number;
  audioAccumulator: Buffer;
  isProcessingCodeSubmission: boolean;
  cleanupTimeout: NodeJS.Timeout | null;
  lastUserSpeakingAt: number;
}

const sessionStates = new Map<string, SessionState>();

const getOrCreateSessionState = (tid: string): SessionState => {
  let state = sessionStates.get(tid);
  if (!state) {
    state = {
      isProcessingTurn: false,
      isAISpeaking: false,
      currentLLMTurnId: 0,
      aiSpeechTimer: null,
      pendingFinalTimer: null,
      pendingFinal: null,
      processedTurns: new Set<number>(),
      candidateSilenceTimer: null,
      silencePromptCount: 0,
      audioAccumulator: Buffer.alloc(0),
      isProcessingCodeSubmission: false,
      cleanupTimeout: null,
      lastUserSpeakingAt: 0,
    };
    sessionStates.set(tid, state);
  } else {
    if (state.cleanupTimeout) {
      clearTimeout(state.cleanupTimeout);
      state.cleanupTimeout = null;
    }
  }
  return state;
};

// Parse a WAV buffer and return the PCM payload by finding the 'data' sub-chunk.
// Handles non-standard headers with variable-length metadata chunks (e.g. LIST chunks).
function stripWavHeader(chunk: Buffer): Buffer {
  // Verify RIFF signature
  if (chunk.slice(0, 4).toString("ascii") !== "RIFF") return chunk;
  // Walk through sub-chunks after the 12-byte RIFF header
  let offset = 12;
  while (offset + 8 <= chunk.length) {
    const id = chunk.slice(offset, offset + 4).toString("ascii");
    const size = chunk.readUInt32LE(offset + 4);
    if (id === "data") {
      // Return PCM payload after the 8-byte sub-chunk header
      return chunk.slice(offset + 8);
    }
    offset += 8 + size;
  }
  // Fallback: strip standard 44-byte header
  return chunk.slice(44);
}

export const setupWebSocket = (wss: WebSocketServer) => {
  // Enable built-in WebSocket ping/pong heartbeat
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as WebSocket & { isAlive?: boolean };
      if (extWs.isAlive === false) {
        extWs.terminate();
        return;
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeatInterval));

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    //  Mark connection alive on pong
    (ws as any).isAlive = true;
    ws.on("pong", () => { (ws as any).isAlive = true; });

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const context = url.searchParams.get("context");
    if (context === "global_notifications") {
      logger.info("Global notification WebSocket rejected (redirected to SSE)");
      ws.close(1008, "Use SSE notifications instead of WebSocket");
      return;
    }

    let userId: string | null = null;
    let threadId: string | null = null;
    let transcriber = new TranscriptionProvider(
      env.ASSEMBLYAI_MIN_TURN_SILENCE_MS,
      env.ASSEMBLYAI_MAX_TURN_SILENCE_MS
    );
       let sessionState: SessionState | null = null;

    const resetCandidateSilenceTimer = () => {
      clearCandidateSilenceTimer();
      if (sessionState && !sessionState.isAISpeaking && !sessionState.isProcessingTurn) {
        sessionState.candidateSilenceTimer = setTimeout(() => {
          handleCandidateSilence();
        }, env.CANDIDATE_MAX_SILENCE_MS);
      }
    };

    const clearCandidateSilenceTimer = () => {
      if (sessionState && sessionState.candidateSilenceTimer) {
        clearTimeout(sessionState.candidateSilenceTimer);
        sessionState.candidateSilenceTimer = null;
      }
    };

    const handleCandidateSilence = async () => {
      if (!sessionState) return;
      sessionState.silencePromptCount++;
      if (sessionState.silencePromptCount === 1 || sessionState.silencePromptCount === 2) {
        logger.info(
          { silencePromptCount: sessionState.silencePromptCount },
          "[SILENCE] Candidate silence limit reached. Asking if they are still there."
        );
        sessionState.isAISpeaking = true;
        safeSend({
          type: "text",
          content: "Are you still there?",
          isFinished: false,
        });

        try {
          if (graphApp && threadId) {
            await graphApp.updateState(
              { configurable: { thread_id: threadId } },
              {
                messages: [
                  new AIMessage({
                    content: "Are you still there?",
                    additional_kwargs: { timestamp: new Date().toISOString() },
                  }),
                ],
              }
            );
          }
        } catch (err) {
          logger.error({ err }, "Failed to save 'Are you still there?' to graph state");
        }

        if (sessionState.aiSpeechTimer) clearTimeout(sessionState.aiSpeechTimer);
        const fallbackDuration = Math.min(60000, Math.max(30000, "Are you still there?".length * 50 + 10000));
        sessionState.aiSpeechTimer = setTimeout(() => {
          logger.warn("[GUARD] AI silence fallback timer fired");
          if (sessionState) {
            sessionState.isAISpeaking = false;
            resetCandidateSilenceTimer();
          }
        }, fallbackDuration);
      } else if (sessionState.silencePromptCount >= 3) {
        logger.info("[SILENCE] Third silence limit reached. Auto-ending interview.");
        sessionState.isAISpeaking = true;
        safeSend({
          type: "text",
          content: "I haven't heard a response, so I will end the interview now. Thank you for your time.",
          isFinished: true,
        });

        try {
          if (graphApp && threadId) {
            await graphApp.updateState(
              { configurable: { thread_id: threadId } },
              {
                messages: [
                  new AIMessage({
                    content: "I haven't heard a response, so I will end the interview now. Thank you for your time.",
                    additional_kwargs: { timestamp: new Date().toISOString() },
                  }),
                ],
              }
            );
          }
        } catch (err) {
          logger.error({ err }, "Failed to save auto-end message to graph state");
        }
        await transcriber.close();
      }
    };

    try {
      userId = await authenticate(req);
      if (!userId) {
        ws.close(4001, "Unauthorized");
        return;
      }
      logger.info({ userId }, "WebSocket authenticated");
      
      // Track user connections
      if (!userConnections.has(userId)) {
        userConnections.set(userId, new Set());
      }
      userConnections.get(userId)!.add(ws);
    } catch (err) {
      logger.error({ err }, "WS Auth Error");
      ws.close(4001, "Unauthorized");
      return;
    }

    const safeSend = (payload: any, options: { dropIfBackpressured?: boolean } = {}) => {
      if (ws.readyState !== ws.OPEN) return;
      if (options.dropIfBackpressured && ws.bufferedAmount > PARTIAL_TEXT_BACKPRESSURE_THRESHOLD_BYTES) return;
      ws.send(JSON.stringify(payload));
    };

    const handleAITurn = async (text: string, turnOrder: number) => {
      if (!sessionState) return;
      if (sessionState.processedTurns.has(turnOrder)) return;
      sessionState.processedTurns.add(turnOrder);

      sessionState.currentLLMTurnId++;
      const myTurnId = sessionState.currentLLMTurnId;
      clearCandidateSilenceTimer();
      sessionState.audioAccumulator = Buffer.alloc(0);

      try {
        sessionState.isProcessingTurn = true;
        safeSend({ type: "thinking" });
        const response = await orchestrationService.processUserTurn(threadId!, text);
        
        if (myTurnId !== sessionState.currentLLMTurnId) {
          logger.info({ turnOrder }, "[GUARD] AI turn cancelled during LLM processing, discarding response");
          return;
        }

        if (ws.readyState === ws.OPEN) {
          if (response.isCodingMode) {
            safeSend({
              type: "coding_question",
              language: "javascript",
              questionText: response.aiText,
              initialCode: "",
            });
          } else {
            safeSend({
              type: "text",
              content: response.aiText,
              isFinished: response.isFinished,
              isCodingMode: false,
            });
          }

          //  FALLBACK TIMER:
          // This is only a safety net — speech_finished (sent by client after audio drains) is
          // the authoritative signal. Formula: ~30ms/char (actual TTS playback speed at ~150wpm)
          // + 3000ms fixed overhead (TTS fetch + buffering). Max 45s, min 10s.
          // Previous formula used 80ms/char which caused 37s blocks on a 400-char response.
          sessionState.isAISpeaking = true;
          if (sessionState.aiSpeechTimer) clearTimeout(sessionState.aiSpeechTimer);
          const fallbackDuration = Math.min(60000, Math.max(30000, response.aiText.length * 50 + 10000));
          sessionState.aiSpeechTimer = setTimeout(() => {
            logger.warn("[GUARD] AI speech fallback timer fired — client may not have sent speech_finished");
            if (sessionState) {
              sessionState.isAISpeaking = false;
              resetCandidateSilenceTimer();
            }
          }, fallbackDuration);

          if (response.isFinished) await transcriber.close();
        }
      } catch (err: any) {
        logger.error({ err }, "[GRAPH] Error");
        if (sessionState) {
          sessionState.isAISpeaking = false;
          if (sessionState.aiSpeechTimer) { clearTimeout(sessionState.aiSpeechTimer); sessionState.aiSpeechTimer = null; }
        }
        safeSend({ type: "error", message: err.message || "AI failed" });
        resetCandidateSilenceTimer();
      } finally {
        if (sessionState) {
          sessionState.isProcessingTurn = false;
          sessionState.isProcessingCodeSubmission = false;
        }
      }
    };

    const transcriberCallbacks = {
      onTurn: (turn: any) => {
        if (!sessionState) return;
        if (sessionState.isAISpeaking) return;

        if (sessionState.isProcessingTurn) {
          if (sessionState.isProcessingCodeSubmission) {
            logger.info("[GUARD] User voice detected during code evaluation thinking phase. Ignoring VAD interrupt to preserve code submission.");
          } else {
            logger.info("[GUARD] User started speaking during AI thinking phase. Cancelling AI turn.");
            sessionState.currentLLMTurnId++;
            sessionState.isProcessingTurn = false;
            safeSend({ type: "interrupted" });
          }
        }

        if (!turn.transcript) return;
        sessionState.silencePromptCount = 0;
        resetCandidateSilenceTimer();

        if (!turn.end_of_turn) {
          safeSend({ type: "partial_text", content: turn.transcript }, { dropIfBackpressured: true });
        } else {
          logger.info({ turnOrder: turn.turn_order, transcript: turn.transcript.slice(0, 80) }, "[AAI] Final Turn");
          safeSend({ type: "user_text", content: turn.transcript });
          
          if (sessionState.pendingFinal) {
            const combined = `${sessionState.pendingFinal.text} ${turn.transcript}`.trim();
            sessionState.pendingFinal.text = combined;
          } else {
            sessionState.pendingFinal = { turnOrder: turn.turn_order, text: turn.transcript };
          }

          // If text has grown beyond threshold, fire immediately
          if (sessionState.pendingFinal && sessionState.pendingFinal.text.length >= MAX_PENDING_CHARS) {
            if (sessionState.pendingFinalTimer) clearTimeout(sessionState.pendingFinalTimer);
            logger.info({ chars: sessionState.pendingFinal.text.length }, "[GUARD] Pending text exceeded cap, firing immediately");
            const captured = sessionState.pendingFinal;
            sessionState.pendingFinal = null;
            handleAITurn(captured.text, captured.turnOrder);
            return;
          }

          if (sessionState.pendingFinalTimer) clearTimeout(sessionState.pendingFinalTimer);
          
          const timeSinceSpeechDetected = Date.now() - sessionState.lastUserSpeakingAt;
          if (sessionState.lastUserSpeakingAt > 0 && timeSinceSpeechDetected < 1200) {
            logger.info(
              { timeSinceSpeechDetected, text: turn.transcript },
              "[GUARD] User resumed speaking, suppressing AI turn timer trigger"
            );
            return;
          }

          sessionState.pendingFinalTimer = setTimeout(() => {
            if (sessionState && sessionState.pendingFinal) handleAITurn(sessionState.pendingFinal.text, sessionState.pendingFinal.turnOrder);
            if (sessionState) sessionState.pendingFinal = null;
          }, USER_SILENCE_WINDOW_MS);
        }
      },
      onOpen: (id: string) => logger.info({ id }, "[AAI] Connected"),
      onClose: (code: number, reason: string) => logger.info({ code, reason }, "[AAI] Closed"),
      onError: (err: any) => logger.error({ err }, "[AAI] Error")
    };

    ws.on("message", async (message: string) => {
      try {
        const raw = JSON.parse(message);
        switch (raw.type) {
          case "start": {
            const result = wsStartSchema.safeParse(raw);
            if (!result.success) return safeSend({ type: "error", message: MESSAGES.SOCKET.INVALID_PAYLOAD });
            
            threadId = result.data.threadId;
            if (!await checkOwnership(threadId, userId!)) return ws.close(4003);

            sessionState = getOrCreateSessionState(threadId);

            manageConcurrentSessions(threadId, ws);
            
            // Load interview and check for linked job to retrieve question bank and AI interviewer name
            const interview = await Interview.findById(threadId);
            let questionBankText = "";
            let aiInterviewerName = "";
            let isB2B = false;

            if (interview?.recruitmentJobId || interview?.employerId) {
              isB2B = true;
              if (interview.recruitmentJobId) {
                const job = await RecruitmentJob.findById(interview.recruitmentJobId);
                if (job) {
                  questionBankText = job.questionBankText || "";
                }
              }
              if (interview.employerId) {
                const employer = await User.findById(interview.employerId);
                if (employer) {
                  aiInterviewerName = employer.aiInterviewerName || "AI Assistant";
                }
              }
            } else if (interview) {
              const creator = await User.findById(interview.userId);
              if (creator) {
                aiInterviewerName = creator.aiInterviewerName || "AI Assistant";
              }
            }

            await Interview.findByIdAndUpdate(threadId, { status: "in-progress" });

            const startResponse = await orchestrationService.startInterview(threadId, {
              ...result.data,
              resume: interview?.resume || result.data.resume || "",
              questionBankText,
              aiInterviewerName,
              isB2B,
            });
            
            sessionState.isAISpeaking = true;
            if (sessionState.aiSpeechTimer) clearTimeout(sessionState.aiSpeechTimer);
            const fallbackDuration = Math.min(60000, Math.max(30000, startResponse.aiText.length * 50 + 10000));
            sessionState.aiSpeechTimer = setTimeout(() => {
              logger.warn("[GUARD] Start AI speech fallback timer fired — client may not have sent speech_finished");
              if (sessionState) {
                sessionState.isAISpeaking = false;
                resetCandidateSilenceTimer();
              }
            }, fallbackDuration);


            safeSend({
              type: startResponse.isCodingMode ? "coding_question" : "text",
              content: startResponse.aiText,
              questionText: startResponse.aiText,
              isFinished: startResponse.isFinished,
              language: "typescript",
              initialCode: ""
            });

            if (!startResponse.isFinished) await transcriber.connect(transcriberCallbacks);
            break;
          }

          case "audio": {
            const result = wsAudioSchema.safeParse(raw);
            if (!sessionState) return;
            if (!result.success || sessionState.isProcessingTurn || sessionState.isAISpeaking) return;
            
            if (!transcriber.isSessionActive) await transcriber.connect(transcriberCallbacks);
            
            //  Use proper WAV header parser instead of blind 44-byte slice
            const rawChunk = Buffer.from(result.data.chunk, "base64") as Buffer;
            const chunk = stripWavHeader(rawChunk);
            
            sessionState.audioAccumulator = Buffer.concat([sessionState.audioAccumulator, chunk]);
            const TARGET_CHUNK_SIZE = 3200; // 100ms at 16kHz mono 16-bit PCM
            while (sessionState.audioAccumulator.length >= TARGET_CHUNK_SIZE) {
              const chunkToSend = sessionState.audioAccumulator.subarray(0, TARGET_CHUNK_SIZE);
              sessionState.audioAccumulator = sessionState.audioAccumulator.subarray(TARGET_CHUNK_SIZE);
              transcriber.sendAudio(chunkToSend);
            }
            break;
          }

          case "pause": {
            const result = wsPauseSchema.safeParse(raw);
            if (!result.success) return;
            clearCandidateSilenceTimer();
            if (sessionState) sessionState.audioAccumulator = Buffer.alloc(0);
            await transcriber.close();
            await Interview.findByIdAndUpdate(threadId, { 
              status: "paused", 
              elapsedSeconds: result.data.elapsedSeconds 
            });
            safeSend({ type: "paused" });
            break;
          }

          case "resume": {
            const result = wsResumeStartSchema.safeParse(raw);
            if (!result.success) return;
            
            if (!threadId) {
              threadId = result.data.threadId!;
              if (!await checkOwnership(threadId, userId!)) return ws.close(4003);
              manageConcurrentSessions(threadId, ws);
            }

            sessionState = getOrCreateSessionState(threadId);

            await Interview.findByIdAndUpdate(threadId, { status: "in-progress" });
            const history = await orchestrationService.getConversationHistory(threadId);
            if (history) safeSend({ type: "history", ...history });
            
            await transcriber.connect(transcriberCallbacks);
            safeSend({ type: "resumed" });
            resetCandidateSilenceTimer();
            break;
          }

          // Client signals that AI audio finished playing — clear the guard immediately.
          // This is the authoritative signal; the heuristic timer above is only a fallback.
          case "speech_finished": {
            logger.info("[GUARD] Client confirmed AI speech finished");
            if (sessionState) {
              sessionState.isAISpeaking = false;
              if (sessionState.aiSpeechTimer) {
                clearTimeout(sessionState.aiSpeechTimer);
                sessionState.aiSpeechTimer = null;
              }
            }
            resetCandidateSilenceTimer();
            break;
          }

          case "user_speaking": {
            // User has resumed speaking after a silence gap.
            // Cancel any pending AI turn so we don't interrupt the candidate mid-thought.
            if (sessionState) {
              sessionState.lastUserSpeakingAt = Date.now();
              if (sessionState.pendingFinalTimer) {
                clearTimeout(sessionState.pendingFinalTimer);
                sessionState.pendingFinalTimer = null;
                logger.info(
                  { accumulatedText: sessionState.pendingFinal ? sessionState.pendingFinal.text.slice(0, 60) : "" },
                  "[GUARD] user_speaking received — paused pending AI turn, preserving text"
                );
              }
              sessionState.silencePromptCount = 0;
            }
            resetCandidateSilenceTimer();
            if (sessionState && sessionState.isProcessingTurn) {
              if (sessionState.isProcessingCodeSubmission) {
                logger.info("[GUARD] user_speaking received during code evaluation thinking phase. Ignoring VAD interrupt to preserve code submission.");
              } else {
                logger.info("[GUARD] user_speaking received during AI thinking phase. Cancelling AI turn.");
                sessionState.currentLLMTurnId++;
                sessionState.isProcessingTurn = false;
                safeSend({ type: "interrupted" });
              }
            }
            break;
          }

          case "user_silent": {
            const result = wsUserSilentSchema.safeParse(raw);
            if (!result.success) return;
            if (sessionState) {
              sessionState.lastUserSpeakingAt = 0;
            }
            break;
          }

          case "code_submission": {
            const result = wsCodeSchema.safeParse(raw);
            if (!result.success) return safeSend({ type: "error", message: MESSAGES.SOCKET.INVALID_PAYLOAD });

            if (!threadId || !sessionState) {
              return safeSend({ type: "error", message: "No active interview session found" });
            }

            logger.info({ threadId, language: result.data.language }, "Processing candidate code submission");
            
            const prompt = `Here is my code submission in ${result.data.language || "javascript"}:\n\n\`\`\`${result.data.language || "javascript"}\n${result.data.content}\n\`\`\``;
            
            sessionState.isProcessingCodeSubmission = true;

            // Trigger AI evaluation turn
            handleAITurn(prompt, Date.now());
            break;
          }
        }
      } catch (err) {
        logger.error({ err }, "WS Message Error");
      }
    });

    ws.on("close", () => {
      if (threadId) {
        activeConnections.delete(threadId);
        
        // Clean up session state or schedule for deletion
        const state = sessionStates.get(threadId);
        if (state) {
          if (state.aiSpeechTimer) clearTimeout(state.aiSpeechTimer);
          if (state.pendingFinalTimer) clearTimeout(state.pendingFinalTimer);
          if (state.candidateSilenceTimer) clearTimeout(state.candidateSilenceTimer);
          
          state.aiSpeechTimer = null;
          state.pendingFinalTimer = null;
          state.candidateSilenceTimer = null;
          
          // Schedule full state deletion after 5 minutes of inactivity (reconnect window)
          state.cleanupTimeout = setTimeout(() => {
            sessionStates.delete(threadId!);
            logger.info({ threadId }, "Cleaned up persistent session state due to inactivity");
          }, 5 * 60 * 1000);
        }
      }
      if (userId && userConnections.has(userId)) {
        userConnections.get(userId)!.delete(ws);
        if (userConnections.get(userId)!.size === 0) {
          userConnections.delete(userId);
        }
      }
      transcriber.close();
    });
  });
};

async function authenticate(req: IncomingMessage): Promise<string | null> {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const ticket = url.searchParams.get("ticket");
  if (ticket) return validateTicket(ticket);

  if (req.headers.cookie) {
    const cookies = cookie.parse(req.headers.cookie);
    if (cookies.accessToken) {
      const payload = verifyAccessToken(cookies.accessToken);
      const user = await User.findById(payload.sub);
      if (user && user.tokenVersion === payload.tokenVersion) return user.id;
    }
  }
  return null;
}

async function checkOwnership(threadId: string, userId: string): Promise<boolean> {
  const interview = await Interview.findOne({ _id: threadId, userId });
  return !!interview;
}

function manageConcurrentSessions(threadId: string, ws: WebSocket) {
  const existing = activeConnections.get(threadId);
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    existing.send(JSON.stringify({ type: "error", message: MESSAGES.SOCKET.CONCURRENT_SESSION }));
    existing.close();
  }
  activeConnections.set(threadId, ws);
}

export function notifyUser(userId: string, payload: any) {
  // Push real-time event to SSE streams
  sseManager.sendToUser(userId, payload);

  const sockets = userConnections.get(userId);
  if (sockets) {
    const message = JSON.stringify(payload);
    sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}
