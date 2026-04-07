import z from "zod";

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
  email: z.email("Invalid email format"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
