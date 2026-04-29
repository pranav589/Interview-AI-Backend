import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import * as cookie from "cookie";
import { createModuleLogger } from "./logger";
import { verifyAccessToken } from "../services/token.service";
import { User } from "../models/user.model";
import { Interview } from "../models/interview.model";
import { validateTicket } from "./ws-tickets";
import { TranscriptionProvider } from "../providers/transcription.provider";
import { orchestrationService } from "../services/orchestration.service";
import { 
  wsStartSchema, 
  wsAudioSchema, 
  wsPauseSchema, 
  wsResumeStartSchema 
} from "../validators/socket.validator";
import { MESSAGES } from "../config/constants";

const logger = createModuleLogger("socket");

const PARTIAL_TEXT_BACKPRESSURE_THRESHOLD_BYTES = 512 * 1024;
const USER_SILENCE_WINDOW_MS = 6000;
const activeConnections = new Map<string, WebSocket>();

export const setupWebSocket = (wss: WebSocketServer) => {
  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    let userId: string | null = null;
    let threadId: string | null = null;
    let transcriber = new TranscriptionProvider();
    
    // Turn Management State
    let isProcessingTurn = false;
    let isAISpeaking = false;
    let aiSpeechTimer: NodeJS.Timeout | null = null;
    let lastNonFinalTurnAt = 0;
    let pendingFinalTimer: NodeJS.Timeout | null = null;
    let pendingFinal: { turnOrder: number; text: string } | null = null;
    let processedTurns = new Set<number>();

    // Audio Buffering
    let audioBuffer = Buffer.alloc(0);

    try {
      userId = await authenticate(req);
      if (!userId) {
        ws.close(4001, "Unauthorized");
        return;
      }
      logger.info({ userId }, "WebSocket authenticated");
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

      try {
        isProcessingTurn = true;
        const response = await orchestrationService.processUserTurn(threadId!, text);
        
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

          // Silence Guard
          isAISpeaking = true;
          if (aiSpeechTimer) clearTimeout(aiSpeechTimer);
          const duration = Math.min(30000, Math.max(5000, response.aiText.length * 150));
          aiSpeechTimer = setTimeout(() => { isAISpeaking = false; }, duration);

          if (response.isFinished) await transcriber.close();
        }
      } catch (err: any) {
        logger.error({ err }, "[GRAPH] Error");
        isAISpeaking = false;
        safeSend({ type: "error", message: err.message || "AI failed" });
      } finally {
        isProcessingTurn = false;
      }
    };

    const transcriberCallbacks = {
      onTurn: (turn: any) => {
        if (isProcessingTurn || isAISpeaking) return;
        if (!turn.transcript) return;

        if (!turn.end_of_turn) {
          lastNonFinalTurnAt = Date.now();
          if (pendingFinalTimer) { clearTimeout(pendingFinalTimer); pendingFinalTimer = null; }
          safeSend({ type: "partial_text", content: turn.transcript }, { dropIfBackpressured: true });
        } else {
          logger.info({ turnOrder: turn.turn_order }, "[AAI] Final Turn");
          safeSend({ type: "user_text", content: turn.transcript });
          
          const silenceMs = lastNonFinalTurnAt ? Date.now() - lastNonFinalTurnAt : USER_SILENCE_WINDOW_MS;
          const wait = Math.max(0, USER_SILENCE_WINDOW_MS - silenceMs);
          
          if (pendingFinal) {
            pendingFinal.text = `${pendingFinal.text} ${turn.transcript}`.trim();
          } else {
            pendingFinal = { turnOrder: turn.turn_order, text: turn.transcript };
          }

          if (pendingFinalTimer) clearTimeout(pendingFinalTimer);
          
          pendingFinalTimer = setTimeout(() => {
            if (pendingFinal) handleAITurn(pendingFinal.text, pendingFinal.turnOrder);
            pendingFinal = null;
          }, wait);
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
            await Interview.findByIdAndUpdate(threadId, { status: "in-progress" });

            const startResponse = await orchestrationService.startInterview(threadId, result.data);
            safeSend({
              type: startResponse.isCodingMode ? "coding_question" : "text",
              content: startResponse.aiText, // for text type
              questionText: startResponse.aiText, // for coding type
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
            
            let chunk = Buffer.from(result.data.chunk, "base64");
            if (chunk.slice(0, 4).toString() === "RIFF") chunk = chunk.slice(44);
            
            transcriber.sendAudio(chunk);
            break;
          }

          case "pause": {
            const result = wsPauseSchema.safeParse(raw);
            if (!result.success) return;
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
            break;
          }
        }
      } catch (err) {
        logger.error({ err }, "WS Message Error");
      }
    });

    ws.on("close", () => {
      if (threadId) activeConnections.delete(threadId);
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
