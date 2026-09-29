import { AiParsedExpense, Expense, ExpenseCategory, ExpenseStatus } from '../types';
import { parseReceiptImage } from '../services/geminiService';
import { parseReceiptWithFallback } from './receiptAiParsing';
import { prepareReceiptDataUrls } from './receiptPreparation';

const AI_CALL_TIMEOUT_MS = 60_000;
const AI_MAX_RETRIES = 2;

export const renderPdfForAnalysis = async (dataUrl: string): Promise<string> => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('PDF invalide: contenu base64 introuvable.');

  const binary = atob(base64);
  const pdfBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const pdf = await pdfjs.getDocument({ data: pdfBytes }).promise;
  const pageCanvases: HTMLCanvasElement[] = [];
  const targetWidth = 1200;
  const pageGap = 24;
  let compositeWidth = targetWidth;
  let compositeHeight = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, targetWidth / initialViewport.width);
    const viewport = page.getViewport({ scale: Math.max(scale, 1) });

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.ceil(viewport.width);
    pageCanvas.height = Math.ceil(viewport.height);
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) throw new Error('Impossible de preparer le rendu du PDF.');

    await page.render({ canvasContext: pageCtx, viewport }).promise;
    pageCanvases.push(pageCanvas);
    compositeWidth = Math.max(compositeWidth, pageCanvas.width);
    compositeHeight += pageCanvas.height + (pageNumber > 1 ? pageGap : 0);
  }

  if (pageCanvases.length === 0) throw new Error('PDF invalide: aucune page exploitable.');

  const canvas = document.createElement('canvas');
  canvas.width = compositeWidth;
  canvas.height = compositeHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Impossible de preparer le rendu du PDF.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let currentY = 0;
  pageCanvases.forEach((pageCanvas, index) => {
    if (index > 0) currentY += pageGap;
    const offsetX = Math.floor((compositeWidth - pageCanvas.width) / 2);
    ctx.drawImage(pageCanvas, offsetX, currentY);
    currentY += pageCanvas.height;
  });

  return canvas.toDataURL('image/jpeg', 0.86);
};

export const compressImage = (dataUrl: string, maxSize = 1600, quality = 0.82): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });

export const isValidReceiptResult = (aiData: AiParsedExpense) => {
  const amount = Number(aiData.amount);
  const hasValidAmount = Number.isFinite(amount) && amount > 0;
  const hasValidDate = typeof aiData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(aiData.date);
  const hasValidLocation = typeof aiData.location === 'string' && aiData.location.trim().length >= 2 && aiData.location.trim().length <= 120;
  const hasValidCategory = Object.values(ExpenseCategory).includes(aiData.category as ExpenseCategory);
  const confidence = typeof aiData.confidence === 'number' ? aiData.confidence : 1;
  return aiData.isReceipt !== false && confidence >= 0.55 && hasValidAmount && hasValidDate && hasValidLocation && hasValidCategory;
};

export const normalizeCurrency = (value: string | undefined, fallback: string) => {
  const code = (value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
};

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`L'IA n'a pas repondu en ${Math.round(ms / 1000)} s.`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });

const isRetryableError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|rate|quota|503|UNAVAILABLE|overloaded|n'a pas repondu|Failed to fetch|network/i.test(message);
};

const isQuotaExhausted = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /per day|PerDay|daily/i.test(message);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseWithRetry = async (dataUrl: string): Promise<AiParsedExpense> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(parseReceiptImage(dataUrl), AI_CALL_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
      if (attempt === AI_MAX_RETRIES || !isRetryableError(error) || isQuotaExhausted(error)) break;
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export type ReceiptAnalysis = {
  aiData: AiParsedExpense | null;
  safeDataUrl: string;
  isValid: boolean;
};

export const analyzeReceiptFile = async (file: File, dataUrl?: string): Promise<ReceiptAnalysis> => {
  const rawDataUrl = dataUrl ?? (await readFileAsDataUrl(file));
  const prepared = await prepareReceiptDataUrls({
    fileType: file.type,
    dataUrl: rawDataUrl,
    renderPdfForAnalysis,
    compressImage,
  });

  const aiData = await parseReceiptWithFallback({
    primaryDataUrl: prepared.aiInputDataUrl,
    fallbackDataUrl: prepared.fallbackAiInputDataUrl,
    parse: parseWithRetry,
    isValid: isValidReceiptResult,
  });

  return { aiData, safeDataUrl: prepared.safeDataUrl, isValid: isValidReceiptResult(aiData) };
};

export const buildExpenseFromAi = (
  aiData: AiParsedExpense | null,
  safeDataUrl: string,
  fallbackCurrency: string,
  description = '',
): Omit<Expense, 'id' | 'tripId'> => {
  const category = aiData?.category && Object.values(ExpenseCategory).includes(aiData.category)
    ? aiData.category
    : ExpenseCategory.Misc;
  const amount = Number(aiData?.amount);
  return {
    date: aiData?.date && /^\d{4}-\d{2}-\d{2}$/.test(aiData.date) ? aiData.date : new Date().toISOString().split('T')[0],
    category,
    location: (aiData?.location || '').slice(0, 120),
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    currency: normalizeCurrency(aiData?.currency, fallbackCurrency),
    status: ExpenseStatus.Draft,
    receiptDataUrl: safeDataUrl,
    description,
    hotelNights: aiData?.hotelNights || (category === ExpenseCategory.Hotel ? 1 : 0),
    hotelBreakfasts: aiData?.hotelBreakfasts || 0,
  };
};
