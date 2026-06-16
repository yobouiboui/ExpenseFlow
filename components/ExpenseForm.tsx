import React, { useState, useRef, useEffect } from 'react';
import { AiParsedExpense, Expense, ExpenseCategory, ExpenseStatus } from '../types';
import { parseReceiptImage } from '../services/geminiService';
import { parseReceiptWithFallback } from './receiptAiParsing';
import { prepareReceiptDataUrls } from './receiptPreparation';
import { Loader2, Camera, Upload, AlertCircle, CheckCircle, Moon, Coffee } from 'lucide-react';

interface ExpenseFormProps {
  initialData?: Expense | null;
  defaultCurrency?: string;
  onSubmit: (expenseData: Omit<Expense, 'id' | 'tripId'>) => void;
  onClose: () => void;
}

const ExpenseForm: React.FC<ExpenseFormProps> = ({ initialData, defaultCurrency = 'EUR', onSubmit, onClose }) => {
  const [formData, setFormData] = useState<Omit<Expense, 'id' | 'tripId'>>({
    date: new Date().toISOString().split('T')[0],
    category: ExpenseCategory.Meals,
    location: '',
    amount: 0,
    currency: defaultCurrency,
    status: ExpenseStatus.Draft,
    receiptDataUrl: '',
    description: '',
    hotelNights: 0,
    hotelBreakfasts: 0
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Batch processing state
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchCurrent, setBatchCurrent] = useState(0);
  const [batchErrors, setBatchErrors] = useState(0);
  const isBatchMode = batchTotal > 1;

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  class ReceiptValidationError extends Error {
    constructor(
      message: string,
      public safeDataUrl: string,
      public aiData?: AiParsedExpense
    ) {
      super(message);
      this.name = 'ReceiptValidationError';
    }
  }

  const renderPdfForAnalysis = async (dataUrl: string): Promise<string> => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

    const base64 = dataUrl.split(',')[1];
    if (!base64) {
      throw new Error('PDF invalide: contenu base64 introuvable.');
    }

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

      if (!pageCtx) {
        throw new Error('Impossible de preparer le rendu du PDF.');
      }

      await page.render({ canvasContext: pageCtx, viewport }).promise;
      pageCanvases.push(pageCanvas);
      compositeWidth = Math.max(compositeWidth, pageCanvas.width);
      compositeHeight += pageCanvas.height + (pageNumber > 1 ? pageGap : 0);
    }

    if (pageCanvases.length === 0) {
      throw new Error('PDF invalide: aucune page exploitable.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = compositeWidth;
    canvas.height = compositeHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Impossible de preparer le rendu du PDF.');
    }

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

  const compressImage = (dataUrl: string, maxSize = 1600, quality = 0.82): Promise<string> => {
    return new Promise((resolve) => {
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
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const prepareFileForAnalysis = async (file: File, dataUrl: string) => {
    return prepareReceiptDataUrls({
      fileType: file.type,
      dataUrl,
      renderPdfForAnalysis,
      compressImage,
    });
  };

  const parsePreparedReceipt = async (preparedReceipt: Awaited<ReturnType<typeof prepareFileForAnalysis>>) =>
    parseReceiptWithFallback({
      primaryDataUrl: preparedReceipt.aiInputDataUrl,
      fallbackDataUrl: preparedReceipt.fallbackAiInputDataUrl,
      parse: parseReceiptImage,
      isValid: isValidReceiptResult,
    });

  const isValidReceiptResult = (aiData: AiParsedExpense) => {
    const allowedCategories = Object.values(ExpenseCategory);
    const amount = Number(aiData.amount);
    const hasValidAmount = Number.isFinite(amount) && amount > 0;
    const hasValidDate = typeof aiData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(aiData.date);
    const hasValidLocation = typeof aiData.location === 'string' && aiData.location.trim().length >= 2 && aiData.location.trim().length <= 120;
    const hasValidCategory = allowedCategories.includes(aiData.category as ExpenseCategory);
    const confidence = typeof aiData.confidence === 'number' ? aiData.confidence : 1;

    return aiData.isReceipt !== false && confidence >= 0.55 && hasValidAmount && hasValidDate && hasValidLocation && hasValidCategory;
  };

  const applyAiDataToManualForm = (aiData: AiParsedExpense | undefined, safeDataUrl: string) => {
    setFormData(prev => {
      const allowedCurrencies = ['EUR', 'USD'];
      const aiCurrency = aiData?.currency?.toUpperCase?.() || '';
      const safeCurrency = allowedCurrencies.includes(aiCurrency) ? aiCurrency : prev.currency;
      return {
        ...prev,
        receiptDataUrl: safeDataUrl,
        date: aiData?.date || prev.date,
        amount: aiData?.amount || prev.amount,
        currency: safeCurrency,
        location: aiData?.location && aiData.location.length <= 120 ? aiData.location : prev.location,
        category: aiData?.category || prev.category,
        hotelNights: aiData?.hotelNights || (aiData?.category === ExpenseCategory.Hotel ? 1 : prev.hotelNights),
        hotelBreakfasts: aiData?.hotelBreakfasts || prev.hotelBreakfasts || 0
      };
    });
  };

  const parseAndValidateReceipt = async (file: File, dataUrl: string) => {
    const preparedReceipt = await prepareFileForAnalysis(file, dataUrl);
    const aiData = await parsePreparedReceipt(preparedReceipt);

    if (!isValidReceiptResult(aiData)) {
      throw new ReceiptValidationError('Ce fichier ne ressemble pas a une facture exploitable.', preparedReceipt.safeDataUrl, aiData);
    }

    return { aiData, safeDataUrl: preparedReceipt.safeDataUrl };
  };

  useEffect(() => {
    if (initialData) {
      setFormData({
        date: initialData.date,
        category: initialData.category,
        location: initialData.location,
        amount: initialData.amount,
        currency: initialData.currency,
        status: initialData.status,
        receiptDataUrl: initialData.receiptDataUrl || '',
        description: initialData.description || '',
        hotelNights: initialData.hotelNights || 0,
        hotelBreakfasts: initialData.hotelBreakfasts || 0
      });
    }
  }, [initialData]);

  const buildExpenseFromAi = (
    aiData: Awaited<ReturnType<typeof parseReceiptImage>>,
    safeDataUrl: string,
    fallbackCurrency = 'EUR'
  ): Omit<Expense, 'id' | 'tripId'> => {
    const allowedCurrencies = ['EUR', 'USD'];
    const aiCurrency = aiData.currency?.toUpperCase?.() || '';
    const safeCurrency = allowedCurrencies.includes(aiCurrency) ? aiCurrency : fallbackCurrency;
    return {
      date: aiData.date || new Date().toISOString().split('T')[0],
      category: aiData.category || ExpenseCategory.Meals,
      location: aiData.location || '',
      amount: aiData.amount || 0,
      currency: safeCurrency,
      status: ExpenseStatus.Draft,
      receiptDataUrl: safeDataUrl,
      description: '',
      hotelNights: aiData.hotelNights || (aiData.category === ExpenseCategory.Hotel ? 1 : 0),
      hotelBreakfasts: aiData.hotelBreakfasts || 0
    };
  };

  /** Multi-file batch: process each file with AI and auto-submit, then close. */
  const handleBatchFiles = async (files: File[]) => {
    setBatchTotal(files.length);
    setBatchCurrent(0);
    setBatchErrors(0);
    setIsProcessing(true);
    setError(null);

    let errors = 0;
    for (let i = 0; i < files.length; i++) {
      setBatchCurrent(i + 1);
      try {
        const dataUrl = await readFileAsDataUrl(files[i]);
        const { aiData, safeDataUrl } = await parseAndValidateReceipt(files[i], dataUrl);
        onSubmit(buildExpenseFromAi(aiData, safeDataUrl, defaultCurrency));
      } catch (err) {
        errors++;
        const detail = err instanceof Error ? err.message : String(err);
        if (err instanceof ReceiptValidationError) {
          applyAiDataToManualForm(err.aiData, err.safeDataUrl);
          setBatchErrors(errors);
          setBatchTotal(0);
          setBatchCurrent(0);
          setIsProcessing(false);
          setError(`Traitement arrete au fichier ${i + 1}/${files.length}. ${detail} Complete la ligne manuellement, puis valide-la.`);
          return;
        }
        setBatchErrors(errors);
        setBatchTotal(0);
        setBatchCurrent(0);
        setIsProcessing(false);
        setError(`Traitement arrete au fichier ${i + 1}/${files.length}. Erreur IA : ${detail}. Complete cette facture manuellement.`);
        return;
      }
    }

    setBatchErrors(errors);
    setIsProcessing(false);

    // Brief pause so user can read the summary, then close
    setTimeout(onClose, errors > 0 ? 2000 : 800);
  };

  /** Single-file: populate form fields for manual review before submit. */
  const handleSingleFile = (file: File, base64Data: string) => {
    const processAsync = async () => {
      const preparedReceipt = await prepareFileForAnalysis(file, base64Data);
      const { safeDataUrl } = preparedReceipt;
      setFormData(prev => ({ ...prev, receiptDataUrl: safeDataUrl }));
      try {
        const aiData = await parsePreparedReceipt(preparedReceipt);
        if (!isValidReceiptResult(aiData)) {
          applyAiDataToManualForm(aiData, safeDataUrl);
          setError('Ce fichier ne ressemble pas a une facture exploitable. Complete la ligne manuellement.');
          return;
        }
        setFormData(prev => {
          const allowedCurrencies = ['EUR', 'USD'];
          const aiCurrency = aiData.currency?.toUpperCase?.() || '';
          const safeCurrency = allowedCurrencies.includes(aiCurrency) ? aiCurrency : prev.currency;
          return {
            ...prev,
            date: aiData.date || prev.date,
            amount: aiData.amount || prev.amount,
            currency: safeCurrency,
            location: aiData.location || prev.location,
            category: aiData.category || prev.category,
            hotelNights: aiData.hotelNights || (aiData.category === ExpenseCategory.Hotel ? 1 : 0),
            hotelBreakfasts: aiData.hotelBreakfasts || 0
          };
        });
      } catch (err: unknown) {
        console.error("❌ Gemini OCR error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Erreur IA : ${msg}`);

      } finally {
        setIsProcessing(false);
      }
    };

    processAsync();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;

    setIsProcessing(true);
    setError(null);
    e.target.value = '';

    if (files.length > 1) {
      await handleBatchFiles(files);
      return;
    }

    // Single file — use FileReader callback (existing behaviour)
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Data = event.target?.result as string;
      handleSingleFile(files[0], base64Data);
    };
    reader.readAsDataURL(files[0]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!initialData && (
        <div className="space-y-4">
          <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Capture par IA Gemini</label>
          {isProcessing ? (
            isBatchMode ? (
              /* Batch progress UI */
              <div className="flex flex-col items-center justify-center p-12 border-4 border-dashed border-teal-200 rounded-[2rem] bg-teal-50 space-y-4">
                <Loader2 className="animate-spin text-teal-600" size={40} />
                <p className="text-sm font-black text-teal-700 uppercase tracking-tight text-center">
                  Traitement {batchCurrent}/{batchTotal}...
                </p>
                {/* Progress bar */}
                <div className="w-full bg-teal-100 rounded-full h-2">
                  <div
                    className="bg-teal-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((batchCurrent / batchTotal) * 100)}%` }}
                  />
                </div>
                {batchErrors > 0 && (
                  <p className="text-xs text-amber-600 font-bold">{batchErrors} fichier(s) non reconnu(s)</p>
                )}
              </div>
            ) : (
              /* Single file loading UI */
              <div className="flex flex-col items-center justify-center p-12 border-4 border-dashed border-teal-200 rounded-[2rem] bg-teal-50 animate-pulse">
                <Loader2 className="animate-spin text-teal-600 mb-4" size={40} />
                <p className="text-sm font-black text-teal-700 uppercase tracking-tight">Lecture du justificatif...</p>
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={() => cameraInputRef.current?.click()} className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-slate-200 rounded-[2rem] hover:bg-teal-50 hover:border-teal-300 transition-all group !bg-white">
                <div className="bg-slate-50 p-4 rounded-2xl group-hover:bg-teal-100 transition-colors">
                  <Camera size={32} className="text-slate-400 group-hover:text-teal-600" />
                </div>
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Prendre Photo</span>
              </button>
              <button type="button" onClick={() => uploadInputRef.current?.click()} className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-slate-200 rounded-[2rem] hover:bg-teal-50 hover:border-teal-300 transition-all group !bg-white">
                <div className="bg-slate-50 p-4 rounded-2xl group-hover:bg-teal-100 transition-colors">
                  <Upload size={32} className="text-slate-400 group-hover:text-teal-600" />
                </div>
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest leading-tight text-center">
                  Importer<br/>1 ou plusieurs fichiers
                </span>
              </button>
            </div>
          )}
          <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
          <input type="file" ref={uploadInputRef} accept="image/*,application/pdf" multiple className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-3 text-xs font-bold border border-red-100">
          <AlertCircle size={18}/> {error}
        </div>
      )}

      {/* Hide form fields during batch processing */}
      {!isBatchMode && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Date</label>
              <input type="date" required className="w-full !bg-white border border-slate-300 rounded-xl px-4 py-4 font-bold !text-black outline-none shadow-sm focus:border-teal-600 transition-all" value={formData.date} onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Montant</label>
              <div className="flex">
                <input type="number" step="0.01" required className="flex-1 !bg-white border border-slate-300 border-r-0 rounded-l-xl px-4 py-4 font-black !text-black outline-none shadow-sm focus:border-teal-600 transition-all" value={formData.amount} onChange={(e) => setFormData(prev => ({ ...prev, amount: parseFloat(e.target.value) }))} />
                <select className="!bg-white border border-slate-300 rounded-r-xl px-4 py-4 font-black !text-black shadow-sm" value={formData.currency} onChange={(e) => setFormData(prev => ({...prev, currency: e.target.value}))}>
                  <option value="EUR">€</option>
                  <option value="USD">$</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Catégorie</label>
            <select className="w-full !bg-white border border-slate-300 rounded-xl px-4 py-4 font-bold !text-black outline-none shadow-sm focus:border-teal-600 transition-all" value={formData.category} onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as ExpenseCategory }))}>
              {Object.values(ExpenseCategory).map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          {/* CHAMPS SPÉCIFIQUES HOTEL */}
          {formData.category === ExpenseCategory.Hotel && (
            <div className="grid grid-cols-2 gap-4 bg-teal-50 p-4 rounded-xl border border-teal-200 animate-in fade-in slide-in-from-top-2">
               <div className="space-y-1.5">
                  <label className="block text-[10px] font-black uppercase text-teal-500 tracking-widest flex items-center gap-1">
                     <Moon size={12}/> Nuits
                  </label>
                  <input type="number" min="0" className="w-full !bg-white border border-teal-200 rounded-lg px-3 py-2 font-bold text-teal-900 outline-none focus:ring-2 focus:ring-teal-200" value={formData.hotelNights || 0} onChange={(e) => setFormData(prev => ({...prev, hotelNights: parseInt(e.target.value) || 0}))} />
               </div>
               <div className="space-y-1.5">
                  <label className="block text-[10px] font-black uppercase text-teal-500 tracking-widest flex items-center gap-1">
                     <Coffee size={12}/> Petits-déj.
                  </label>
                  <input type="number" min="0" className="w-full !bg-white border border-teal-200 rounded-lg px-3 py-2 font-bold text-teal-900 outline-none focus:ring-2 focus:ring-teal-200" value={formData.hotelBreakfasts || 0} onChange={(e) => setFormData(prev => ({...prev, hotelBreakfasts: parseInt(e.target.value) || 0}))} />
               </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Lieu / Marchand</label>
            <input type="text" required className="w-full !bg-white border border-slate-300 rounded-xl px-4 py-4 font-bold !text-black outline-none shadow-sm focus:border-teal-600 transition-all" value={formData.location} onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))} placeholder="Ex: Shell Paris, Novotel Lyon..." />
          </div>

          <div className="pt-6 flex justify-end gap-4">
            <button type="button" onClick={onClose} className="px-6 py-4 font-black text-slate-500 hover:text-slate-700">Annuler</button>
            <button type="submit" disabled={isProcessing} className="px-12 py-4 bg-teal-700 text-white rounded-2xl font-black shadow-xl hover:bg-teal-800 active:scale-95 transition-all disabled:opacity-50 uppercase tracking-widest">Valider</button>
          </div>
        </>
      )}
    </form>
  );
};

export default ExpenseForm;
