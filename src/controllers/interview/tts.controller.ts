import { Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { createModuleLogger } from "../../lib/logger";
import { env } from "../../config/env";
import { DeepgramClient } from "@deepgram/sdk";
import { Readable } from "stream";
import { WebSocket } from "ws";
import crypto from "crypto";
import { CHROMIUM_FULL_VERSION, TRUSTED_CLIENT_TOKEN, generateSecMsGecToken } from "node-edge-tts/dist/drm";

const logger = createModuleLogger("tts");

// In-memory LRU cache for repeated TTS phrases (greetings, transitions, etc.)
// Key: "text::voice", Value: MP3 Buffer
const TTS_CACHE_MAX = 50;
const ttsCache = new Map<string, Buffer>();

// Map to coalesce duplicate concurrent synthesis requests
const inFlightRequests = new Map<string, Promise<Buffer>>();

function getCachedTTS(key: string): Buffer | undefined {
  const val = ttsCache.get(key);
  if (val) {
    // Refresh recency (LRU): delete and re-insert
    ttsCache.delete(key);
    ttsCache.set(key, val);
  }
  return val;
}

function setCachedTTS(key: string, buf: Buffer): void {
  if (ttsCache.size >= TTS_CACHE_MAX) {
    // Evict the oldest (first) entry
    const firstKey = ttsCache.keys().next().value;
    if (firstKey) ttsCache.delete(firstKey);
  }
  ttsCache.set(key, buf);
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

async function synthesizeEdgeTTS(text: string, voice: string): Promise<Buffer> {
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
  
  const wsConnect = new WebSocket(wsUrl, {
    host: 'speech.platform.bing.com',
    origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    headers: {
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  return new Promise<Buffer>((resolve, reject) => {
    let timeout: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        wsConnect.close();
        reject(new Error('EdgeTTS synthesis timed out'));
      }, 10000); // 10s idle timeout
    };

    resetTimeout();

    wsConnect.on('open', () => {
      resetTimeout();
      wsConnect.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n
        {
          "context": {
            "synthesis": {
              "audio": {
                "metadataoptions": {
                  "sentenceBoundaryEnabled": "false",
                  "wordBoundaryEnabled": "true"
                },
                "outputFormat": "audio-24khz-48kbitrate-mono-mp3"
              }
            }
          }
        }
      `);

      const requestId = crypto.randomBytes(16).toString('hex');
      wsConnect.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
          <voice name="${voice}">
            <prosody rate="default" pitch="default" volume="default">
              ${escapeXml(text)}
            </prosody>
          </voice>
        </speak>`);
    });

    const audioChunks: Buffer[] = [];
    wsConnect.on('message', (data: Buffer, isBinary: boolean) => {
      resetTimeout();
      if (isBinary) {
        const separator = 'Path:audio\r\n';
        const index = data.indexOf(separator);
        if (index !== -1) {
          const audioData = data.subarray(index + separator.length);
          audioChunks.push(audioData);
        }
      } else {
        const message = data.toString();
        if (message.includes('Path:turn.end')) {
          wsConnect.close();
          if (timeout) clearTimeout(timeout);
          resolve(Buffer.concat(audioChunks));
        }
      }
    });

    wsConnect.on('close', (code, reason) => {
      if (timeout) clearTimeout(timeout);
      if (audioChunks.length > 0) {
        // Resolve with whatever audio we managed to synthesize
        resolve(Buffer.concat(audioChunks));
      } else {
        reject(new Error(`EdgeTTS WebSocket closed prematurely: ${code} ${reason}`));
      }
    });

    wsConnect.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}

export const streamTTS = asyncHandler(async (req: Request, res: Response) => {
  const text = req.query.text as string;
  const voice = (req.query.voice as string) || "en-US-AriaNeural";
  const stream = req.query.stream === "true";

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  const cacheKey = `${text}::${voice}`;

  // 1. Serve from cache if available — no TTS synthesis needed
  const cached = getCachedTTS(cacheKey);
  if (cached) {
    logger.debug({ chars: text.length }, "[TTS] Cache hit");
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": cached.length,
      "Cache-Control": "public, max-age=3600",
    });
    return res.send(cached);
  }

  // 2. Optional: Stream directly from Deepgram if requested
  if (stream && env.DEEPGRAM_API_KEY) {
    try {
      const model = voice.startsWith("aura-") ? voice : "aura-asteria-en";
      logger.info({ textLength: text.length, model }, "[TTS] Streaming Deepgram synthesis");

      const deepgram = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });
      const result = await deepgram.speak.v1.audio.generate({
        text,
        model,
      });

      const webStream = result.stream();
      if (!webStream) {
        throw new Error("Deepgram synthesis did not return a stream");
      }

      const nodeStream = Readable.fromWeb(webStream as any);
      res.set({
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      });

      // Collect audio chunks to cache them for future non-streaming/streaming requests
      const audioChunks: Buffer[] = [];
      nodeStream.on("data", (chunk) => {
        audioChunks.push(chunk as Buffer);
      });
      nodeStream.on("end", () => {
        const fullBuffer = Buffer.concat(audioChunks);
        if (fullBuffer.length > 0) {
          setCachedTTS(cacheKey, fullBuffer);
        }
      });

      nodeStream.pipe(res);
      return;
    } catch (deepgramError: any) {
      logger.warn(
        { error: deepgramError.message },
        "[TTS] Deepgram streaming failed, falling back to buffered logic...",
      );
    }
  }

  let audioBuffer: Buffer | null = null;

  // 3. Coalesce concurrent duplicate requests
  let inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    logger.info({ chars: text.length }, "[TTS] Coalescing concurrent request");
    try {
      audioBuffer = await inFlight;
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Synthesis failed" });
    }
  } else {
    // Start the synthesis and store the promise
    const synthesisPromise = (async () => {
      let buffer: Buffer | null = null;

      // Option 1: Deepgram TTS (if API key is available)
      if (env.DEEPGRAM_API_KEY) {
        try {
          const model = voice.startsWith("aura-") ? voice : "aura-asteria-en";
          logger.info({ textLength: text.length, model }, "[TTS] Requesting Deepgram synthesis via SDK");

          const deepgram = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });
          const result = await deepgram.speak.v1.audio.generate({
            text,
            model,
          });

          const webStream = result.stream();
          if (!webStream) {
            throw new Error("Deepgram synthesis did not return a stream");
          }

          const nodeStream = Readable.fromWeb(webStream as any);
          const audioChunks: Buffer[] = [];
          for await (const chunk of nodeStream) {
            audioChunks.push(chunk as Buffer);
          }
          buffer = Buffer.concat(audioChunks);
        } catch (deepgramError: any) {
          logger.warn(
            { error: deepgramError.message },
            "[TTS] Deepgram synthesis failed, falling back to EdgeTTS...",
          );
        }
      }

      // Option 2: Fallback to EdgeTTS
      if (!buffer) {
        let retries = 3;
        while (retries > 0) {
          try {
            buffer = await synthesizeEdgeTTS(text, voice);
            break;
          } catch (error: any) {
            retries--;
            if (retries === 0) {
              throw error;
            }
            logger.warn(
              { error: error.message, remainingRetries: retries },
              "[TTS] EdgeTTS synthesis attempt failed, retrying...",
            );
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }

      if (!buffer || buffer.length === 0) {
        throw new Error("TTS synthesis returned empty buffer");
      }

      return buffer;
    })();

    inFlightRequests.set(cacheKey, synthesisPromise);

    try {
      audioBuffer = await synthesisPromise;
      setCachedTTS(cacheKey, audioBuffer);
    } catch (error: any) {
      logger.error({ error: error.message }, "[TTS] Synthesis failed");
      return res.status(500).json({ error: error.message || "TTS synthesis failed" });
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  }

  if (audioBuffer && audioBuffer.length > 0) {
    // Send complete response with Content-Length header
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length,
      "Cache-Control": "public, max-age=3600",
    });
    return res.send(audioBuffer);
  } else {
    return res.status(500).json({ error: "TTS synthesis returned empty buffer" });
  }
});
