import { Schema, model, Document, Types } from "mongoose";

interface ISectionFeedback {
  present: boolean;
  score: number; // 0-100
  positives: string[];
  negatives: string[];
}

export interface IResumeAnalysis extends Document {
  userId: Types.ObjectId;
  resumeId: Types.ObjectId;
  resumeText: string;
  atsScore: number;
  sections: {
    contact: ISectionFeedback;
    summary: ISectionFeedback;
    experience: ISectionFeedback;
    education: ISectionFeedback;
    skills: ISectionFeedback;
    projects: ISectionFeedback;
    certifications: ISectionFeedback;
  };
  overallPositives: string[];
  overallNegatives: string[];
  topRecommendations: string[];
  keywordsFound: string[];
  keywordsMissing: string[];
  createdAt: Date;
}

const sectionFeedbackSchema = new Schema({
  present: { type: Boolean, default: false },
  score: { type: Number, default: 0 },
  positives: [String],
  negatives: [String],
}, { _id: false });

const resumeAnalysisSchema = new Schema<IResumeAnalysis>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    resumeId: {
      type: Schema.Types.ObjectId,
      ref: "Resume",
      required: true,
    },
    resumeText: {
      type: String,
      required: true,
    },
    atsScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    sections: {
      contact: sectionFeedbackSchema,
      summary: sectionFeedbackSchema,
      experience: sectionFeedbackSchema,
      education: sectionFeedbackSchema,
      skills: sectionFeedbackSchema,
      projects: sectionFeedbackSchema,
      certifications: sectionFeedbackSchema,
    },
    overallPositives: [String],
    overallNegatives: [String],
    topRecommendations: [String],
    keywordsFound: [String],
    keywordsMissing: [String],
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const ResumeAnalysis = model<IResumeAnalysis>("ResumeAnalysis", resumeAnalysisSchema);
