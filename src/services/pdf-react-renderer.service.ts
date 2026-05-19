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
  modern: { accent: "#2563eb", font: "Helvetica" },
  classic: { accent: "#111827", font: "Times-Roman" },
  executive: { accent: "#374151", font: "Helvetica" },
} as const;

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 10,
    lineHeight: 1.4,
  },
  // Executive Two-Column Layout
  executiveContainer: {
    flexDirection: "row",
    height: "100%",
  },
  sidebar: {
    width: "30%",
    backgroundColor: "#f3f4f6",
    padding: 20,
    height: "100%",
  },
  mainContent: {
    width: "70%",
    padding: 20,
  },
  // Common elements
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 2,
    marginBottom: 8,
    marginTop: 12,
  },
  name: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 4,
  },
  contactInfo: {
    fontSize: 9,
    color: "#4b5563",
    marginBottom: 10,
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  entryTitle: {
    fontWeight: "bold",
    fontSize: 10.5,
  },
  entryDate: {
    fontSize: 9,
    color: "#6b7280",
  },
  entrySub: {
    fontSize: 9.5,
    fontStyle: "italic",
    marginBottom: 4,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 2,
    paddingLeft: 8,
  },
  bulletDot: {
    width: 10,
    fontSize: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
  },
});

export class PdfReactRendererService {
  async render(resume: NormalizedResumeDocument, templateId: ResumeTemplateId): Promise<Buffer> {
    logger.info({ templateId, userName: resume.personalInfo.name }, "Rendering resume with react-pdf");
    
    let doc;
    switch (templateId) {
      case "classic":
        doc = this.renderClassic(resume);
        break;
      case "executive":
        doc = this.renderExecutive(resume);
        break;
      case "modern":
      default:
        doc = this.renderModern(resume);
        break;
    }

    return renderToBuffer(doc as any);
  }

