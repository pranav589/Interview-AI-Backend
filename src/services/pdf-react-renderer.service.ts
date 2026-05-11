import React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { createModuleLogger } from "../lib/logger";
import { AnalysisReportDocument, NormalizedResumeDocument, ResumeTemplateId } from "./resume-export.model";

const logger = createModuleLogger("pdf-react-renderer");

const baseStyles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 30,
    paddingHorizontal: 36,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.35,
  },
  header: { marginBottom: 14 },
  name: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  contact: { fontSize: 9.5, color: "#4b5563" },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#1f2937",
  },
  bodyText: { fontSize: 10, lineHeight: 1.4, color: "#111827" },
  entry: { marginBottom: 7 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  role: { fontSize: 10.5, fontWeight: 700 },
  subText: { fontSize: 9.4, color: "#4b5563" },
  bullets: { marginTop: 3 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 2 },
  bulletDot: { marginRight: 4, fontSize: 10 },
  bulletText: { flex: 1, fontSize: 9.8, lineHeight: 1.35 },
  chips: { fontSize: 9.8, lineHeight: 1.45 },
});

const analysisStyles = StyleSheet.create({
  reportContainer: { padding: 40, fontFamily: "Helvetica" },
  heroSection: { marginBottom: 30 },
  badge: {
    backgroundColor: "#eff6ff",
    color: "#2563eb",
    fontSize: 8,
    fontWeight: 700,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    textTransform: "uppercase",
    marginBottom: 8,
    width: 100,
  },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 12 },
  atsScore: { fontSize: 48, fontWeight: 700, color: "#111827" },
  atsLabel: { fontSize: 10, color: "#4b5563", fontWeight: 700, textTransform: "uppercase" },
  progressBar: {
    height: 8,
    width: "100%",
    backgroundColor: "#f3f4f6",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: { height: "100%", backgroundColor: "#2563eb", borderRadius: 4 },
  assessmentText: { fontSize: 10, color: "#111827", lineHeight: 1.5, marginBottom: 20 },
  
  gridContainer: { flexDirection: "row", gap: 20 },
  leftCol: { width: "35%" },
  rightCol: { width: "65%" },
  
  auditCard: {
    padding: 10,
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  auditLabel: { fontSize: 9, fontWeight: 700, color: "#111827" },
  auditScore: { fontSize: 9, fontWeight: 700, color: "#4b5563" },
  
  keywordGroup: { marginBottom: 15 },
  keywordTitle: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", marginBottom: 6, color: "#111827" },
  keywordContainer: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  keywordBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 100,
    fontSize: 8,
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    color: "#111827",
  },
  missingBadge: {
    backgroundColor: "#fef2f2",
    borderColor: "#fee2e2",
    color: "#b91c1c",
  },

  recommendationCard: {
    padding: 12,
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: "row",
    gap: 10,
  },
  recIndex: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#111827",
    color: "#ffffff",
    fontSize: 8,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 3,
  },
  recText: { flex: 1, fontSize: 9.5, color: "#111827", lineHeight: 1.4 },
  
  insightSection: { marginTop: 20, flexDirection: "row", gap: 15 },
  insightCol: { flex: 1 },
  insightTitle: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginBottom: 10, color: "#111827" },
  insightItem: {
    padding: 10,
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    marginBottom: 6,
  },
  insightText: { fontSize: 9, color: "#111827", lineHeight: 1.4 },
});

const theme = {
  modern: { accent: "#2563eb" },
  classic: { accent: "#111827" },
  minimalist: { accent: "#374151" },
} as const;

const renderSectionTitle = (title: string, accent: string) =>
  React.createElement(
    Text,
    {
      style: {
        ...baseStyles.sectionTitle,
        color: accent,
      },
    },
    title
  );

const joinDateRange = (start?: string, end?: string) => {
  const left = start || "";
  const right = end || "Present";
  if (!left && !end) return "";
  return [left, right].filter(Boolean).join(" - ");
};

const chunkText = (value?: string) => (value ? value.split("\n").filter(Boolean) : []);

export class PdfReactRendererService {
  async render(resume: NormalizedResumeDocument, templateId: ResumeTemplateId): Promise<Buffer> {
    const accent = theme[templateId]?.accent || theme.modern.accent;
    logger.info({ templateId }, "Rendering resume with react-pdf");

    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: baseStyles.page, wrap: true },
        React.createElement(
          View,
          { style: baseStyles.header },
          React.createElement(Text, { style: { ...baseStyles.name, color: accent } }, resume.personalInfo.name),
          React.createElement(
            Text,
            { style: baseStyles.contact },
            [resume.personalInfo.email, resume.personalInfo.phone, resume.personalInfo.location]
              .filter(Boolean)
              .join(" | ")
          ),
          resume.personalInfo.links?.length
            ? React.createElement(Text, { style: baseStyles.contact }, resume.personalInfo.links.join(" | "))
            : null
        ),

