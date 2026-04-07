import rateLimit from "express-rate-limit";
import { RateLimitError } from "../lib/errors";

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new RateLimitError());
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, // 10 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new RateLimitError("Too many login attempts. Please try again after 15 minutes."));
  },
});

export const interviewRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 interviews per hour
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new RateLimitError("Interview session limit reached. Please try again later."));
  },
});
