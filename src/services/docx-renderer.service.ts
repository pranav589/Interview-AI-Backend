import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  AlignmentType, 
  Table, 
  TableRow, 
  TableCell, 
  BorderStyle, 
  WidthType,
  VerticalAlign,
  LineRuleType
} from "docx";
import { NormalizedResumeDocument, ResumeTemplateId } from "./resume-export.model";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("docx-renderer");

export class DocxRendererService {
  async render(resume: NormalizedResumeDocument, templateId: ResumeTemplateId): Promise<Buffer> {
    logger.info({ templateId, userName: resume.personalInfo.name }, "Rendering resume with docx");

    const sections: any[] = [];

    // Header
    sections.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: resume.personalInfo.name,
            bold: true,
            size: 32, // 16pt
            color: this.getAccentColor(templateId),
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: [resume.personalInfo.email, resume.personalInfo.phone, resume.personalInfo.location]
              .filter(Boolean)
              .join(" | "),
            size: 18, // 9pt
          }),
        ],
      })
    );

    if (resume.personalInfo.links?.length) {
      sections.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: resume.personalInfo.links.join(" | "),
              size: 18,
            }),
          ],
        })
      );
    }

    const order = resume.sectionOrder?.length 
      ? resume.sectionOrder 
      : ["summary", "experience", "projects", "education", "skills", "certifications", "languages", "awards"];

    for (const sectionId of order) {
      switch (sectionId) {
        case "summary":
          this.renderSummary(resume, templateId, sections);
          break;
        case "experience":
          this.renderExperience(resume, templateId, sections);
          break;
        case "projects":
          this.renderProjects(resume, templateId, sections);
          break;
        case "education":
          this.renderEducation(resume, templateId, sections);
          break;
        case "skills":
          this.renderSkills(resume, templateId, sections);
          break;
        case "certifications":
          this.renderCertifications(resume, templateId, sections);
          break;
        case "languages":
          this.renderLanguages(resume, templateId, sections);
          break;
        case "awards":
          this.renderAwards(resume, templateId, sections);
          break;
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: sections,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  private renderSummary(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.summary) {
      sections.push(this.createSectionTitle("Summary", templateId));
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: resume.summary, size: 20 })],
          spacing: { after: 200 },
        })
      );
    }
  }

  private renderExperience(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.experience.length) {
      sections.push(this.createSectionTitle("Experience", templateId));
      for (const exp of resume.experience) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: exp.role || exp.company, bold: true, size: 22 }),
              new TextRun({ text: `\t${exp.startDate} - ${exp.endDate || "Present"}`, bold: true, size: 20 }),
            ],
            tabStops: [{ type: "right", position: 9000 }],
            spacing: { before: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: exp.company, italics: true, size: 20 }),
              new TextRun({ text: `\t${exp.location || ""}`, italics: true, size: 20 }),
            ],
            tabStops: [{ type: "right", position: 9000 }],
            spacing: { after: 100 },
          })
        );

        for (const bullet of exp.bullets) {
          sections.push(
            new Paragraph({
              text: bullet,
              bullet: { level: 0 },
              spacing: { before: 50 },
            })
          );
        }
      }
    }
  }

  private renderProjects(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.projects.length) {
      sections.push(this.createSectionTitle("Projects", templateId));
      for (const proj of resume.projects) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: proj.name, bold: true, size: 22 }),
            ],
            spacing: { before: 100 },
          })
        );
        if (proj.description) {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({ text: proj.description, italics: true, size: 20 }),
              ],
              spacing: { after: 100 },
            })
          );
        }
        if (proj.bullets) {
          for (const bullet of proj.bullets) {
            sections.push(
              new Paragraph({
                text: bullet,
                bullet: { level: 0 },
                spacing: { before: 50 },
              })
            );
          }
        }
      }
    }
  }

  private renderEducation(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.education.length) {
      sections.push(this.createSectionTitle("Education", templateId));
      for (const edu of resume.education) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: edu.degree || edu.school, bold: true, size: 22 }),
              new TextRun({ text: `\t${edu.gradDate || ""}`, bold: true, size: 20 }),
            ],
            tabStops: [{ type: "right", position: 9000 }],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: edu.school, italics: true, size: 20 }),
            ],
            spacing: { after: 100 },
          })
        );
      }
    }
  }

  private renderSkills(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.skills.length) {
      sections.push(this.createSectionTitle("Skills", templateId));
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: resume.skills.join(", "), size: 20 }),
          ],
          spacing: { after: 200 },
        })
      );
    }
  }

  private renderCertifications(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.certifications.length) {
      sections.push(this.createSectionTitle("Certifications", templateId));
      for (const cert of resume.certifications) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${cert.name} - ${cert.issuer || ""} (${cert.date || ""})`, size: 20 }),
            ],
            spacing: { before: 50 },
          })
        );
      }
    }
  }

  private renderLanguages(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.languages.length) {
      sections.push(this.createSectionTitle("Languages", templateId));
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: resume.languages.join(", "), size: 20 }),
          ],
          spacing: { after: 200 },
        })
      );
    }
  }

  private renderAwards(resume: NormalizedResumeDocument, templateId: ResumeTemplateId, sections: any[]) {
    if (resume.awards.length) {
      sections.push(this.createSectionTitle("Awards", templateId));
      for (const award of resume.awards) {
        sections.push(
          new Paragraph({
            text: award,
            bullet: { level: 0 },
            spacing: { before: 50 },
          })
        );
      }
    }
  }

  private createSectionTitle(title: string, templateId: ResumeTemplateId): Paragraph {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          color: this.getAccentColor(templateId),
          size: 24, // 12pt
        }),
      ],
      border: {
        bottom: {
          color: "auto",
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      spacing: { before: 200, after: 100 },
    });
  }

  private getAccentColor(templateId: ResumeTemplateId): string {
    switch (templateId) {
      case "modern":
        return "2563EB"; // Blue
      case "classic":
        return "000000"; // Black
      case "executive":
        return "374151"; // Charcoal
      default:
        return "000000";
    }
  }
}

export const docxRendererService = new DocxRendererService();
