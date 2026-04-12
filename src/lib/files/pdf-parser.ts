/**
 * Extract text content from a PDF buffer.
 *
 * pdf-parse / pdfjs-dist require browser globals (DOMMatrix, ImageData, …)
 * that are absent in Node.js unless @napi-rs/canvas is installed.  Using a
 * dynamic import here ensures the module is loaded lazily — only when a PDF
 * actually needs to be parsed — instead of at server startup (which would
 * crash the instrumentation hook before the app even becomes ready).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
