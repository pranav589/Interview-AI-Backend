import { Request, Response } from "express";
import { Config } from "../models/config.model";
import { MESSAGES } from "../config/constants";

export const getFeatureFlags = async (req: Request, res: Response) => {
  try {
    const configs = await Config.find({ group: "feature_flag" }).lean();
    
    const flags = configs.reduce((acc: Record<string, any>, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    res.json({
      success: true,
      message: MESSAGES.SYSTEM.FEATURE_FLAGS_FETCHED,
      data: flags,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: MESSAGES.SYSTEM.FEATURE_FLAGS_ERROR,
      data: null
    });
  }
};
