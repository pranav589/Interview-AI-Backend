import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { createModuleLogger } from "../lib/logger";
import { env } from "../config/env";

const logger = createModuleLogger("error-handler");

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Development: full stack, clean messages
  if (env.NODE_ENV === "development") {
    sendDevError(err, res);
  } else {
    // Production: handle specific error types (Mongoose, etc)
    let error = { ...err };
    error.message = err.message;
    error.statusCode = err.statusCode;

    // Handle Mongoose cast error (bad ID)
    if (err.name === "CastError") {
      error.message = `Invalid ${err.path}: ${err.value}`;
      error.statusCode = 400;
    }

    // Handle Mongoose validation error
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((el: any) => el.message);
      error.message = `Invalid input data: ${messages.join(". ")}`;
      error.statusCode = 400;
    }

    // Handle Mongoose duplicate key error (code 11000)
    if (err.code === 11000) {
      const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
      error.message = `Duplicate field value: ${value}. Please use another value!`;
      error.statusCode = 400;
    }

    sendProdError(error, res);
  }
};

const sendDevError = (err: any, res: Response) => {
  logger.error(err);
  res.status(err.statusCode).json({
    error: {
      message: err.message,
      status: err.status,
      stack: err.stack,
      code: err.statusCode,
    },
  });
};

const sendProdError = (err: any, res: Response) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.statusCode,
      },
    });
  } else {
    // Programming or unknown error: don't leak details
    logger.error("💥 CRITICAL UNEXPECTED ERROR:", err);
    res.status(500).json({
      error: {
        message: "Something went very wrong!",
        code: 500,
      },
    });
  }
};
