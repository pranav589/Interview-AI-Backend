import { Config } from "../models/config.model";

export async function isFeatureEnabled(key: string): Promise<boolean> {
  try {
    const config = await Config.findOne({ key, group: "feature_flag" }).lean();
    return !!config?.value;
  } catch (error) {
    console.error(`Error checking feature flag ${key}:`, error);
    return true;
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
