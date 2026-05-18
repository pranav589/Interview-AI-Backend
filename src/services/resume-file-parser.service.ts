import fs from "node:fs/promises";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import mammoth from "mammoth";
import { ValidationError } from "../lib/errors";
import { MESSAGES } from "../config/constants";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_EXTRACTED_CHARS = 50000;

export class ResumeFileParserService {
  async parse(filePath: string, fileType: string): Promise<string> {
    try {
      let text = "";

      if (fileType === "application/pdf") {
        const loader = new PDFLoader(filePath);
        const docs = await loader.load();
        text = docs.map((doc) => doc.pageContent).join("\n").trim();
      } else if (fileType === DOCX_MIME) {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value.trim();
      } else if (fileType === "text/plain") {
        text = (await fs.readFile(filePath, "utf-8")).trim();
      } else {
        throw new ValidationError(MESSAGES.USER.RESUME.INVALID_FILE_TYPE);
      }

      if (!text) {
        throw new ValidationError(MESSAGES.USER.RESUME_EXTRACT_ERROR);
      }

      return text.length > MAX_EXTRACTED_CHARS ? text.slice(0, MAX_EXTRACTED_CHARS) : text;
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }
}

export const resumeFileParserService = new ResumeFileParserService();
