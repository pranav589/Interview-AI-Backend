import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/token";
import { User } from "../models/user.model";
import { UnauthorizedError } from "../lib/errors";
import { MESSAGES } from "../config/constants";
import { asyncHandler } from "../lib/asyncHandler";
import { AuthenticatedRequest } from "../types/express";

const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token = "";

  // Check Authorization header first (for server-side RSC calls)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  // Fallback: browser cookie (for client-side calls)
  if (!token && req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    throw new UnauthorizedError(MESSAGES.AUTH.NOT_AUTHENTICATED);
  }


  const payload = verifyAccessToken(token);

  const user = await User.findById(payload.sub);

  if (!user) {
    throw new UnauthorizedError(MESSAGES.AUTH.USER_NOT_FOUND);
  }

  if (user.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedError(MESSAGES.AUTH.TOKEN_INVALIDATED);
  }

  (req as AuthenticatedRequest).user = {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    role: user.role as "user" | "admin",
    isEmailVerified: user.isEmailVerified,
    hasResume: !!user.resume,
    subscriptionTier: user.subscriptionTier,
    credits: user.credits,
  };

  next();
});

export default requireAuth;
