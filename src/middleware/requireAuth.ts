import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/token";
import { User } from "../models/user.model";
import { UnauthorizedError } from "../lib/errors";
import { asyncHandler } from "../lib/asyncHandler";
import { AuthenticatedRequest } from "../types/express";

const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token = "";

  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    throw new UnauthorizedError("Not authenticated.");
  }

  const payload = verifyAccessToken(token);

  const user = await User.findById(payload.sub);

  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (user.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedError("Token invalidated");
  }

  (req as AuthenticatedRequest).user = {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    role: user.role as "user" | "admin",
    isEmailVerified: user.isEmailVerified,
    hasResume: !!user.resume,
  };

  next();
});

export default requireAuth;
