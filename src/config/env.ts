import { z } from "zod";
import dotenv from "dotenv";
import { logger } from "../lib/logger";
import path from "path";

// Load .env file
dotenv.config();

const envSchema = z.object({
  // Required vars
  MONGO_URI: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  ASSEMBLYAI_API_KEY: z.string().min(1),
  EMAIL_USER: z.string().min(1),
  EMAIL_PASS: z.string().min(1),
  FRONTEND_URL: z.string().url(),

  // Optional/Other vars (based on .env)
  PORT: z
    .string()
    .default("3001")
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // SMTP Config (if they want to keep host/port)
  SMTP_HOST: z.string().default("sandbox.smtp.mailtrap.io"),
  SMTP_PORT: z
    .string()
    .default("587")
    .transform((val) => parseInt(val, 10)),
  EMAIL_FROM: z.string().default('"My App <no-reply@myapp.com>"'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URL: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(), // Fallback LLM (Gemini)
  GROQ_API_KEY: z.string().optional(), // Fallback LLM (Groq)
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error("❌ Invalid environment variables:");
  _env.error.issues.forEach((issue) => {
    logger.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = _env.data;
