import { NextFunction, Request, Response } from "express";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { AuthenticatedRequest } from "../types/express";
import { MESSAGES } from "../config/constants";

export function requireRole(role: "user" | "admin") {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser) {
      throw new UnauthorizedError(MESSAGES.SYSTEM.NOT_AUTHENTICATED);
    }

    if (authUser.role !== role) {
      throw new ForbiddenError(MESSAGES.SYSTEM.NOT_AUTHORIZED);
    }
    next();
  };
}
