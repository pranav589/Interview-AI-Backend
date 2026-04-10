import { Schema, model } from "mongoose";

const configSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
    },
    group: {
      type: String,
      default: "feature_flag",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Config = model("Config", configSchema);
