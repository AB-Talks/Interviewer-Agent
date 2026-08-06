import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

// Shared by every route that accepts an uploaded document (resume or JD):
// /api/interviews/create, /api/integrations/abtalks/interviews, /api/jobs.
// pdf-parse v2's API is class-based (PDFParse.getText()), not the old
// `pdfParse(buffer) => {text}` function -- callers before this file each
// hand-rolled their own copy against the old API, which throws at runtime
// ("pdfParse is not a function") the moment someone actually uploads a PDF.
export async function extractTextFromFile(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (fileName.endsWith(".txt")) {
    return buffer.toString("utf8").trim();
  }

  if (fileName.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  if (fileName.endsWith(".docx")) {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value.trim();
  }

  throw new Error("Unsupported file type. Please upload a PDF, DOCX, or TXT file.");
}
