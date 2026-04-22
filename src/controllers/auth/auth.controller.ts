import { Request, Response } from "express";
import { env } from "../../config/env";
import { createModuleLogger } from "../../lib/logger";
import { MESSAGES } from "../../config/constants";

const logger = createModuleLogger("auth");
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.schema";
import { User } from "../../models/user.model";
import { checkPassword, hashPassword } from "../../lib/hash";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../lib/email";
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} from "../../lib/token";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { generateSecret, generateURI, verify } from "otplib";
import { asyncHandler } from "../../lib/asyncHandler";
import { 
  NotFoundError, 
  ValidationError, 
  UnauthorizedError, 
  ForbiddenError, 
  AppError 
} from "../../lib/errors";
import { createTicket } from "../../lib/ws-tickets";
import { AuthenticatedRequest } from "../../types/express";



function getAppUrl() {
  return env.FRONTEND_URL;
}

function getGoogleClient() {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URL;

  if (!clientId || !clientSecret) {
    throw new Error("Google client id or client secret is not present");
  }

  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  });
}

export const registerHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(MESSAGES.AUTH.INVALID_DATA);
  }

  const { name, email, password } = result.data as {
    name: string;
    email: string;
    password: string;
  };

  const normalizedEmail = email.toLowerCase().trim();
  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    throw new AppError(MESSAGES.AUTH.EMAIL_EXISTS, 409);
  }

  const passwordHash = await hashPassword(password);

  const newUser = await User.create({
    email: normalizedEmail,
    passwordHash,
    role: "user",
    isEmailVerified: false,
    twoFactorEnabled: false,
    name,
  });

  //email verification to send to the user
  const verifyToken = jwt.sign(
    {
      sub: newUser.id,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: "1d",
    },
  );

  const verifyUrl = `${getAppUrl()}/auth/verify-email?token=${verifyToken}`;

  await sendEmail(
    newUser.email,
    MESSAGES.AUTH.VERIFY_EMAIL_SUBJECT,
    `
      <p>Please verify your email by clicking this link:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      `,
  );
  return res.status(201).json({
    message: "User registered",
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      isEmailVerified: newUser.isEmailVerified,
      hasResume: !!newUser.resume,
      subscriptionTier: newUser.subscriptionTier,
      credits: newUser.credits,
      onboardingCompleted: newUser.onboardingCompleted,
    },
  });
});

export const verifyEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;

  if (!token) {
    throw new ValidationError("Verification token is missing");
  }
  
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
    sub: string;
  };

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.isEmailVerified) {
    return res.json({
      message: "Email is already verified",
    });
  }

  user.isEmailVerified = true;
  await user.save();

  return res.json({
    message: "Email is verified!!",
  });
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(MESSAGES.AUTH.INVALID_DATA);
  }

  const { email, password, twoFactorCode } = result.data as {
    email: string;
    password: string;
    twoFactorCode: string;
  };
  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
  }

  const passwordCheck = await checkPassword(password, user.passwordHash);

  if (!passwordCheck) {
    throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
  }

  // if email is not verified, dont allow to login
  if (!user.isEmailVerified) {
    throw new ForbiddenError(MESSAGES.AUTH.VERIFY_REQUIRED);
  }

  if (user.twoFactorEnabled) {
    if (!twoFactorCode || typeof twoFactorCode !== "string") {
      return res.status(200).json({
        message: MESSAGES.AUTH.TWO_FACTOR_REQUIRED,
        twoFactorRequired: true,
      });
    }

    if (!user.twoFactorSecret) {
      throw new AppError(MESSAGES.AUTH.TWO_FACTOR_MISCONFIGURED, 400);
    }
    //verify the code using otplib
    const isValidCode = await verify({
      secret: user.twoFactorSecret,
      token: twoFactorCode,
    });

    if (!isValidCode.valid) {
      throw new ValidationError(MESSAGES.AUTH.TWO_FACTOR_INVALID);
    }
  }

  const accessToken = createAccessToken(
    user.id,
    user.role,
    user.tokenVersion,
  );

  const refreshToken = createRefreshToken(user.id, user.tokenVersion);

  const isProd = env.NODE_ENV === "production";

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: 1 * 60 * 60 * 1000, // 1 hour (token itself is 30m)
  });

  return res.status(200).json({
    message: MESSAGES.AUTH.LOGIN_SUCCESS,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      name: user.name,
      hasResume: !!user.resume,
      subscriptionTier: user.subscriptionTier,
      credits: user.credits,
      onboardingCompleted: user.onboardingCompleted,
    },
  });
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken as string | undefined;

  if (!token) {
    throw new UnauthorizedError(MESSAGES.AUTH.REFRESH_TOKEN_NOT_FOUND);
  }

  const payload = verifyRefreshToken(token);

  const user = await User.findById(payload.sub);

  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (user.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const newAccessToken = createAccessToken(
    user.id,
    user.role,
    user.tokenVersion,
  );

  const newRefreshToken = createRefreshToken(user.id, user.tokenVersion);

  const isProd = env.NODE_ENV === "production";

  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.cookie("accessToken", newAccessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: 1 * 60 * 60 * 1000, // 1 hour
  });

  return res.status(200).json({
    message: "Token refreshed",
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      name: user.name,
      hasResume: !!user.resume,
      subscriptionTier: user.subscriptionTier,
      credits: user.credits,
      onboardingCompleted: user.onboardingCompleted,
    },
  });
});

