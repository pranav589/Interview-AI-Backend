import { Request, Response } from "express";
import { env } from "../../config/env";
import { createModuleLogger } from "../../lib/logger";
import { MESSAGES } from "../../config/constants";
import { authService } from "../../services/auth.service";
import { 
  registerSchema, 
  loginSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema 
} from "../../validators/auth.validator";
import { asyncHandler } from "../../lib/asyncHandler";
import { ValidationError } from "../../lib/errors";
import { AuthenticatedRequest } from "../../types/express";

const logger = createModuleLogger("auth-controller");

const getCookieOptions = (req: Request, maxAge: number) => {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    path: "/",
    maxAge,
    secure: isProd,
    sameSite: "lax" as const,
    domain: isProd ? (env.COOKIE_DOMAIN || ".interviewai.in.net") : undefined,
  };
};

export const registerHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(MESSAGES.AUTH.INVALID_DATA);

  const user = await authService.register(
    result.data.name, 
    result.data.email, 
    result.data.password, 
    env.FRONTEND_URL
  );

  return res.status(201).json({
    success: true,
    message: MESSAGES.AUTH.REGISTER_SUCCESS,
    data: sanitizeUser(user),
  });
});

export const verifyEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) throw new ValidationError(MESSAGES.AUTH.TOKEN_MISSING);
  const result = await authService.verifyEmail(token);
  return res.json({
    success: true,
    message: result.message,
    data: null
  });
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(MESSAGES.AUTH.INVALID_DATA);

  const loginResult = await authService.login(
    result.data.email, 
    result.data.password, 
    result.data.twoFactorCode
  );

  if ("twoFactorRequired" in loginResult) {
    return res.status(200).json({
      success: true,
      message: MESSAGES.AUTH.TWO_FACTOR_REQUIRED,
      data: { twoFactorRequired: true },
    });
  }

  const { user, accessToken, refreshToken } = loginResult;
  setAuthCookies(res, req, accessToken, refreshToken);

  return res.status(200).json({
    success: true,
    message: MESSAGES.AUTH.LOGIN_SUCCESS,
    data: sanitizeUser(user),
  });
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new ValidationError(MESSAGES.AUTH.REFRESH_TOKEN_NOT_FOUND);

  const { user, accessToken, refreshToken } = await authService.refreshTokens(token);
  setAuthCookies(res, req, accessToken, refreshToken);

  return res.status(200).json({
    success: true,
    message: MESSAGES.AUTH.TOKEN_REFRESHED,
    data: sanitizeUser(user),
  });
});

export const logoutHandler = (req: Request, res: Response) => {
  const options = getCookieOptions(req, 0);
  res.clearCookie("refreshToken", options);
  res.clearCookie("accessToken", options);
  return res.status(200).json({
    success: true,
    message: MESSAGES.AUTH.LOGOUT_SUCCESS,
    data: null
  });
};

export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = forgotPasswordSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);

  await authService.forgotPassword(result.data.email, env.FRONTEND_URL);
  return res.json({
    success: true,
    message: MESSAGES.AUTH.RESET_LINK_SENT,
    data: null
  });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = resetPasswordSchema.safeParse(req.body);
  if (!result.success) throw new ValidationError(result.error.issues[0].message);

  await authService.resetPassword(result.data.token, result.data.password);
  return res.json({
    success: true,
    message: MESSAGES.AUTH.RESET_SUCCESS,
    data: null
  });
});

export const googleAuthStartHandler = (req: Request, res: Response) => {
  return res.redirect(authService.getGoogleAuthUrl());
};

export const googleAuthCallbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) throw new ValidationError(MESSAGES.AUTH.GOOGLE_AUTH_MISSING_CODE);

  const { user, accessToken, refreshToken } = await authService.handleGoogleCallback(code);
  setAuthCookies(res, req, accessToken, refreshToken);

  return res.redirect(`${env.FRONTEND_URL}/auth/callback?user=${encodeURIComponent(JSON.stringify(sanitizeUser(user)))}`);
});

export const twoFactorSetupHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user?.id;
  const { otpAuthUrl } = await authService.setupTwoFactor(userId!);
  return res.json({
    success: true,
    message: MESSAGES.AUTH.TWO_FACTOR_SETUP_INIT,
    data: { otpAuthUrl }
  });
});

export const twoFactorVerifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user?.id;
  const { code } = req.body;
  await authService.verifyTwoFactor(userId!, code);
  return res.json({
    success: true,
    message: MESSAGES.AUTH.TWO_FACTOR_ENABLED,
    data: { twoFactorEnabled: true }
  });
});

export const getWSTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user?.id;
  const { createTicket } = require("../../lib/ws-tickets");
  return res.json({
    success: true,
    message: MESSAGES.AUTH.WS_TICKET_GENERATED,
    data: { ticket: createTicket(userId) }
  });
});

// Helpers
function sanitizeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    hasResume: !!user.resume,
    subscriptionTier: user.subscriptionTier,
    credits: user.credits,
    onboardingCompleted: user.onboardingCompleted,
  };
}

function setAuthCookies(res: Response, req: Request, accessToken: string, refreshToken: string) {
  res.cookie("refreshToken", refreshToken, getCookieOptions(req, 7 * 24 * 60 * 60 * 1000));
  res.cookie("accessToken", accessToken, getCookieOptions(req, 1 * 60 * 60 * 1000));
}