  private renderModern(resume: NormalizedResumeDocument) {
    const accent = theme.modern.accent;
    return React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: [styles.page, { fontFamily: theme.modern.font }] },
        this.renderHeader(resume, accent, "center"),
        ...this.getSections(resume, accent)
      )
    );
  }

  private renderClassic(resume: NormalizedResumeDocument) {
    const accent = theme.classic.accent;
    return React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: [styles.page, { fontFamily: theme.classic.font }] },
        this.renderHeader(resume, accent, "left"),
        ...this.getSections(resume, accent)
      )
    );
  }

  private renderExecutive(resume: NormalizedResumeDocument) {
    const accent = theme.executive.accent;
    return React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: [styles.page, { padding: 0, fontFamily: theme.executive.font }] },
        React.createElement(
          View,
          { style: styles.executiveContainer },
          React.createElement(
            View,
            { style: styles.sidebar },
            React.createElement(Text, { style: [styles.name, { fontSize: 18 }] }, resume.personalInfo.name),
            React.createElement(Text, { style: { fontSize: 8, marginBottom: 15 } }, resume.personalInfo.email),
            React.createElement(Text, { style: { fontSize: 8, marginBottom: 5 } }, resume.personalInfo.phone),
            React.createElement(Text, { style: { fontSize: 8, marginBottom: 15 } }, resume.personalInfo.location),
            
            this.renderSidebarSection("Skills", resume.skills),
            this.renderSidebarSection("Languages", resume.languages || []),
            this.renderSidebarSection("Links", resume.personalInfo.links || [])
          ),
          React.createElement(
            View,
            { style: styles.mainContent },
            ...this.getSections(resume, accent)
          )
        )
      )
    );
  }

  private getSections(resume: NormalizedResumeDocument, accent: string) {
    const order = resume.sectionOrder?.length 
      ? resume.sectionOrder 
      : ["summary", "experience", "projects", "education", "skills", "certifications", "languages", "awards"];

    const sectionMap: Record<string, () => any> = {
      summary: () => this.renderSummary(resume, accent),
      experience: () => this.renderExperience(resume, accent),
      projects: () => this.renderProjects(resume, accent),
      education: () => this.renderEducation(resume, accent),
      skills: () => this.renderSkills(resume, accent),
      certifications: () => this.renderCertifications(resume, accent),
      languages: () => this.renderLanguages(resume, accent),
      awards: () => this.renderAwards(resume, accent),
    };

    return order.map(id => sectionMap[id]?.()).filter(Boolean);
  }

  private renderHeader(resume: NormalizedResumeDocument, accent: string, align: "left" | "center") {
    return React.createElement(
      View,
      { style: { textAlign: align, marginBottom: 15 } },
      React.createElement(Text, { style: [styles.name, { color: accent }] }, resume.personalInfo.name),
      React.createElement(
        Text,
        { style: styles.contactInfo },
        [resume.personalInfo.email, resume.personalInfo.phone, resume.personalInfo.location].filter(Boolean).join(" | ")
      )
    );
  }

  private renderSummary(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.summary) return null;
    return React.createElement(
      View,
      { style: { marginBottom: 10 } },
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Professional Summary"),
      React.createElement(Text, { style: { fontSize: 9.5 } }, resume.summary)
    );
  }

  private renderExperience(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.experience.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Experience"),
      ...resume.experience.map((exp, i) =>
        React.createElement(
          View,
          { key: i, style: { marginBottom: 8 }, wrap: false },
          React.createElement(
            View,
            { style: styles.entryHeader },
            React.createElement(Text, { style: styles.entryTitle }, exp.role),
            React.createElement(Text, { style: styles.entryDate }, `${exp.startDate} - ${exp.endDate || "Present"}`)
          ),
          React.createElement(Text, { style: styles.entrySub }, exp.company),
          ...exp.bullets.map((bullet, j) =>
            React.createElement(
              View,
              { key: j, style: styles.bulletRow },
              React.createElement(Text, { style: styles.bulletDot }, "•"),
              React.createElement(Text, { style: styles.bulletText }, bullet)
            )
          )
        )
      )
    );
  }

  private renderEducation(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.education.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Education"),
      ...resume.education.map((edu, i) =>
        React.createElement(
          View,
          { key: i, style: { marginBottom: 5 } },
          React.createElement(
            View,
            { style: styles.entryHeader },
            React.createElement(Text, { style: styles.entryTitle }, edu.degree),
            React.createElement(Text, { style: styles.entryDate }, edu.gradDate)
          ),
          React.createElement(Text, { style: styles.entrySub }, edu.school)
        )
      )
    );
  }

  private renderProjects(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.projects.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Projects"),
      ...resume.projects.map((proj, i) =>
        React.createElement(
          View,
          { key: i, style: { marginBottom: 6 } },
          React.createElement(Text, { style: styles.entryTitle }, proj.name),
          React.createElement(Text, { style: { fontSize: 9, marginBottom: 2 } }, proj.description),
          ...(proj.bullets || []).map((bullet, j) =>
            React.createElement(
              View,
              { key: j, style: styles.bulletRow },
              React.createElement(Text, { style: styles.bulletDot }, "•"),
              React.createElement(Text, { style: styles.bulletText }, bullet)
            )
          )
        )
      )
    );
  }

  private renderSkills(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.skills.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Skills"),
      React.createElement(Text, { style: { fontSize: 9.5 } }, resume.skills.join(", "))
    );
  }

  private renderCertifications(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.certifications.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Certifications"),
      ...resume.certifications.map((cert, i) =>
        React.createElement(Text, { key: i, style: { fontSize: 9, marginBottom: 2 } }, `${cert.name} - ${cert.issuer} (${cert.date})`)
      )
    );
  }

  private renderLanguages(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.languages.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Languages"),
      React.createElement(Text, { style: { fontSize: 9.5 } }, resume.languages.join(", "))
    );
  }

  private renderAwards(resume: NormalizedResumeDocument, accent: string) {
    if (!resume.awards.length) return null;
    return React.createElement(
      View,
      null,
      React.createElement(Text, { style: [styles.sectionTitle, { color: accent }] }, "Awards"),
      ...resume.awards.map((award, i) =>
        React.createElement(
          View,
          { key: i, style: styles.bulletRow },
          React.createElement(Text, { style: styles.bulletDot }, "•"),
          React.createElement(Text, { style: styles.bulletText }, award)
        )
      )
    );
  }

  private renderSidebarSection(title: string, items: string[]) {
    if (!items.length) return null;
    return React.createElement(
      View,
      { style: { marginTop: 15 } },
      React.createElement(Text, { style: { fontSize: 9, fontWeight: "bold", textTransform: "uppercase", marginBottom: 5, borderBottomWidth: 1, borderBottomColor: "#d1d5db" } }, title),
      ...items.map((item, i) =>
        React.createElement(Text, { key: i, style: { fontSize: 8, marginBottom: 2 } }, item)
      )
    );
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
