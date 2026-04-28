import { Config } from "../models/config.model";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("seed-config");

const DEFAULT_FLAGS = [
  { key: "streak_enabled", value: true, description: "Practice streak tracker on dashboard" },
  { key: "weekly_digest_enabled", value: true, description: "Weekly progress digest toggle" },
  { key: "onboarding_enabled", value: true, description: "New user onboarding walkthrough" },
  { key: "skills_radar_enabled", value: true, description: "Skill distribution radar chart" },
  { key: "score_trend_enabled", value: true, description: "Performance trend line chart" },
  { key: "top_percentile_enabled", value: true, description: "Global user comparison / rank" },
  { key: "interview_technical_enabled", value: true, description: "Access to technical interviews" },
  { key: "interview_system_design_enabled", value: true, description: "Access to system design interviews" },
  { key: "resume_upload_enabled", value: true, description: "Ability to upload and analyze resumes" },
  { key: "credits_system_enabled", value: true, description: "Enforce credit limits for interviews" },
  { key: "tts_enabled", value: true, description: "AI Voice playback (Text-to-Speech)" },
  { key: "coding_mode_enabled", value: true, description: "Enables interactive coding/whiteboard environment" },
  { key: "stat_total_interviews_enabled", value: true, description: "Total interviews stat on dashboard" },
  { key: "stat_average_score_enabled", value: true, description: "Average score stat on dashboard" },
  { key: "stat_total_time_enabled", value: true, description: "Total focus time stat on dashboard" },
  { key: "web_search_enabled", value: true, description: "Tavily web search for company context" },
  { key: "hints_tool_enabled", value: true, description: "AI Socratic hints for candidates" },
  { key: "code_eval_tool_enabled", value: true, description: "Deep code analysis tool" },
  { key: "topic_tracker_tool_enabled", value: true, description: "Automated topic suggested tool" },
];

export async function seedFeatureFlags() {
  try {
    for (const flag of DEFAULT_FLAGS) {
      await Config.findOneAndUpdate(
        { key: flag.key },
        { $setOnInsert: { ...flag, group: "feature_flag" } },
        { upsert: true, new: true }
      );
    }
    logger.info("Feature flags seeded successfully");
  } catch (error) {
    logger.error({ err: error }, "Error seeding feature flags");
  }
}
