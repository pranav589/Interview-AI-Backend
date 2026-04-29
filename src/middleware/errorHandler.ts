import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { createModuleLogger } from "../lib/logger";
import { MESSAGES } from "../config/constants";
import { env } from "../config/env";

const logger = createModuleLogger("error-handler");

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  let error = err;

  // Normalize specific authentication errors to 401
  if (err.name === "TokenExpiredError") {
    error = new AppError(MESSAGES.AUTH.TOKEN_EXPIRED, 401);
  } else if (err.name === "JsonWebTokenError") {
    error = new AppError(MESSAGES.AUTH.NOT_AUTHENTICATED, 401);
  }

  error.statusCode = error.statusCode || 500;
  error.status = error.status || "error";

  // Development: full stack, clean messages
  if (env.NODE_ENV === "development") {
    sendDevError(error, res);
  } else {
    // Production: handle specific error types (Mongoose, etc)
    let prodError = error;

    if (err.name === "CastError") {
      prodError = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
    }

    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((el: any) => el.message);
      prodError = new AppError(
        `Invalid input data: ${messages.join(". ")}`,
        400,
      );
    }

    if (err.code === 11000) {
      const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
      prodError = new AppError(
        `Duplicate field value: ${value}. Please use another value!`,
        400,
      );
    }

    sendProdError(prodError, res);
  }
};

const sendDevError = (err: any, res: Response) => {
  logger.error(err);
  res.status(err.statusCode).json({
    success: false,
    message: err.message,
    data: {
      stack: err.stack,
      code: err.statusCode,
      status: err.status
    }
  });
};

const sendProdError = (err: any, res: Response) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      data: null
    });
  } else {
    logger.error(" CRITICAL UNEXPECTED ERROR:", err);
    res.status(500).json({
      success: false,
      message: MESSAGES.SYSTEM.ERROR,
      data: null
    });
  }
};