        resume.summary
          ? React.createElement(
              View,
              { style: baseStyles.section },
              renderSectionTitle("Summary", accent),
              ...chunkText(resume.summary).map((line, i) =>
                React.createElement(Text, { key: `summary-${i}`, style: baseStyles.bodyText }, line)
              )
            )
          : null,

        resume.experience.length
          ? React.createElement(
              View,
              { style: baseStyles.section },
              renderSectionTitle("Experience", accent),
              ...resume.experience.map((exp, idx) =>
                React.createElement(
                  View,
                  { key: `exp-${idx}`, style: baseStyles.entry, wrap: false },
                  React.createElement(
                    View,
                    { style: baseStyles.rowBetween },
                    React.createElement(Text, { style: baseStyles.role }, exp.role || exp.company),
                    React.createElement(Text, { style: baseStyles.subText }, joinDateRange(exp.startDate, exp.endDate))
                  ),
                  React.createElement(
                    View,
                    { style: baseStyles.rowBetween },
                    React.createElement(Text, { style: baseStyles.subText }, exp.company),
                    React.createElement(Text, { style: baseStyles.subText }, exp.location || "")
                  ),
                  exp.bullets.length
                    ? React.createElement(
                        View,
                        { style: baseStyles.bullets },
                        ...exp.bullets.map((bullet, bIdx) =>
                          React.createElement(
                            View,
                            { key: `exp-${idx}-b-${bIdx}`, style: baseStyles.bulletRow },
                            React.createElement(Text, { style: baseStyles.bulletDot }, "•"),
                            React.createElement(Text, { style: baseStyles.bulletText }, bullet)
                          )
                        )
                      )
                    : null
                )
              )
            )
          : null,

        resume.education.length
          ? React.createElement(
              View,
              { style: baseStyles.section },
              renderSectionTitle("Education", accent),
              ...resume.education.map((edu, idx) =>
                React.createElement(
                  View,
                  { key: `edu-${idx}`, style: baseStyles.entry, wrap: false },
                  React.createElement(
                    View,
                    { style: baseStyles.rowBetween },
                    React.createElement(Text, { style: baseStyles.role }, edu.degree || edu.school),
                    React.createElement(Text, { style: baseStyles.subText }, edu.gradDate || "")
                  ),
                  React.createElement(
                    View,
                    { style: baseStyles.rowBetween },
                    React.createElement(Text, { style: baseStyles.subText }, edu.school),
                    React.createElement(Text, { style: baseStyles.subText }, edu.location || "")
                  ),
                  ...(edu.details || []).map((detail, dIdx) =>
                    React.createElement(Text, { key: `edu-${idx}-d-${dIdx}`, style: baseStyles.bulletText }, detail)
                  )
                )
              )
            )
          : null,

        resume.projects.length
          ? React.createElement(
              View,
              { style: baseStyles.section },
              renderSectionTitle("Projects", accent),
              ...resume.projects.map((project, idx) =>
                React.createElement(
                  View,
                  { key: `project-${idx}`, style: baseStyles.entry, wrap: false },
                  React.createElement(Text, { style: baseStyles.role }, project.name),
                  project.description ? React.createElement(Text, { style: baseStyles.bodyText }, project.description) : null,
                  ...(project.bullets || []).map((bullet, bIdx) =>
                    React.createElement(
                      View,
                      { key: `project-${idx}-b-${bIdx}`, style: baseStyles.bulletRow },
                      React.createElement(Text, { style: baseStyles.bulletDot }, "•"),
                      React.createElement(Text, { style: baseStyles.bulletText }, bullet)
                    )
                  )
                )
              )
            )
          : null,

        resume.certifications.length
          ? React.createElement(
              View,
              { style: baseStyles.section },
              renderSectionTitle("Certifications", accent),
              ...resume.certifications.map((cert, idx) =>
                React.createElement(
                  View,
                  { key: `cert-${idx}`, style: baseStyles.entry, wrap: false },
                  React.createElement(
                    Text,
                    { style: baseStyles.bodyText },
                    [cert.name, cert.issuer, cert.date].filter(Boolean).join(" | ")
                  )
                )
              )
            )
          : null,

