type PrepareReceiptDataUrlsOptions = {
  fileType: string;
  dataUrl: string;
  renderPdfForAnalysis: (dataUrl: string) => Promise<string>;
  compressImage: (dataUrl: string) => Promise<string>;
};

export const isPdfDataUrl = (fileType: string, dataUrl: string) =>
  fileType === 'application/pdf' || dataUrl.startsWith('data:application/pdf');

export const prepareReceiptDataUrls = async ({
  fileType,
  dataUrl,
  renderPdfForAnalysis,
  compressImage,
}: PrepareReceiptDataUrlsOptions) => {
  if (isPdfDataUrl(fileType, dataUrl)) {
    return {
      safeDataUrl: dataUrl,
      aiInputDataUrl: dataUrl,
      fallbackAiInputDataUrl: await renderPdfForAnalysis(dataUrl),
    };
  }

  const safeDataUrl = await compressImage(dataUrl);
  return { safeDataUrl, aiInputDataUrl: safeDataUrl };
};
