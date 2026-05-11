import { createModuleLogger } from "../lib/logger";
import { AnalysisReportDocument, normalizeResumeDocument, ResumeTemplateId } from "./resume-export.model";
import { pdfReactRendererService } from "./pdf-react-renderer.service";
import { env } from "../config/env";
import puppeteer from "puppeteer";

const logger = createModuleLogger("pdf-export-service");

export class PdfExportService {
  async generateResumePdf(resumeData: any, templateId: string): Promise<Buffer> {
    const normalizedTemplate = this.normalizeTemplate(templateId);
    const normalizedResume = normalizeResumeDocument(resumeData);
    const mode = env.PDF_RENDERER_MODE || "new";

    if (mode === "legacy") {
      logger.info({ templateId: normalizedTemplate }, "Generating resume PDF using legacy renderer");
      return this.generateLegacyResumePdf(normalizedResume, normalizedTemplate);
    }

    logger.info({ templateId: normalizedTemplate }, "Generating resume PDF using react-pdf renderer");
    return pdfReactRendererService.render(normalizedResume, normalizedTemplate);
  }

  async generateAnalysisReportPdf(reportData: AnalysisReportDocument): Promise<Buffer> {
    logger.info({ userName: reportData.userName }, "Generating analysis report PDF using react-pdf");
    return pdfReactRendererService.renderAnalysisReport(reportData);
  }

  private normalizeTemplate(templateId: string): ResumeTemplateId {
    if (templateId === "classic" || templateId === "minimalist") return templateId;
    return "modern";
  }

  private async generateLegacyResumePdf(resumeData: any, templateId: ResumeTemplateId): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      const html = this.getResumeHtml(resumeData, templateId);
      await page.setContent(html, { waitUntil: "networkidle0" });
      
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  private getResumeHtml(data: any, templateId: ResumeTemplateId): string {
    // Basic shared styles
    const baseStyles = `
      body { font-family: 'Inter', sans-serif; line-height: 1.5; color: #333; }
      .header { text-align: center; margin-bottom: 30px; }
      .name { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
      .contact { font-size: 14px; color: #666; }
      .section { margin-bottom: 20px; }
      .section-title { font-size: 18px; font-weight: bold; border-bottom: 1px solid #ddd; margin-bottom: 10px; text-transform: uppercase; }
      .entry { margin-bottom: 15px; }
      .entry-header { display: flex; justify-content: space-between; font-weight: bold; }
      .entry-sub { display: flex; justify-content: space-between; font-style: italic; color: #555; }
      .bullets { margin-top: 5px; padding-left: 20px; }
      .bullets li { margin-bottom: 3px; }
    `;

    const templateStyles: Record<string, string> = {
      modern: `
        .name { color: #2563eb; }
        .section-title { color: #2563eb; border-bottom: 2px solid #2563eb; }
      `,
      classic: `
        .name { font-family: 'Playfair Display', serif; }
        .section-title { text-align: center; border-bottom: 1px double #333; }
      `,
      minimalist: `
        body { font-size: 14px; }
        .section-title { border-bottom: none; font-size: 16px; margin-top: 30px; }
      `,
    };

    // Very basic HTML structure (to be improved)
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
        <style>
          ${baseStyles}
          ${templateStyles[templateId] || ""}
        </style>
      </head>
      <body>
        <div class="header">
          <div class="name">${data.personalInfo?.name || "Your Name"}</div>
          <div class="contact">
            ${data.personalInfo?.email || ""} | ${data.personalInfo?.phone || ""} | ${data.personalInfo?.location || ""}
          </div>
        </div>

        ${data.summary ? `
          <div class="section">
            <div class="section-title">Summary</div>
            <p>${data.summary}</p>
          </div>
        ` : ""}

        <div class="section">
          <div class="section-title">Experience</div>
          ${(data.experience || []).map((exp: any) => `
            <div class="entry">
              <div class="entry-header">
                <span>${exp.role}</span>
                <span>${exp.startDate} - ${exp.endDate || "Present"}</span>
              </div>
              <div class="entry-sub">
                <span>${exp.company}</span>
                <span>${exp.location || ""}</span>
              </div>
              <ul class="bullets">
                ${(exp.bullets || []).map((b: string) => `<li>${b}</li>`).join("")}
              </ul>
            </div>
          `).join("")}
        </div>

        <div class="section">
          <div class="section-title">Education</div>
          ${(data.education || []).map((edu: any) => `
            <div class="entry">
              <div class="entry-header">
                <span>${edu.degree}</span>
                <span>${edu.gradDate}</span>
              </div>
              <div class="entry-sub">
                <span>${edu.school}</span>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="section">
          <div class="section-title">Skills</div>
          <p>${(data.skills || []).join(", ")}</p>
        </div>
      </body>
      </html>
    `;
  }
}

export const pdfExportService = new PdfExportService();
