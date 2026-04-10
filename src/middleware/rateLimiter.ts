import rateLimit from "express-rate-limit";
import { RateLimitError } from "../lib/errors";
import { MESSAGES } from "../config/constants";

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new RateLimitError(MESSAGES.RATE_LIMIT.DEFAULT));
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, // 10 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new RateLimitError(MESSAGES.RATE_LIMIT.AUTH));
  },
});

export const interviewRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 interviews per hour
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new RateLimitError(MESSAGES.RATE_LIMIT.INTERVIEW));
  },
});
