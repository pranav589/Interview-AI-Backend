import { Request, Response } from "express";
import { Config } from "../models/config.model";

export const getFeatureFlags = async (req: Request, res: Response) => {
  try {
    const configs = await Config.find({ group: "feature_flag" }).lean();
    
    const flags = configs.reduce((acc: Record<string, any>, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    res.json({
      success: true,
      data: flags,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching feature flags",
    });
  }
};
