export type ResumeTemplateId = "modern" | "classic" | "executive" | "minimalist";

export interface ResumePersonalInfo {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
}

export interface ResumeExperienceItem {
  role: string;
  company: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  bullets: string[];
}

export interface ResumeEducationItem {
  degree: string;
  school: string;
  location?: string;
  gradDate?: string;
  details?: string[];
}

export interface ResumeProjectItem {
  name: string;
  description?: string;
  bullets?: string[];
}

export interface ResumeCertificationItem {
  name: string;
  issuer?: string;
  date?: string;
}

export interface NormalizedResumeDocument {
  personalInfo: ResumePersonalInfo;
  summary?: string;
  experience: ResumeExperienceItem[];
  education: ResumeEducationItem[];
  skills: string[];
  projects: ResumeProjectItem[];
  certifications: ResumeCertificationItem[];
  languages: string[];
  awards: string[];
  sectionOrder?: string[];
}

export interface SectionAudit {
  present: boolean;
  score: number;
  positives: string[];
  negatives: string[];
}

export interface AnalysisReportDocument {
  title: string;
  userName: string;
  date: string;
  atsScore: number;
  overallAssessment: string;
  sections: {
    contact: SectionAudit;
    summary: SectionAudit;
    experience: SectionAudit;
    education: SectionAudit;
    skills: SectionAudit;
    projects: SectionAudit;
    certifications: SectionAudit;
  };
  topRecommendations: string[];
  overallPositives: string[];
  overallNegatives: string[];
  keywordsFound: string[];
  keywordsMissing: string[];
}

const safeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
};

const toArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const normalizeResumeDocument = (rawData: any): NormalizedResumeDocument => {
  const personalInfo = rawData?.personalInfo || {};
  const links = toArray<string>(personalInfo.links).map(safeText).filter(Boolean);

  return {
    personalInfo: {
      name: safeText(personalInfo.name) || "Your Name",
      email: safeText(personalInfo.email) || undefined,
      phone: safeText(personalInfo.phone) || undefined,
      location: safeText(personalInfo.location) || undefined,
      links: links.length ? links : undefined,
    },
    summary: safeText(rawData?.summary) || undefined,
    experience: toArray<any>(rawData?.experience)
      .map((exp) => ({
        role: safeText(exp?.role),
        company: safeText(exp?.company),
        location: safeText(exp?.location) || undefined,
        startDate: safeText(exp?.startDate) || undefined,
        endDate: safeText(exp?.endDate) || undefined,
        bullets: toArray<string>(exp?.bullets).map(safeText).filter(Boolean),
      }))
      .filter((exp) => exp.role || exp.company || exp.bullets.length),
    education: toArray<any>(rawData?.education)
      .map((edu) => ({
        degree: safeText(edu?.degree),
        school: safeText(edu?.school),
        location: safeText(edu?.location) || undefined,
        gradDate: safeText(edu?.gradDate) || undefined,
        details: toArray<string>(edu?.details).map(safeText).filter(Boolean),
      }))
      .filter((edu) => edu.degree || edu.school),
    skills: toArray<string>(rawData?.skills).map(safeText).filter(Boolean),
    projects: toArray<any>(rawData?.projects)
      .map((project) => ({
        name: safeText(project?.name),
        description: safeText(project?.description) || undefined,
        bullets: toArray<string>(project?.bullets).map(safeText).filter(Boolean),
      }))
      .filter((project) => project.name || project.description || (project.bullets || []).length),
    certifications: toArray<any>(rawData?.certifications)
      .map((cert) => ({
        name: safeText(cert?.name),
        issuer: safeText(cert?.issuer) || undefined,
        date: safeText(cert?.date) || undefined,
      }))
      .filter((cert) => cert.name),
    languages: toArray<string>(rawData?.languages).map(safeText).filter(Boolean),
    awards: toArray<string>(rawData?.awards).map(safeText).filter(Boolean),
    sectionOrder: toArray<string>(rawData?.sectionOrder).map(safeText).filter(Boolean),
  };
};
