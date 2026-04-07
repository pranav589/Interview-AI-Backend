import { AssemblyAI } from "assemblyai";
import { env } from "../config/env";

export const aai = new AssemblyAI({
  apiKey: env.ASSEMBLYAI_API_KEY,
});
