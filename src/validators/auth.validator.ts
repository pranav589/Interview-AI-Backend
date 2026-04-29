import z from "zod";
import { MESSAGES } from "../config/constants";

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  name: z.string().min(3),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  twoFactorCode: z.string().optional(),
});
export const forgotPasswordSchema = z.object({
  email: z.email(MESSAGES.AUTH.INVALID_EMAIL),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, MESSAGES.AUTH.RESET_TOKEN_REQUIRED),
  password: z.string().min(6, MESSAGES.AUTH.PASSWORD_MIN_LENGTH),
});
