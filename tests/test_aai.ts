import dotenv from "dotenv";
dotenv.config();
import { AssemblyAI } from "assemblyai";

try {
  const aai = new AssemblyAI({
    apiKey: process.env.ASSEMBLYAI_KEY || "",
  });

  const rt = aai.streaming.transcriber({
    sampleRate: 16000,
    formatTurns: true,
    // @ts-ignore
    model: "universal-streaming-english",
    maxEndOfTurnSilenceMs: 5000,
    minTurnSilence: 5000,
  });

  rt.on("error", (e) => {
    console.error("RT ERROR:", e);
  });

  rt.connect().catch((e) => {
    console.log("CONNECT CATCH:", e);
    console.log(e.stack);
  });
} catch (e) {
  console.log("SYNC CATCH:", e);
}
