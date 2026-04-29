import { aai } from "./assemblyai.provider";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("transcription-provider");

export interface TranscriptionCallbacks {
  onTurn: (turn: any) => void;
  onOpen: (id: string) => void;
  onClose: (code: number, reason: string) => void;
  onError: (err: any) => void;
}

export class TranscriptionProvider {
  private rt: any = null;
  private isReady = false;
  private isConnecting = false;
  private minTurnSilence: number;

  constructor(minTurnSilence: number = 8000) {
    this.minTurnSilence = minTurnSilence;
  }

  async connect(callbacks: TranscriptionCallbacks) {
    if (this.rt || this.isConnecting || this.isReady) return;

    this.isConnecting = true;
    try {
      this.rt = aai.streaming.transcriber({
        sampleRate: 16000,
        formatTurns: true,
        speechModel: "universal-streaming-english",
        minTurnSilence: this.minTurnSilence,
      });

      this.rt.on("turn", callbacks.onTurn);
      this.rt.on("open", ({ id }: { id: string }) => {
        this.isReady = true;
        this.isConnecting = false;
        callbacks.onOpen(id);
      });
      this.rt.on("close", (code: number, reason: string) => {
        this.isReady = false;
        this.isConnecting = false;
        callbacks.onClose(code, reason);
      });
      this.rt.on("error", (err: any) => {
        this.isReady = false;
        this.isConnecting = false;
        callbacks.onError(err);
      });

      await this.rt.connect();
      logger.info("[AAI] Connected successfully");
    } catch (err) {
      logger.error({ err }, "[AAI] Error during connection");
      this.rt = null;
      this.isReady = false;
      this.isConnecting = false;
      throw err;
    }
  }

  sendAudio(chunk: Buffer) {
    if (this.rt && this.isReady) {
      this.rt.sendAudio(chunk);
    }
  }

  async close() {
    const transcriberToClose = this.rt;
    this.rt = null;
    this.isReady = false;
    this.isConnecting = false;

    if (transcriberToClose) {
      try {
        await transcriberToClose.close();
      } catch (e) {
        logger.debug({ err: e }, "[AAI] Error during close (ignored)");
      }
    }
  }

  get isSessionActive() {
    return this.isReady;
  }
}
