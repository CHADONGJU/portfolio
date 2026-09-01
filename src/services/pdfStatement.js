const MAX_PDF_BYTES = 10 * 1024 * 1024;
let pdfJsPromise;

const loadPdfJs = () => {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfJs, workerModule]) => {
      pdfJs.GlobalWorkerOptions.workerSrc = workerModule.default;
      return pdfJs;
    });
  }
  return pdfJsPromise;
};

export const validateStatementPdf = (file) => {
  if (!file) throw new Error('PDF_FILE_REQUIRED');
  if (!String(file.name || '').toLowerCase().endsWith('.pdf')) throw new Error('PDF_FILE_TYPE_INVALID');
  if (!(Number(file.size) > 0) || Number(file.size) > MAX_PDF_BYTES) throw new Error('PDF_FILE_SIZE_INVALID');
};

/** 원본 파일은 업로드하지 않고 현재 브라우저 메모리에서 텍스트 좌표만 추출한다. */
export const extractPdfStatementPages = async (file) => {
  validateStatementPdf(file);
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        items: content.items
          .filter((item) => typeof item.str === 'string' && item.str.trim())
          .map((item) => ({
            text: item.str.trim(),
            x: item.transform[4],
            top: viewport.height - item.transform[5],
          })),
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
};
