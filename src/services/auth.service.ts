import { User } from "../models/user.model";
import { checkPassword, hashPassword } from "./hash.service";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { sendEmail } from "../providers/email.provider";
import { createAccessToken, createRefreshToken } from "./token.service";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { generateSecret, generateURI, verify } from "otplib";
import { MESSAGES } from "../config/constants";
import { 
  NotFoundError, 
  ValidationError, 
  UnauthorizedError, 
  ForbiddenError, 
  AppError 
} from "../lib/errors";

export class AuthService {
  private googleClient: OAuth2Client | null = null;

  private getGoogleClient() {
    if (this.googleClient) return this.googleClient;
    
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const redirectUri = env.GOOGLE_REDIRECT_URL;

    if (!clientId || !clientSecret) {
      throw new Error(MESSAGES.AUTH.GOOGLE_CONFIG_MISSING);
    }

    this.googleClient = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
    });
    return this.googleClient;
  }

  async register(name: string, email: string, password: string, appUrl: string) {
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

    const verifyToken = jwt.sign(
      { sub: newUser.id },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "1d" }
    );

    const verifyUrl = `${appUrl}/auth/verify-email?token=${verifyToken}`;

    await sendEmail(
      newUser.email,
      MESSAGES.AUTH.VERIFY_EMAIL_SUBJECT,
      `
      <p>Please verify your email by clicking this link:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      `
    );

    return newUser;
  }

  async verifyEmail(token: string) {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
    const user = await User.findById(payload.sub);
    
    if (!user) {
      throw new NotFoundError(MESSAGES.AUTH.USER_NOT_FOUND);
    }

    if (user.isEmailVerified) {
      return { message: MESSAGES.AUTH.EMAIL_ALREADY_VERIFIED };
    }

    user.isEmailVerified = true;
    await user.save();
    return { message: MESSAGES.AUTH.EMAIL_VERIFIED_NOW };
  }

  async login(email: string, password: string, twoFactorCode?: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    const passwordCheck = await checkPassword(password, user.passwordHash);
    if (!passwordCheck) {
      throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenError(MESSAGES.AUTH.VERIFY_REQUIRED);
    }

    if (user.twoFactorEnabled) {
      if (!twoFactorCode) {
        return { twoFactorRequired: true };
      }

      if (!user.twoFactorSecret) {
        throw new AppError(MESSAGES.AUTH.TWO_FACTOR_MISCONFIGURED, 400);
      }

      const isValidCode = await verify({
        secret: user.twoFactorSecret,
        token: twoFactorCode,
      });

      if (!isValidCode.valid) {
        throw new ValidationError(MESSAGES.AUTH.TWO_FACTOR_INVALID);
      }
    }

    const accessToken = createAccessToken(user.id, user.role as any, user.tokenVersion);
    const refreshToken = createRefreshToken(user.id, user.tokenVersion);

    return { user, accessToken, refreshToken };
  }

  async refreshTokens(token: string) {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as any;
    const user = await User.findById(payload.sub);

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedError(MESSAGES.AUTH.INVALID_REFRESH_TOKEN);
    }

    const accessToken = createAccessToken(user.id, user.role as any, user.tokenVersion);
    const refreshToken = createRefreshToken(user.id, user.tokenVersion);

    return { user, accessToken, refreshToken };
  }

  async forgotPassword(email: string, appUrl: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) return; // Silent return for security

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resetUrl = `${appUrl}/auth/reset-password?token=${rawToken}`;

    await sendEmail(
      user.email,
      MESSAGES.AUTH.RESET_PASSWORD_SUBJECT,
      `
      <p>You requested for a password reset. Click on below link to reset password.</p>
      <p><a href=${resetUrl}>Reset Password</a></p>
      `
    );
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new ValidationError(MESSAGES.AUTH.INVALID_OR_EXPIRED_TOKEN);
    }

    user.passwordHash = await hashPassword(password);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.tokenVersion += 1;
    await user.save();
  }

  async setupTwoFactor(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError(MESSAGES.AUTH.USER_NOT_FOUND);

    const secret = generateSecret();
    const otpAuthUrl = generateURI({
      label: user.email,
      issuer: "InterviewAI",
      secret,
    });

    user.twoFactorSecret = secret;
    await user.save();
    return { otpAuthUrl };
  }

  async verifyTwoFactor(userId: string, code: string) {
    const user = await User.findById(userId);
    if (!user || !user.twoFactorSecret) {
      throw new ValidationError(MESSAGES.AUTH.TWO_FACTOR_REQUIRED_FIRST);
    }

    const isValid = await verify({
      secret: user.twoFactorSecret,
      token: code,
    });

    if (!isValid.valid) {
      throw new ValidationError(MESSAGES.AUTH.TWO_FACTOR_INVALID);
    }

    user.twoFactorEnabled = true;
    await user.save();
    return true;
  }

  getGoogleAuthUrl() {
    const client = this.getGoogleClient();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["openid", "email", "profile"],
    });
  }

  async handleGoogleCallback(code: string) {
    const client = this.getGoogleClient();
    const { tokens } = await client.getToken(code);
    
    if (!tokens.id_token) {
      throw new ValidationError(MESSAGES.AUTH.GOOGLE_AUTH_ID_TOKEN_MISSING);
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;
    const name = payload?.name;

    if (!email || !payload?.email_verified) {
      throw new ValidationError(MESSAGES.AUTH.GOOGLE_EMAIL_NOT_VERIFIED);
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString("hex");
      user = await User.create({
        email: normalizedEmail,
        passwordHash: await hashPassword(randomPassword),
        role: "user",
        isEmailVerified: true,
        twoFactorEnabled: false,
        name,
      });
    } else {
      let updated = false;
      if (!user.isEmailVerified) { user.isEmailVerified = true; updated = true; }
      if (!user.name && name) { user.name = name; updated = true; }
      if (updated) await user.save();
    }

    const accessToken = createAccessToken(user.id, user.role as any, user.tokenVersion);
    const refreshToken = createRefreshToken(user.id, user.tokenVersion);

    return { user, accessToken, refreshToken };
  }
}

export const authService = new AuthService();
