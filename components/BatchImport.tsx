import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Files, Loader2, XCircle } from 'lucide-react';
import { Expense } from '../types';
import { analyzeReceiptFile, buildExpenseFromAi, compressImage, readFileAsDataUrl } from './receiptProcessing';

type NewExpense = Omit<Expense, 'id' | 'tripId'>;

type ItemStatus = 'pending' | 'processing' | 'done' | 'review' | 'cancelled';

type BatchItem = {
  name: string;
  status: ItemStatus;
  message?: string;
  expense?: NewExpense;
};

interface BatchImportProps {
  defaultCurrency: string;
  onImport: (expenses: NewExpense[]) => void;
  onClose: () => void;
  onRunningChange: (running: boolean) => void;
}

const CONCURRENCY = 2;

const formatLine = (expense: NewExpense) =>
  `${expense.date} · ${expense.location || 'Lieu inconnu'} · ${expense.amount.toFixed(2)} ${expense.currency}`;

const BatchImport: React.FC<BatchImportProps> = ({ defaultCurrency, onImport, onClose, onRunningChange }) => {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [phase, setPhase] = useState<'select' | 'running' | 'finished'>('select');
  const [importedCount, setImportedCount] = useState(0);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = (index: number, patch: Partial<BatchItem>) =>
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const processFile = async (file: File): Promise<BatchItem> => {
    let rawDataUrl = '';
    try {
      rawDataUrl = await readFileAsDataUrl(file);
      const { aiData, safeDataUrl, isValid } = await analyzeReceiptFile(file, rawDataUrl);
      if (isValid) {
        return { name: file.name, status: 'done', expense: buildExpenseFromAi(aiData, safeDataUrl, defaultCurrency) };
      }
      return {
        name: file.name,
        status: 'review',
        message: 'Lecture incomplete : ligne ajoutee, a verifier.',
        expense: buildExpenseFromAi(aiData, safeDataUrl, defaultCurrency, `A verifier (${file.name})`),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (!rawDataUrl) {
        return { name: file.name, status: 'review', message: `Fichier illisible : ${detail}` };
      }
      const receipt = file.type.startsWith('image/') ? await compressImage(rawDataUrl) : rawDataUrl;
      return {
        name: file.name,
        status: 'review',
        message: `Erreur IA : ${detail.slice(0, 160)}`,
        expense: buildExpenseFromAi(null, receipt, defaultCurrency, `A verifier (${file.name})`),
      };
    }
  };

  const runBatch = async (files: File[]) => {
    cancelledRef.current = false;
    const initial: BatchItem[] = files.map(file => ({ name: file.name, status: 'pending' }));
    setItems(initial);
    setPhase('running');
    onRunningChange(true);

    const results: BatchItem[] = [...initial];
    let nextIndex = 0;

    const worker = async () => {
      while (!cancelledRef.current) {
        const index = nextIndex++;
        if (index >= files.length) return;
        updateItem(index, { status: 'processing' });
        const result = await processFile(files[index]);
        results[index] = result;
        updateItem(index, result);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

    if (cancelledRef.current) {
      results.forEach((item, i) => {
        if (item.status === 'pending') {
          results[i] = { ...item, status: 'cancelled', message: 'Non traite (arrete).' };
        }
      });
      setItems([...results]);
    }

    const toImport = results.map(item => item.expense).filter((e): e is NewExpense => Boolean(e));
    if (toImport.length > 0) onImport(toImport);
    setImportedCount(toImport.length);
    setPhase('finished');
    onRunningChange(false);
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    if (files.length) void runBatch(files);
  };

  const doneCount = items.filter(i => i.status !== 'pending' && i.status !== 'processing').length;
  const okCount = items.filter(i => i.status === 'done').length;
  const reviewCount = items.filter(i => i.status === 'review').length;
  const progress = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  if (phase === 'select') {
    return (
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          Selectionne plusieurs factures (images ou PDF). Elles seront analysees automatiquement par l'IA puis ajoutees au dossier.
          Tu pourras corriger chaque ligne ensuite depuis la page principale.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center gap-3 p-10 border-2 border-dashed border-slate-300 rounded-2xl hover:bg-teal-50 hover:border-teal-300 transition-all !bg-white"
        >
          <Files size={36} className="text-slate-400" />
          <span className="text-[11px] font-black uppercase text-slate-600 tracking-widest">Choisir les factures</span>
        </button>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleFiles} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
          <span>{phase === 'running' ? `Analyse en cours... ${doneCount}/${items.length}` : 'Traitement termine'}</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div className="bg-teal-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <ul className="max-h-[45vh] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex items-start gap-3 px-4 py-3 text-xs">
            <span className="mt-0.5 shrink-0">
              {item.status === 'pending' && <Clock size={16} className="text-slate-300" />}
              {item.status === 'processing' && <Loader2 size={16} className="animate-spin text-teal-600" />}
              {item.status === 'done' && <CheckCircle size={16} className="text-teal-600" />}
              {item.status === 'review' && <AlertTriangle size={16} className="text-amber-500" />}
              {item.status === 'cancelled' && <XCircle size={16} className="text-slate-400" />}
            </span>
            <div className="min-w-0">
              <div className="font-bold text-slate-800 truncate">{item.name}</div>
              {item.expense && item.status === 'done' && <div className="text-slate-500">{formatLine(item.expense)}</div>}
              {item.message && <div className={item.status === 'review' ? 'text-amber-700' : 'text-slate-500'}>{item.message}</div>}
            </div>
          </li>
        ))}
      </ul>

      {phase === 'running' ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => { cancelledRef.current = true; }}
            className="px-6 py-3 text-xs font-black uppercase tracking-widest text-red-600 border border-red-200 rounded-xl hover:bg-red-50"
          >
            Arreter
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-sm text-teal-900">
            <strong>{importedCount}</strong> ligne(s) ajoutee(s) au dossier : {okCount} reconnue(s)
            {reviewCount > 0 && <>, <span className="text-amber-700 font-bold">{reviewCount} a verifier</span> (montant ou infos a completer via le bouton modifier)</>}.
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="px-10 py-3 bg-teal-700 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-teal-800">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchImport;
