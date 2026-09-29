import React, { useState, useRef, useEffect } from 'react';
import { Expense, ExpenseCategory, ExpenseStatus } from '../types';
import { analyzeReceiptFile, normalizeCurrency, readFileAsDataUrl } from './receiptProcessing';
import { Loader2, Camera, Upload, AlertCircle, Moon, Coffee } from 'lucide-react';

interface ExpenseFormProps {
  initialData?: Expense | null;
  defaultCurrency?: string;
  onSubmit: (expenseData: Omit<Expense, 'id' | 'tripId'>) => void;
  onClose: () => void;
}

const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY'];

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

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setFormData(prev => ({ ...prev, receiptDataUrl: dataUrl }));
      const { aiData, safeDataUrl, isValid } = await analyzeReceiptFile(file, dataUrl);
      setFormData(prev => ({
        ...prev,
        receiptDataUrl: safeDataUrl,
        date: aiData?.date || prev.date,
        amount: aiData?.amount || prev.amount,
        currency: normalizeCurrency(aiData?.currency, prev.currency),
        location: aiData?.location && aiData.location.length <= 120 ? aiData.location : prev.location,
        category: aiData?.category && Object.values(ExpenseCategory).includes(aiData.category) ? aiData.category : prev.category,
        hotelNights: aiData?.hotelNights || (aiData?.category === ExpenseCategory.Hotel ? 1 : prev.hotelNights),
        hotelBreakfasts: aiData?.hotelBreakfasts || prev.hotelBreakfasts || 0
      }));
      if (!isValid) setError('Ce fichier ne ressemble pas a une facture exploitable. Complete la ligne manuellement.');
    } catch (err: unknown) {
      console.error('Receipt AI error:', err);
      setError(`Erreur IA : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  const currencyOptions = COMMON_CURRENCIES.includes(formData.currency)
    ? COMMON_CURRENCIES
    : [...COMMON_CURRENCIES, formData.currency];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!initialData && (
        <div className="space-y-4">
          <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Capture par IA</label>
          {isProcessing ? (
            <div className="flex flex-col items-center justify-center p-12 border-4 border-dashed border-teal-200 rounded-[2rem] bg-teal-50 animate-pulse">
              <Loader2 className="animate-spin text-teal-600 mb-4" size={40} />
              <p className="text-sm font-black text-teal-700 uppercase tracking-tight">Lecture du justificatif...</p>
            </div>
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
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest leading-tight text-center">Importer un fichier</span>
              </button>
            </div>
          )}
          <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
          <input type="file" ref={uploadInputRef} accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-center gap-3 text-xs font-bold border border-red-100">
          <AlertCircle size={18}/> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Date</label>
          <input type="date" required className="w-full !bg-white border border-slate-300 rounded-xl px-4 py-4 font-bold !text-black outline-none shadow-sm focus:border-teal-600 transition-all" value={formData.date} onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[11px] font-black uppercase text-slate-400 tracking-widest">Montant</label>
          <div className="flex">
            <input type="number" step="0.01" required className="flex-1 min-w-0 !bg-white border border-slate-300 border-r-0 rounded-l-xl px-4 py-4 font-black !text-black outline-none shadow-sm focus:border-teal-600 transition-all" value={formData.amount} onChange={(e) => setFormData(prev => ({ ...prev, amount: parseFloat(e.target.value) }))} />
            <select className="!bg-white border border-slate-300 rounded-r-xl px-3 py-4 font-black !text-black shadow-sm" value={formData.currency} onChange={(e) => setFormData(prev => ({...prev, currency: e.target.value}))}>
              {currencyOptions.map(code => <option key={code} value={code}>{code}</option>)}
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
    </form>
  );
};

export default ExpenseForm;
