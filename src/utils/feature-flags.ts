import { Config } from "../models/config.model";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("feature-flags");

const flagCache = new Map<string, { value: boolean; expiresAt: number }>();
const FLAG_TTL_MS = 30_000;

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const cached = flagCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  try {
    const config = await Config.findOne({ key, group: "feature_flag" }).lean();
    const value = !!config?.value;
    
    flagCache.set(key, { 
      value, 
      expiresAt: Date.now() + FLAG_TTL_MS 
    });
    
    return value;
  } catch (error) {
    logger.error({ error, key }, `Error checking feature flag ${key}:`);
    return false; // Fail closed
  }
}

export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    const configs = await Config.find({ group: "feature_flag" }).lean();
    return configs.reduce((acc: Record<string, boolean>, curr) => {
      acc[curr.key] = !!curr.value;
      return acc;
    }, {});
  } catch (error) {
    console.error("Error fetching feature flags:", error);
    return {};
  }
}
