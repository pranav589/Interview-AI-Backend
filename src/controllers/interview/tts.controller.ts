import { Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { EdgeTTS } from "node-edge-tts";
import { createModuleLogger } from "../../lib/logger";
import os from "os";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const logger = createModuleLogger("tts");

export const streamTTS = asyncHandler(async (req: Request, res: Response) => {
  const text = req.query.text as string;
  const voice = (req.query.voice as string) || "en-US-AriaNeural";

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  const tempFile = path.join(os.tmpdir(), `tts-${uuidv4()}.mp3`);

  let retries = 3;
  let delay = 1000;

  try {
    const tts = new EdgeTTS({
      voice: voice,
      lang: "en-US",
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    });

    while (retries > 0) {
      try {
        await tts.ttsPromise(text, tempFile);
        break;
      } catch (err: any) {
        retries--;
        if (retries === 0) throw err;

        logger.warn(
          { error: err.message, remainingRetries: retries },
          "TTS synthesis attempt failed, retrying...",
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    const audioBuffer = fs.readFileSync(tempFile);

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length,
      "Cache-Control": "public, max-age=3600",
    });

    res.send(audioBuffer);
  } catch (error) {
    logger.error({ error }, "TTS Synthesis failed after all retries");
    res.status(500).json({ error: "Failed to synthesize speech" });
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});
