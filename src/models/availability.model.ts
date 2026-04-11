import mongoose, { Schema, model } from "mongoose";

const availabilitySchema = new Schema(
  {
    interviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    weeklySlots: [
      {
        dayOfWeek: { type: Number, required: true }, // 0 = Sunday, 1 = Monday, etc.
        startTime: { type: String, required: true }, // HH:mm format
        endTime: { type: String, required: true },   // HH:mm format
      }
    ],
    exceptions: [
      {
        date: { type: Date, required: true },
        isUnavailable: { type: Boolean, default: true },
      }
    ],
    timezone: {
      type: String,
      default: "UTC",
    }
  },
  {
    timestamps: true,
  }
);

export const Availability = model("Availability", availabilitySchema);
