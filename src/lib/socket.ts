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
} from "../validators/socket.validator";
import { MESSAGES } from "../config/constants";
import { sseManager } from "./sse";
import { env } from "../config/env";

const logger = createModuleLogger("socket");

const PARTIAL_TEXT_BACKPRESSURE_THRESHOLD_BYTES = 512 * 1024;
// This is a SHORT MERGE WINDOW, not a silence detector.
// AssemblyAI handles silence detection via minTurnSilence (3500ms).
// This only merges consecutive final turns emitted in quick succession by AssemblyAI.
// Target: AAI 3.5s + socket 2s = ~5.5s post-last-word lag — natural conversational beat.
const USER_SILENCE_WINDOW_MS = 2000;
// Max characters to accumulate before force-triggering AI turn
const MAX_PENDING_CHARS = 2000;
//  Heartbeat interval in ms
const HEARTBEAT_INTERVAL_MS = 30000;

const activeConnections = new Map<string, WebSocket>();
const userConnections = new Map<string, Set<WebSocket>>();

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
    
    // Turn Management State
    let isProcessingTurn = false;
    let isAISpeaking = false;
    let currentLLMTurnId = 0;
    let aiSpeechTimer: NodeJS.Timeout | null = null;
    let pendingFinalTimer: NodeJS.Timeout | null = null;
    let pendingFinal: { turnOrder: number; text: string } | null = null;
    let processedTurns = new Set<number>();

    let candidateSilenceTimer: NodeJS.Timeout | null = null;
    let silencePromptCount = 0;
    let audioAccumulator = Buffer.alloc(0);

    const resetCandidateSilenceTimer = () => {
      clearCandidateSilenceTimer();
      if (!isAISpeaking && !isProcessingTurn) {
        candidateSilenceTimer = setTimeout(() => {
          handleCandidateSilence();
        }, env.CANDIDATE_MAX_SILENCE_MS);
      }
    };

    const clearCandidateSilenceTimer = () => {
      if (candidateSilenceTimer) {
        clearTimeout(candidateSilenceTimer);
        candidateSilenceTimer = null;
      }
    };

    const handleCandidateSilence = async () => {
      silencePromptCount++;
      if (silencePromptCount === 1 || silencePromptCount === 2) {
        logger.info(
          { silencePromptCount },
          "[SILENCE] Candidate silence limit reached. Asking if they are still there."
        );
        isAISpeaking = true;
        safeSend({
          type: "text",
          content: "Are you still there?",
          isFinished: false,
        });

        if (aiSpeechTimer) clearTimeout(aiSpeechTimer);
        const fallbackDuration = Math.min(60000, Math.max(30000, "Are you still there?".length * 50 + 10000));
        aiSpeechTimer = setTimeout(() => {
          logger.warn("[GUARD] AI silence fallback timer fired");
          isAISpeaking = false;
          resetCandidateSilenceTimer();
        }, fallbackDuration);
      } else if (silencePromptCount >= 3) {
        logger.info("[SILENCE] Third silence limit reached. Auto-ending interview.");
        isAISpeaking = true;
        safeSend({
          type: "text",
          content: "I haven't heard a response, so I will end the interview now. Thank you for your time.",
          isFinished: true,
        });
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
      if (processedTurns.has(turnOrder)) return;
      processedTurns.add(turnOrder);

      currentLLMTurnId++;
      const myTurnId = currentLLMTurnId;
      clearCandidateSilenceTimer();
      audioAccumulator = Buffer.alloc(0);

      try {
        isProcessingTurn = true;
        safeSend({ type: "thinking" });
        const response = await orchestrationService.processUserTurn(threadId!, text);
        
        if (myTurnId !== currentLLMTurnId) {
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
          isAISpeaking = true;
          if (aiSpeechTimer) clearTimeout(aiSpeechTimer);
          const fallbackDuration = Math.min(60000, Math.max(30000, response.aiText.length * 50 + 10000));
          aiSpeechTimer = setTimeout(() => {
            logger.warn("[GUARD] AI speech fallback timer fired — client may not have sent speech_finished");
            isAISpeaking = false;
            resetCandidateSilenceTimer();
          }, fallbackDuration);

          if (response.isFinished) await transcriber.close();
        }
      } catch (err: any) {
        logger.error({ err }, "[GRAPH] Error");
        isAISpeaking = false;
        if (aiSpeechTimer) { clearTimeout(aiSpeechTimer); aiSpeechTimer = null; }
        safeSend({ type: "error", message: err.message || "AI failed" });
        resetCandidateSilenceTimer();
      } finally {
        isProcessingTurn = false;
      }
    };

    const transcriberCallbacks = {
      onTurn: (turn: any) => {
        if (isAISpeaking) return;

        if (isProcessingTurn) {
          logger.info("[GUARD] User started speaking during AI thinking phase. Cancelling AI turn.");
          currentLLMTurnId++;
          isProcessingTurn = false;
          safeSend({ type: "interrupted" });
        }

        if (!turn.transcript) return;
        silencePromptCount = 0;
        resetCandidateSilenceTimer();

        if (!turn.end_of_turn) {
          safeSend({ type: "partial_text", content: turn.transcript }, { dropIfBackpressured: true });
        } else {
          logger.info({ turnOrder: turn.turn_order, transcript: turn.transcript.slice(0, 80) }, "[AAI] Final Turn");
          safeSend({ type: "user_text", content: turn.transcript });
          
          if (pendingFinal) {
            const combined = `${pendingFinal.text} ${turn.transcript}`.trim();
            pendingFinal.text = combined;
          } else {
            pendingFinal = { turnOrder: turn.turn_order, text: turn.transcript };
          }

          // If text has grown beyond threshold, fire immediately
          if (pendingFinal && pendingFinal.text.length >= MAX_PENDING_CHARS) {
            if (pendingFinalTimer) clearTimeout(pendingFinalTimer);
            logger.info({ chars: pendingFinal.text.length }, "[GUARD] Pending text exceeded cap, firing immediately");
            const captured = pendingFinal;
            pendingFinal = null;
            handleAITurn(captured.text, captured.turnOrder);
            return;
          }

          if (pendingFinalTimer) clearTimeout(pendingFinalTimer);
          
          pendingFinalTimer = setTimeout(() => {
            if (pendingFinal) handleAITurn(pendingFinal.text, pendingFinal.turnOrder);
            pendingFinal = null;
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
            }

            await Interview.findByIdAndUpdate(threadId, { status: "in-progress" });

            const startResponse = await orchestrationService.startInterview(threadId, {
              ...result.data,
              resume: interview?.resume || result.data.resume || "",
              questionBankText,
              aiInterviewerName,
              isB2B,
            });
            
            // Set isAISpeaking = true when the first question is sent to the client.
            // This prevents any early audio chunks (from network transit or client reconnect/cache)
            // from triggering a double reply.
            isAISpeaking = true;
            if (aiSpeechTimer) clearTimeout(aiSpeechTimer);
            const fallbackDuration = Math.min(60000, Math.max(30000, startResponse.aiText.length * 50 + 10000));
            aiSpeechTimer = setTimeout(() => {
              logger.warn("[GUARD] Start AI speech fallback timer fired — client may not have sent speech_finished");
              isAISpeaking = false;
              resetCandidateSilenceTimer();
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
            if (!result.success || isProcessingTurn || isAISpeaking) return;
            
            if (!transcriber.isSessionActive) await transcriber.connect(transcriberCallbacks);
            
            //  Use proper WAV header parser instead of blind 44-byte slice
            const rawChunk = Buffer.from(result.data.chunk, "base64") as Buffer;
            const chunk = stripWavHeader(rawChunk);
            
            audioAccumulator = Buffer.concat([audioAccumulator, chunk]);
            const TARGET_CHUNK_SIZE = 3200; // 100ms at 16kHz mono 16-bit PCM
            while (audioAccumulator.length >= TARGET_CHUNK_SIZE) {
              const chunkToSend = audioAccumulator.subarray(0, TARGET_CHUNK_SIZE);
              audioAccumulator = audioAccumulator.subarray(TARGET_CHUNK_SIZE);
              transcriber.sendAudio(chunkToSend);
            }
            break;
          }

          case "pause": {
            const result = wsPauseSchema.safeParse(raw);
            if (!result.success) return;
            clearCandidateSilenceTimer();
            audioAccumulator = Buffer.alloc(0);
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
            isAISpeaking = false;
            if (aiSpeechTimer) {
              clearTimeout(aiSpeechTimer);
              aiSpeechTimer = null;
            }
            resetCandidateSilenceTimer();
            break;
          }

          case "user_speaking": {
            // User has resumed speaking after a silence gap.
            // Cancel any pending AI turn so we don't interrupt the candidate mid-thought.
            if (pendingFinalTimer) {
              clearTimeout(pendingFinalTimer);
              pendingFinalTimer = null;
              logger.info(
                { accumulatedText: pendingFinal ? pendingFinal.text.slice(0, 60) : "" },
                "[GUARD] user_speaking received — paused pending AI turn, preserving text"
              );
            }
            silencePromptCount = 0;
            resetCandidateSilenceTimer();
            if (isProcessingTurn) {
              logger.info("[GUARD] user_speaking received during AI thinking phase. Cancelling AI turn.");
              currentLLMTurnId++;
              isProcessingTurn = false;
              safeSend({ type: "interrupted" });
            }
            break;
          }

          case "code_submission": {
            const result = wsCodeSchema.safeParse(raw);
            if (!result.success) return safeSend({ type: "error", message: MESSAGES.SOCKET.INVALID_PAYLOAD });

            if (!threadId) {
              return safeSend({ type: "error", message: "No active interview session found" });
            }

            logger.info({ threadId, language: result.data.language }, "Processing candidate code submission");
            
            const prompt = `Here is my code submission in ${result.data.language || "javascript"}:\n\n\`\`\`${result.data.language || "javascript"}\n${result.data.content}\n\`\`\``;
            
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
      if (threadId) activeConnections.delete(threadId);
      if (userId && userConnections.has(userId)) {
        userConnections.get(userId)!.delete(ws);
        if (userConnections.get(userId)!.size === 0) {
          userConnections.delete(userId);
        }
      }
      if (aiSpeechTimer) clearTimeout(aiSpeechTimer);
      if (pendingFinalTimer) clearTimeout(pendingFinalTimer);
      clearCandidateSilenceTimer();
      audioAccumulator = Buffer.alloc(0);
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
