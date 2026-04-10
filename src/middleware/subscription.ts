import { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";
import { User } from "../models/user.model";
import { AuthenticatedRequest } from "../types/express";
import { createModuleLogger } from "../lib/logger";
import { SUBSCRIPTION_TIERS, DEFAULT_FREE_CREDITS, MESSAGES } from "../config/constants";
import { isFeatureEnabled } from "../utils/feature-flags";

const logger = createModuleLogger("subscription-middleware");

/**
 * Middleware to check and reset credits if needed, 
 * and attach the latest subscription status to the request.
 */
export async function checkSubscription(req: Request, res: Response, next: NextFunction) {
  const authUser = (req as AuthenticatedRequest).user;
  if (!authUser) {
    throw new UnauthorizedError(MESSAGES.AUTH.NOT_AUTHENTICATED);
  }

  try {
    const user = await User.findById(authUser.id);
    if (!user) {
      throw new UnauthorizedError(MESSAGES.AUTH.USER_NOT_FOUND);
    }

    // Handle Credit Reset (Every 30 days for Free tier)
    const now = new Date();
    const lastReset = new Date(user.lastCreditReset || user.createdAt);
    const daysSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceReset >= 30) {
      logger.info(`Resetting credits for user ${user.email}`);
      user.credits = user.subscriptionTier === SUBSCRIPTION_TIERS.FREE ? DEFAULT_FREE_CREDITS : 10000; // 10k as "Unlimited"
      user.lastCreditReset = now;
      await user.save();
    }

    // Attach full user object to request for downstream controllers
    (req as any).fullUser = user;
    
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to enforce credit availability
 */
export async function requireCredits(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).fullUser;
  
  if (!user) {
    return next(new UnauthorizedError(MESSAGES.SUBSCRIPTION.DATA_MISSING));
  }

  if (await isFeatureEnabled("credits_system_enabled")) {
    if (user.subscriptionTier === SUBSCRIPTION_TIERS.FREE && user.credits <= 0) {
      return next(new ForbiddenError(MESSAGES.SUBSCRIPTION.INSUFFICIENT_CREDITS));
    }
  }

  next();
}

/**
 * Middleware to enforce specific tiers for features
 */
export function requireTier(allowedTiers: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).fullUser;

    if (!user) {
      return next(new UnauthorizedError(MESSAGES.SUBSCRIPTION.DATA_MISSING));
    }

    if (!allowedTiers.includes(user.subscriptionTier)) {
      throw new ForbiddenError(MESSAGES.SUBSCRIPTION.UPGRADE_REQUIRED);
    }

    next();
  };
}