        resume.skills.length
          ? React.createElement(
              View,
              { style: baseStyles.section },
              renderSectionTitle("Skills", accent),
              React.createElement(Text, { style: baseStyles.chips }, resume.skills.join(", "))
            )
          : null
      )
    );

    return renderToBuffer(doc as any);
  }

  async renderAnalysisReport(report: AnalysisReportDocument): Promise<Buffer> {
    logger.info({ userName: report.userName }, "Rendering analysis report with react-pdf");

    const auditKeys = [
      { key: "contact", label: "Contact Info" },
      { key: "summary", label: "Summary" },
      { key: "experience", label: "Experience" },
      { key: "education", label: "Education" },
      { key: "skills", label: "Skills" },
      { key: "projects", label: "Projects" },
      { key: "certifications", label: "Certs" },
    ] as const;

    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: analysisStyles.reportContainer },
        // Hero Section
        React.createElement(
          View,
          { style: analysisStyles.heroSection },
          React.createElement(Text, { style: analysisStyles.badge }, "Audit Result"),
          React.createElement(
            View,
            { style: analysisStyles.titleRow },
            React.createElement(Text, { style: analysisStyles.atsScore }, `${report.atsScore}%`),
            React.createElement(Text, { style: analysisStyles.atsLabel }, "ATS Score")
          ),
          React.createElement(
            View,
            { style: analysisStyles.progressBar },
            React.createElement(View, { style: { ...analysisStyles.progressFill, width: `${report.atsScore}%` } })
          ),
          React.createElement(Text, { style: analysisStyles.assessmentText }, report.overallAssessment)
        ),

        // Main Grid
        React.createElement(
          View,
          { style: analysisStyles.gridContainer },
          // Left Column (Audit & Keywords)
          React.createElement(
            View,
            { style: analysisStyles.leftCol },
            React.createElement(Text, { style: analysisStyles.insightTitle }, "Structural Health"),
            ...auditKeys.map(({ key, label }) => {
              const section = report.sections[key];
              return React.createElement(
                View,
                { key: key, style: analysisStyles.auditCard },
                React.createElement(Text, { style: analysisStyles.auditLabel }, label),
                React.createElement(Text, { style: analysisStyles.auditScore }, section.score)
              );
            }),

            React.createElement(View, { style: { marginTop: 20 } }),
            
            React.createElement(
              View,
              { style: analysisStyles.keywordGroup },
              React.createElement(Text, { style: analysisStyles.keywordTitle }, "Keywords Detected"),
              React.createElement(
                View,
                { style: analysisStyles.keywordContainer },
                ...report.keywordsFound.slice(0, 12).map((kw, i) =>
                  React.createElement(Text, { key: `found-${i}`, style: analysisStyles.keywordBadge }, kw)
                )
              )
            ),

            React.createElement(
              View,
              { style: analysisStyles.keywordGroup },
              React.createElement(Text, { style: analysisStyles.keywordTitle }, "Keywords Missing"),
              React.createElement(
                View,
                { style: analysisStyles.keywordContainer },
                ...report.keywordsMissing.slice(0, 12).map((kw, i) =>
                  React.createElement(Text, { key: `missing-${i}`, style: { ...analysisStyles.keywordBadge, ...analysisStyles.missingBadge } }, kw)
                )
              )
            )
          ),

          // Right Column (Roadmap & Insights)
          React.createElement(
            View,
            { style: analysisStyles.rightCol },
            React.createElement(Text, { style: analysisStyles.insightTitle }, "Execution Roadmap"),
            ...report.topRecommendations.map((rec, i) =>
              React.createElement(
                View,
                { key: `rec-${i}`, style: analysisStyles.recommendationCard },
                React.createElement(Text, { style: analysisStyles.recIndex }, i + 1),
                React.createElement(Text, { style: analysisStyles.recText }, rec)
              )
            ),

            // Strengths & Gaps
            React.createElement(
              View,
              { style: { ...analysisStyles.insightSection, marginTop: 25 } },
              React.createElement(
                View,
                { style: analysisStyles.insightCol },
                React.createElement(Text, { style: analysisStyles.insightTitle }, "Top Strengths"),
                ...report.overallPositives.map((text, i) =>
                  React.createElement(
                    View,
                    { key: `pos-${i}`, style: analysisStyles.insightItem },
                    React.createElement(Text, { style: analysisStyles.insightText }, text)
                  )
                )
              ),
              React.createElement(
                View,
                { style: analysisStyles.insightCol },
                React.createElement(Text, { style: analysisStyles.insightTitle }, "Critical Gaps"),
                ...report.overallNegatives.map((text, i) =>
                  React.createElement(
                    View,
                    { key: `neg-${i}`, style: { ...analysisStyles.insightItem, borderLeft: "3px solid #ef4444" } },
                    React.createElement(Text, { style: analysisStyles.insightText }, text)
                  )
                )
              )
            )
          )
        )
      )
    );

    return renderToBuffer(doc as any);
  }
}

export const pdfReactRendererService = new PdfReactRendererService();