export const logoutHandler = (req: Request, res: Response) => {
  const isProd = env.NODE_ENV === "production";
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    domain: env.COOKIE_DOMAIN,
  };
  res.clearCookie("refreshToken", cookieOptions);
  res.clearCookie("accessToken", cookieOptions);
  return res.status(200).json({
    message: "Logged out",
  });
};

export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = forgotPasswordSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0].message);
  }

  const { email } = result.data;

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    return res.json({
      message:
        "If an account with this email exists, we will send you a reset link",
    });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  user.resetPasswordToken = tokenHash;
  user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); //15 mins
  await user.save();

  const resetUrl = `${getAppUrl()}/auth/reset-password?token=${rawToken}`;

  await sendEmail(
    user.email,
    MESSAGES.AUTH.RESET_PASSWORD_SUBJECT,
    `
      <p>
        You requested for a password reset. Click on below link to reset password.
      </p>
      <p>
        <a href=${resetUrl}>Reset Password</a>
      </p>
    `,
  );
  return res.json({
    message: MESSAGES.AUTH.RESET_LINK_SENT,
  });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = resetPasswordSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0].message);
  }

  const { token, password } = result.data;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordToken: tokenHash,
    resetPasswordExpires: { $gt: new Date() },
  });

  logger.debug({ user }, "Reset password user found");

  if (!user) {
    throw new ValidationError(MESSAGES.AUTH.INVALID_OR_EXPIRED_TOKEN);
  }

  const newPasswordHash = await hashPassword(password);
  user.passwordHash = newPasswordHash;

  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  user.tokenVersion = user.tokenVersion + 1;

  await user.save();

  return res.json({
    message: MESSAGES.AUTH.RESET_SUCCESS,
  });
});

export const googleAuthStartHandler = (req: Request, res: Response) => {
  const client = getGoogleClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", "email", "profile"],
  });
  // Since we have only backend as of now, we redirect
  return res.redirect(url);
};

export const googleAuthCallbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    throw new ValidationError(MESSAGES.AUTH.GOOGLE_AUTH_MISSING_CODE);
  }
  
  const client = getGoogleClient();

  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new ValidationError(MESSAGES.AUTH.GOOGLE_AUTH_ID_TOKEN_MISSING);
  }

  //verify id token and read use info
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const email = payload?.email;
  const nameFromGoogle = payload?.name;

  const emailVerified = payload?.email_verified;

  if (!email || !emailVerified) {
    throw new ValidationError(MESSAGES.AUTH.GOOGLE_EMAIL_NOT_VERIFIED);
  }

  const normalizedEmail = email.toLowerCase().trim();

  let user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    const randomPassword = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(randomPassword);

    user = await User.create({
      email: normalizedEmail,
      passwordHash,
      role: "user",
      isEmailVerified: true,
      twoFactorEnabled: false,
      name: nameFromGoogle,
    });
  } else {
    let updateNeeded = false;
    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      updateNeeded = true;
    }
    if (!user.name && nameFromGoogle) {
      user.name = nameFromGoogle;
      updateNeeded = true;
    }
    if (updateNeeded) {
      await user.save();
    }
  }

  const accessToken = createAccessToken(
    user.id,
    user.role as "user" | "admin",
    user.tokenVersion,
  );

  const refreshToken = createRefreshToken(user.id, user.tokenVersion);

  const isProd = env.NODE_ENV === "production";

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: 1 * 60 * 60 * 1000, // 1 hour
  });

  const frontendUrl = env.FRONTEND_URL;
  const userJson = JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    hasResume: !!user.resume,
    subscriptionTier: user.subscriptionTier,
    credits: user.credits,
    onboardingCompleted: user.onboardingCompleted,
  });

  return res.redirect(
    `${frontendUrl}/auth/callback?user=${encodeURIComponent(userJson)}`
  );
});

export const twoFactorSetupHandler = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;

  if (!authUser) {
    throw new UnauthorizedError("User not authenticated");
  }

  
  const user = await User.findById(authUser.id);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  const secret = generateSecret();
  const issuer = "NodeAuth";

  const otpAuthUrl = generateURI({
    label: user.email,
    issuer,
    secret,
  });

  user.twoFactorSecret = secret;

  await user.save();
  return res.json({
    message: "Two factor setup is done",
    otpAuthUrl,
  });
});

export const twoFactorVerifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const authUser = (req as AuthenticatedRequest).user;

  if (!authUser) {
    throw new UnauthorizedError("User not authenticated");
  }

  const { code } = req.body as { code?: string };

  if (!code) {
    throw new ValidationError("Two factor code is needed");
  }

  const user = await User.findById(authUser.id);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (!user.twoFactorSecret) {
    logger.debug("Inside two factor verify handler");
    throw new ValidationError("Please do two factor setup first.");
  }

  const isValid = await verify({
    secret: user.twoFactorSecret,
    token: code,
  });

  if (!isValid.valid) {
    throw new ValidationError("Invalid two factor code");
  }
  user.twoFactorEnabled = true;
  await user.save();

  return res.json({
    message: "Two Factor Enbaled Successfully",
    twoFactorEnabled: true,
  });
});

export const getWSTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user?.id;

  if (!userId) {
    throw new UnauthorizedError("Not authenticated");
  }


  const ticket = createTicket(userId);
  return res.json({ ticket });
});

