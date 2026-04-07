import { NextFunction, Request, Response } from "express";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { AuthenticatedRequest } from "../types/express";

export function requireRole(role: "user" | "admin") {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser) {
      throw new UnauthorizedError("User is not authenticated");
    }

    if (authUser.role !== role) {
      throw new ForbiddenError("User is not authorized to access this.");
    }
    next();
  };
}
