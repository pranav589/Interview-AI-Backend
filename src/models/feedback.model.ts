import mongoose, { Schema, model } from "mongoose";

const questionFeedbackSchema = new Schema({
  question: { type: String, required: true },
  userAnswer: { type: String, required: true },
  score: { type: Number, required: true, min: 0, max: 100 },
  feedback: { type: String, required: true },
  modelAnswer: { type: String, required: true },
}, { _id: false });

const feedbackSchema = new Schema(
  {
    interviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Interview",
      required: true,
      unique: true,
    },
    overallScore: { type: Number, required: true },
    communicationScore: { type: Number, default: 0 },
    technicalScore: { type: Number, default: 0 },
    confidenceScore: { type: Number, default: 0 },
    feedbackSummary: { type: String, required: true },
    strengths: [{ type: String }],
    areasForImprovement: [{ type: String }],
    suggestions: [{ type: String }],
    questions: [questionFeedbackSchema],
  },
  {
    timestamps: true,
  }
);

export const Feedback = model("Feedback", feedbackSchema);
