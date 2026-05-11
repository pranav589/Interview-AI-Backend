import mongoose from "mongoose";
import { Config } from "../models/config.model";
import { connectToDB } from "../config/db";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("seed-resume-flags");

const RESUME_FLAGS = [
  { key: "resume_analyzer_enabled", value: true, description: "Resume Analyzer tool access" },
  { key: "jd_matcher_enabled", value: true, description: "JD Matcher tool access" },
  { key: "resume_builder_enabled", value: true, description: "AI Resume Builder access" },
];

async function seed() {
  try {
    await connectToDB();
    logger.info("Connected to database for seeding...");

    for (const flag of RESUME_FLAGS) {
      const result = await Config.findOneAndUpdate(
        { key: flag.key },
        { $setOnInsert: { ...flag, group: "feature_flag" } },
        { upsert: true, new: true }
      );
      logger.info(`Flag ${flag.key} processed: ${result ? 'exists/created' : 'failed'}`);
    }

    logger.info("Resume feature flags seeded successfully");
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Error seeding resume flags");
    process.exit(1);
  }
}

seed();
