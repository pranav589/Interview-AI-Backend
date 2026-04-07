import { Request, Response, NextFunction } from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

/**
 * Wraps an async express route handler to catch errors and forward to next()
 */
export const asyncHandler = (fn: AsyncHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
