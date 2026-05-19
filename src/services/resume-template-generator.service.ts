import { pdfReactRendererService } from "./pdf-react-renderer.service";
import { docxRendererService } from "./docx-renderer.service";
import { NormalizedResumeDocument } from "./resume-export.model";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("resume-template-generator");

export interface GeneratedTemplates {
  pdf: {
    modern: Buffer;
    classic: Buffer;
    executive: Buffer;
  };
  docx: {
    modern: Buffer;
    classic: Buffer;
    executive: Buffer;
  };
}

export class ResumeTemplateGeneratorService {
  async generateAll(resume: NormalizedResumeDocument): Promise<GeneratedTemplates> {
    logger.info({ userName: resume.personalInfo.name }, "Generating all resume templates in parallel");

    const [
      pdfModern, pdfClassic, pdfExecutive,
      docxModern, docxClassic, docxExecutive
    ] = await Promise.all([
      pdfReactRendererService.render(resume, "modern"),
      pdfReactRendererService.render(resume, "classic"),
      pdfReactRendererService.render(resume, "executive"),
      docxRendererService.render(resume, "modern"),
      docxRendererService.render(resume, "classic"),
      docxRendererService.render(resume, "executive"),
    ]);

    return {
      pdf: {
        modern: pdfModern,
        classic: pdfClassic,
        executive: pdfExecutive,
      },
      docx: {
        modern: docxModern,
        classic: docxClassic,
        executive: docxExecutive,
      },
    };
  }
}

export const resumeTemplateGeneratorService = new ResumeTemplateGeneratorService();
