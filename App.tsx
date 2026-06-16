import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Calendar,
  CalendarDays,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Globe,
  LogOut,
  MapPin,
  Paperclip,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import JSZip from 'jszip';
import ExpenseForm from './components/ExpenseForm';
import ExpenseTable from './components/ExpenseTable';
import LoginScreen from './components/LoginScreen';
import Modal from './components/Modal';
import {
  clearSupabaseConfig,
  isSupabaseEnabled,
  saveSupabaseConfig,
  supabase,
} from './services/supabaseClient';
import {
  DEFAULT_MODEL_GEMINI,
  DEFAULT_MODEL_OPENAI,
  DEFAULT_PROVIDER,
  generateReimbursementEmail,
  getStoredGeminiKey,
  getStoredModel,
  getStoredOpenAIKey,
  getStoredProvider,
  saveGeminiKey,
  saveModel,
  saveOpenAIKey,
  saveProvider,
} from './services/geminiService';
import { ArchivedTrip, EmailDraft, Expense, ExpenseCategory, ExpenseStatus, TripMetadata } from './types';

const STORAGE_KEY_EXPENSES = 'expenseFlow_expenses_prod_v1';
const STORAGE_KEY_ARCHIVE = 'expenseFlow_archive_prod_v1';
const STORAGE_KEY_TRIP = 'expenseFlow_trip_prod_v1';
const SESSION_KEY_AUTH = 'expenseFlow_auth_prod_v1';
const STORAGE_KEY_LAST_SYNC = 'expenseFlow_lastSync_prod_v1';
const STORAGE_KEY_CURRENCY = 'expenseFlow_currency_v1';

const generateId = () => Math.random().toString(36).substr(2, 9);

const safeArray = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const safeJsonParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toSafeString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

const toSafeAmount = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const toSafeDate = (value: unknown) => {
  const raw = toSafeString(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw.includes('T') && !Number.isNaN(new Date(raw).getTime())) return raw.split('T')[0];

  const europeanDate = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (europeanDate) {
    const [, day, month, year] = europeanDate;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

  return new Date().toISOString().split('T')[0];
};

const getDateParts = (value: unknown) => {
  const [year, month, day] = toSafeDate(value).split('-').map((part) => Number.parseInt(part, 10));
  return { year, month, day };
};

const getReferenceYear = (expenseList: Expense[], trip?: TripMetadata) => {
  const yearCounts = expenseList.reduce<Record<number, number>>((acc, expense) => {
    const { year } = getDateParts(expense.date);
    if (Number.isFinite(year)) acc[year] = (acc[year] || 0) + 1;
    return acc;
  }, {});
  const [mostCommonYear] = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0] || [];
  if (mostCommonYear) return Number.parseInt(mostCommonYear, 10);

  const tripYear = trip?.departureDate ? getDateParts(trip.departureDate).year : null;
  if (tripYear && Number.isFinite(tripYear)) return tripYear;

  return new Date().getFullYear();
};

const toTimelineDate = (value: unknown, referenceYear: number) => {
  const { month, day } = getDateParts(value);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return toSafeDate(value);
  return `${referenceYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const toSafeCategory = (value: unknown): ExpenseCategory => {
  return Object.values(ExpenseCategory).includes(value as ExpenseCategory)
    ? (value as ExpenseCategory)
    : ExpenseCategory.Misc;
};

const normalizeExpense = (expense: Partial<Expense>): Expense => ({
  id: toSafeString(expense.id, generateId()),
  tripId: toSafeString(expense.tripId),
  date: toSafeDate(expense.date),
  category: toSafeCategory(expense.category),
  location: toSafeString(expense.location, 'Non specifie'),
  amount: toSafeAmount(expense.amount),
  currency: toSafeString(expense.currency, 'EUR').toUpperCase(),
  status: Object.values(ExpenseStatus).includes(expense.status as ExpenseStatus) ? (expense.status as ExpenseStatus) : ExpenseStatus.Draft,
  receiptDataUrl: toSafeString(expense.receiptDataUrl),
  description: toSafeString(expense.description),
  hotelNights: Math.max(0, Math.trunc(toSafeAmount(expense.hotelNights))),
  hotelBreakfasts: Math.max(0, Math.trunc(toSafeAmount(expense.hotelBreakfasts))),
});

const normalizeExpenses = (value: unknown): Expense[] =>
  Array.isArray(value) ? value.map((expense) => normalizeExpense(expense as Partial<Expense>)) : [];

const sortExpensesChronologically = (expenseList: Expense[]) =>
  [...expenseList].sort((a, b) => {
    const dateCompare = toSafeDate(a.date).localeCompare(toSafeDate(b.date));
    if (dateCompare !== 0) return dateCompare;
    const locationCompare = toSafeString(a.location).localeCompare(toSafeString(b.location), 'fr-FR');
    if (locationCompare !== 0) return locationCompare;
    return toSafeString(a.id).localeCompare(toSafeString(b.id));
  });

const sortExpensesByTimeline = (expenseList: Expense[], referenceYear: number) =>
  [...expenseList].sort((a, b) => {
    const dateCompare = toTimelineDate(a.date, referenceYear).localeCompare(toTimelineDate(b.date, referenceYear));
    if (dateCompare !== 0) return dateCompare;
    const locationCompare = toSafeString(a.location).localeCompare(toSafeString(b.location), 'fr-FR');
    if (locationCompare !== 0) return locationCompare;
    return toSafeString(a.id).localeCompare(toSafeString(b.id));
  });

const stripReceiptPayloads = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripReceiptPayloads);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'receiptDataUrl' ? '' : stripReceiptPayloads(entry),
      ])
    );
  }
  return value;
};

const persistJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    try {
      localStorage.setItem(key, JSON.stringify(stripReceiptPayloads(value)));
      return;
    } catch {
      // Keep the app running even if the browser storage quota is exhausted.
    }
    console.warn(`Unable to persist ${key}`, error);
  }
};

const createNewTrip = (name: string = 'Nouveau Voyage'): TripMetadata => ({
  id: generateId(),
  status: 'active',
  startDateManual: null,
  endDateManual: null,
  name,
  departureLocation: 'Hamburg, Germany',
  destinationCountry: '',
  departureDate: '',
  returnDate: '',
});

const isTripEmpty = (trip: TripMetadata) => {
  const name = (trip.name || '').toLowerCase();
  const isDefaultName = name === 'nouveau voyage' || name === 'voyage professionnel';
  const location = (trip.departureLocation || '').toLowerCase();
  const isDefaultLocation = !location || location === 'hamburg, germany';
  return !trip.departureDate && !trip.returnDate && !trip.destinationCountry && isDefaultLocation && isDefaultName;
};

const formatShortDate = (dateStr: string | null) => {
  if (!dateStr) return '';
  const safeDateStr = String(dateStr);
  const value = safeDateStr.includes('T') ? safeDateStr.split('T')[0] : safeDateStr;
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year.slice(2)}` : safeDateStr;
};

const formatDateTime = (dateStr: string | null) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date
    .toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', ' ·');
};

const formatDayLabel = (dateStr: string) => {
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const getDayNumber = (dateStr: string, referenceYear?: number) => {
  const safeDate = referenceYear ? toTimelineDate(dateStr, referenceYear) : toSafeDate(dateStr);
  const date = new Date(`${safeDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 86400000);
};

const formatTimelineOffset = (dateStr: string, baseDateStr: string | null, referenceYear: number) => {
  if (!baseDateStr) return 'J+0';
  const currentDay = getDayNumber(dateStr, referenceYear);
  const baseDay = getDayNumber(baseDateStr, referenceYear);
  if (currentDay === null || baseDay === null) return 'J+0';
  const diff = currentDay - baseDay;
  return diff >= 0 ? `J+${diff}` : `J${diff}`;
};

const formatAmount = (amount: number) =>
  toSafeAmount(amount).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const CATEGORY_LABELS: Record<string, string> = {
  Meals: 'Repas',
  Hotel: 'Hotel',
  Taxi: 'Taxi',
  Transport: 'Transport',
  Parking: 'Parking',
  Fuel: 'Carburant',
  Tolls: 'Peage',
  Misc: 'Divers',
};

const CATEGORY_STYLES: Record<string, string> = {
  Meals: 'bg-[#e8f1ff] text-[#1f4f99]',
  Hotel: 'bg-[#dcecff] text-[#17427f]',
  Taxi: 'bg-[#eef5ff] text-[#345f9a]',
  Transport: 'bg-[#e3efff] text-[#214f8c]',
  Parking: 'bg-[#f2f7ff] text-[#4d668c]',
  Fuel: 'bg-[#e6f0ff] text-[#305485]',
  Tolls: 'bg-[#edf4ff] text-[#3d5f8d]',
  Misc: 'bg-[#f1f6ff] text-[#486487]',
};

interface SupabaseConfigPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  configUrl: string;
  configKey: string;
  setConfigUrl: (value: string) => void;
  setConfigKey: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  forceOpen?: boolean;
}

function SupabaseConfigPanel({
  isOpen,
  onToggle,
  configUrl,
  configKey,
  setConfigUrl,
  setConfigKey,
  onSave,
  onClear,
  forceOpen,
}: SupabaseConfigPanelProps) {
  const showContent = forceOpen || isOpen;

  return (
    <div className="overflow-hidden border border-[#d8d0c3]">
      {!forceOpen && (
        <button type="button" onClick={onToggle} className="flex w-full items-center justify-between bg-[#f4eee4] px-4 py-3 text-xs font-medium text-[#4a443c]">
          <span>Configurer Supabase</span>
          <span>{isOpen ? '▲' : '▼'}</span>
        </button>
      )}
      {showContent && (
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#4a443c]">URL du projet</label>
            <input
              type="url"
              value={configUrl}
              onChange={(e) => setConfigUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co"
              className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-3 py-2 text-xs outline-none focus:border-[#1a1a1a]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#4a443c]">Cle anonyme</label>
            <input
              type="password"
              value={configKey}
              onChange={(e) => setConfigKey(e.target.value)}
              placeholder="eyJ..."
              className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-3 py-2 text-xs outline-none focus:border-[#1a1a1a]"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onSave} disabled={!configUrl || !configKey} className="flex-1 border border-[#1f4f99] bg-[#1f4f99] px-3 py-2 text-xs uppercase tracking-[0.15em] text-[#f7f3ea] disabled:opacity-40">
              Sauvegarder
            </button>
            <button type="button" onClick={onClear} className="border border-[#0a0a0a] px-3 py-2 text-xs uppercase tracking-[0.15em]">
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] font-medium ${CATEGORY_STYLES[category] || 'bg-[#efe7dc] text-[#5b5245]'}`}>
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem(SESSION_KEY_AUTH) === 'true');
  const [activeTab, setActiveTab] = useState<'expenses' | 'reports'>('expenses');
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    return normalizeExpenses(safeJsonParse<unknown>(localStorage.getItem(STORAGE_KEY_EXPENSES), []));
  });
  const [archivedTrips, setArchivedTrips] = useState<ArchivedTrip[]>(() => {
    const saved = safeJsonParse<ArchivedTrip[]>(localStorage.getItem(STORAGE_KEY_ARCHIVE), []);
    return safeArray(saved).map((archive) => ({ ...archive, expenses: normalizeExpenses(archive.expenses) }));
  });
  const [trip, setTrip] = useState<TripMetadata>(() => {
    return safeJsonParse<TripMetadata>(localStorage.getItem(STORAGE_KEY_TRIP), createNewTrip('Voyage Professionnel'));
  });
  const [notification, setNotification] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<ArchivedTrip | null>(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncEmail, setSyncEmail] = useState('');
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY_LAST_SYNC));
  const [hasHydratedFromRemote, setHasHydratedFromRemote] = useState(false);
  const [archiveSearchTerm, setArchiveSearchTerm] = useState('');
  const [tripCurrency, setTripCurrency] = useState(() => localStorage.getItem(STORAGE_KEY_CURRENCY) || 'EUR');
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => getStoredGeminiKey());
  const [geminiKeySaved, setGeminiKeySaved] = useState(Boolean(getStoredGeminiKey()));
  const [aiProvider, setAiProvider] = useState(() => getStoredProvider());
  const [aiModel, setAiModel] = useState(() => getStoredModel());
  const [openAIKeyInput, setOpenAIKeyInput] = useState(() => getStoredOpenAIKey());
  const [openAIKeySaved, setOpenAIKeySaved] = useState(Boolean(getStoredOpenAIKey()));
  const [isConfigPanelOpen, setIsConfigPanelOpen] = useState(false);
  const [configUrl, setConfigUrl] = useState('');
  const [configKey, setConfigKey] = useState('');

  const aiKeyActive = aiProvider === 'gemini' ? geminiKeySaved : openAIKeySaved;
  const departureInputRef = useRef<HTMLInputElement>(null);
  const returnInputRef = useRef<HTMLInputElement>(null);
  const syncTimerRef = useRef<number | null>(null);

  useEffect(() => { persistJson(STORAGE_KEY_EXPENSES, expenses); }, [expenses]);
  useEffect(() => { persistJson(STORAGE_KEY_ARCHIVE, archivedTrips); }, [archivedTrips]);
  useEffect(() => { persistJson(STORAGE_KEY_TRIP, trip); }, [trip]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_CURRENCY, tripCurrency); }, [tripCurrency]);

  const sortedExpenses = useMemo(() => sortExpensesChronologically(expenses), [expenses]);
  const timelineReferenceYear = useMemo(() => getReferenceYear(sortedExpenses, trip), [sortedExpenses, trip.departureDate]);
  const timelineExpenses = useMemo(() => sortExpensesByTimeline(sortedExpenses, timelineReferenceYear), [sortedExpenses, timelineReferenceYear]);

  const localStateEmpty = expenses.length === 0 && archivedTrips.length === 0 && isTripEmpty(trip);
  const syncEnabled = isSupabaseEnabled && !!supabaseUser;

  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) setSupabaseUser(data.session?.user ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseUser(session?.user ?? null);
    });
    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!syncEnabled || !supabase || !supabaseUser) {
      setHasHydratedFromRemote(false);
      return;
    }
    let cancelled = false;

    const hydrateFromRemote = async () => {
      setIsSyncing(true);
      setSyncError(null);

      const { data, error } = await supabase
        .from('trip_state')
        .select('expenses, archived_trips, trip, updated_at')
        .eq('user_id', supabaseUser.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setSyncError(error.message);
        setIsSyncing(false);
        setHasHydratedFromRemote(true);
        return;
      }

      if (!data) {
        const payload = {
          user_id: supabaseUser.id,
          expenses,
          archived_trips: archivedTrips,
          trip,
          updated_at: new Date().toISOString(),
        };
        const { error: insertError } = await supabase.from('trip_state').insert(payload);
        if (insertError) {
          setSyncError(insertError.message);
        } else {
          const now = new Date().toISOString();
          setLastSyncAt(now);
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, now);
        }
        setIsSyncing(false);
        setHasHydratedFromRemote(true);
        return;
      }

      const localArchiveIds = new Set(archivedTrips.map((archive) => archive.id));
      const newRemoteArchives = safeArray(data.archived_trips)
        .filter((archive) => !localArchiveIds.has(archive.id))
        .map((archive) => ({ ...archive, expenses: sortExpensesChronologically(normalizeExpenses(archive.expenses)) }));
      if (newRemoteArchives.length > 0) setArchivedTrips((prev) => [...prev, ...newRemoteArchives]);

      if (localStateEmpty) {
        setExpenses(sortExpensesChronologically(normalizeExpenses(data.expenses)));
        setTrip((data.trip as TripMetadata) || createNewTrip());
      }

      const remoteSyncTime = data.updated_at ? new Date(data.updated_at).toISOString() : new Date().toISOString();
      setLastSyncAt(remoteSyncTime);
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, remoteSyncTime);
      setIsSyncing(false);
      setHasHydratedFromRemote(true);
    };

    hydrateFromRemote();
    return () => {
      cancelled = true;
    };
  }, [archivedTrips, expenses, localStateEmpty, syncEnabled, supabaseUser?.id, trip]);

  useEffect(() => {
    if (!syncEnabled || !supabase || !supabaseUser || !hasHydratedFromRemote) return;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(async () => {
      setIsSyncing(true);
      setSyncError(null);
      const payload = {
        user_id: supabaseUser.id,
        expenses,
        archived_trips: archivedTrips,
        trip,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('trip_state').upsert(payload, { onConflict: 'user_id' });
      if (error) {
        setSyncError(error.message);
      } else {
        const now = new Date().toISOString();
        setLastSyncAt(now);
        localStorage.setItem(STORAGE_KEY_LAST_SYNC, now);
      }
      setIsSyncing(false);
    }, 800);

    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [archivedTrips, expenses, hasHydratedFromRemote, syncEnabled, supabaseUser?.id, trip]);

  useEffect(() => {
    if (sortedExpenses.length === 0) return;

    const sortedDates = timelineExpenses.map((expense) => toTimelineDate(expense.date, timelineReferenceYear)).filter(Boolean).sort();
    let suggestedDeparture = trip.departureDate;
    let suggestedReturn = trip.returnDate;

    if (sortedDates.length > 0) {
      suggestedDeparture = `${sortedDates[0]}T08:00`;
      suggestedReturn = `${sortedDates[sortedDates.length - 1]}T20:00`;
    }

    let inferredDestination = trip.destinationCountry;
    if (!trip.destinationCountry) {
      const lastExpense = timelineExpenses[timelineExpenses.length - 1];
      if (lastExpense?.location) {
        const parts = lastExpense.location.split(',');
        inferredDestination = parts.length > 1 ? parts[parts.length - 1].trim() : lastExpense.location;
      }
    }

    setTrip((prev) => {
      if (
        prev.departureDate === suggestedDeparture &&
        prev.returnDate === suggestedReturn &&
        prev.destinationCountry === inferredDestination
      ) {
        return prev;
      }
      return {
        ...prev,
        departureDate: suggestedDeparture || prev.departureDate,
        returnDate: suggestedReturn || prev.returnDate,
        destinationCountry: inferredDestination || prev.destinationCountry,
      };
    });
  }, [timelineExpenses, timelineReferenceYear, trip.departureDate, trip.destinationCountry, trip.returnDate]);

  const totalAmount = useMemo(() => sortedExpenses.reduce((sum, expense) => sum + toSafeAmount(expense.amount), 0), [sortedExpenses]);

  const categoryTotals = useMemo(() => {
    const totals = sortedExpenses.reduce<Record<string, number>>((acc, expense) => {
      const category = toSafeCategory(expense.category);
      acc[category] = (acc[category] || 0) + toSafeAmount(expense.amount);
      return acc;
    }, {});
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [sortedExpenses]);

  const groupedExpenses = useMemo(() => {
    const groups = timelineExpenses.reduce<Record<string, Expense[]>>((acc, expense) => {
      const date = toTimelineDate(expense.date, timelineReferenceYear);
      if (!acc[date]) acc[date] = [];
      acc[date].push({ ...expense, date });
      return acc;
    }, {});
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [timelineExpenses, timelineReferenceYear]);
  const timelineStartDate = groupedExpenses[0]?.[0] || null;

  const filteredAndSortedArchives = useMemo(() => {
    return archivedTrips
      .filter((archive) => {
        const term = archiveSearchTerm.toLowerCase();
        return (
          archive.trip.name.toLowerCase().includes(term) ||
          (archive.trip.departureLocation || '').toLowerCase().includes(term) ||
          (archive.trip.destinationCountry || '').toLowerCase().includes(term) ||
          (archive.trip.departureDate || '').includes(term) ||
          (archive.trip.returnDate || '').includes(term)
        );
      })
      .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());
  }, [archiveSearchTerm, archivedTrips]);

  const tripDurationDays = useMemo(() => {
    if (!trip.departureDate || !trip.returnDate) return groupedExpenses.length;
    const start = new Date(trip.departureDate);
    const end = new Date(trip.returnDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return groupedExpenses.length;
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  }, [groupedExpenses.length, trip.departureDate, trip.returnDate]);

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSendMagicLink = async () => {
    if (!supabase || !syncEmail) return;
    setIsSyncing(true);
    setSyncError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: syncEmail,
      options: { emailRedirectTo: 'https://expenseflowapp.netlify.app/' },
    });
    if (error) setSyncError(error.message);
    else showNotification('Lien envoye. Verifie ton email.');
    setIsSyncing(false);
  };

  const handleSupabaseSignOut = async () => {
    if (!supabase) return;
    setIsSyncing(true);
    setSyncError(null);
    const { error } = await supabase.auth.signOut();
    if (error) setSyncError(error.message);
    setIsSyncing(false);
  };

  const handlePullFromSupabase = async () => {
    if (!supabase || !supabaseUser) return;
    setIsSyncing(true);
    setSyncError(null);
    const { data, error } = await supabase
      .from('trip_state')
      .select('expenses, archived_trips, trip, updated_at')
      .eq('user_id', supabaseUser.id)
      .maybeSingle();

    if (error) {
      setSyncError(error.message);
      setIsSyncing(false);
      return;
    }

    if (data) {
      setExpenses(sortExpensesChronologically(normalizeExpenses(data.expenses)));
      setArchivedTrips(safeArray(data.archived_trips).map((archive) => ({ ...archive, expenses: sortExpensesChronologically(normalizeExpenses(archive.expenses)) })));
      setTrip((data.trip as TripMetadata) || createNewTrip());
      const remoteSyncTime = data.updated_at ? new Date(data.updated_at).toISOString() : new Date().toISOString();
      setLastSyncAt(remoteSyncTime);
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, remoteSyncTime);
      showNotification('Etat charge depuis Supabase.');
    } else {
      showNotification('Aucun etat distant trouve.');
    }
    setIsSyncing(false);
  };

  const handlePushToSupabase = async () => {
    if (!supabase || !supabaseUser) return;
    setIsSyncing(true);
    setSyncError(null);
    const payload = {
      user_id: supabaseUser.id,
      expenses: sortedExpenses,
      archived_trips: archivedTrips,
      trip,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('trip_state').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      setSyncError(error.message);
    } else {
      const now = new Date().toISOString();
      setLastSyncAt(now);
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, now);
      showNotification('Etat synchronise.');
    }
    setIsSyncing(false);
  };

  const handleUpdateTrip = (field: keyof TripMetadata, value: string) => {
    setTrip((prev) => ({ ...prev, [field]: value }));
  };

  const handleChangeCurrency = (newCurrency: string) => {
    setTripCurrency(newCurrency);
    setExpenses((prev) => sortExpensesChronologically(prev.map((expense) => ({ ...expense, currency: newCurrency }))));
  };

  const handleAddExpense = (data: Omit<Expense, 'id' | 'tripId'>) => {
    const newExpense = normalizeExpense({ ...data, id: generateId(), tripId: trip.id });
    setExpenses((prev) => sortExpensesChronologically([...prev, newExpense]));
    showNotification('Depense ajoutee.');
  };

  const handleEditExpense = (data: Omit<Expense, 'id' | 'tripId'>) => {
    if (!editingExpense) return;
    setExpenses((prev) => sortExpensesChronologically(prev.map((expense) => (expense.id === editingExpense.id ? normalizeExpense({ ...expense, ...data }) : expense))));
    setEditingExpense(null);
    showNotification('Depense mise a jour.');
  };

  const handleDeleteExpense = (id: string) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cette facture ?')) return;
    const updated = expenses.filter((expense) => expense.id !== id);
    setExpenses(updated);
    localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(updated));
    showNotification('Facture supprimee.');
  };

  const handleClearAll = () => {
    if (!window.confirm('Voulez-vous supprimer toutes les factures du tableau ?')) return;
    setExpenses([]);
    localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify([]));
    showNotification('Tableau reinitialise.');
  };

  const handleDeleteArchive = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm('Voulez-vous supprimer definitivement ce rapport archive ?')) return;
    setArchivedTrips((prev) => prev.filter((archive) => archive.id !== id));
    showNotification('Archive supprimee.');
  };

  const handleCopyTripSummary = async () => {
    if (sortedExpenses.length === 0) return;
    const expenseLines = sortedExpenses
      .map((expense, index) => {
        const base = `${index + 1}. ${formatShortDate(expense.date)} | ${expense.category} | ${expense.location} | ${formatAmount(expense.amount)} ${expense.currency}`;
        return expense.category === 'Hotel'
          ? `${base} | Nuits: ${expense.hotelNights || 0} | PDJ: ${expense.hotelBreakfasts || 0}`
          : base;
      })
      .join('\n');

    const summary = [
      '=== RESUME DU VOYAGE ===',
      `Nom: ${trip.name || 'N/A'}`,
      `Origine: ${trip.departureLocation || 'N/A'}`,
      `Destination: ${trip.destinationCountry || 'N/A'}`,
      `Depart: ${trip.departureDate ? formatDateTime(trip.departureDate) : 'N/A'}`,
      `Retour: ${trip.returnDate ? formatDateTime(trip.returnDate) : 'N/A'}`,
      `Total: ${formatAmount(totalAmount)} ${tripCurrency}`,
      '',
      '=== DEPENSES ===',
      expenseLines || 'Aucune depense',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      showNotification('Resume copie dans le presse-papiers.');
    } catch {
      showNotification('Impossible de copier le resume.');
    }
  };

  const handleDownloadZip = async (targetExpenses = sortedExpenses) => {
    const zip = new JSZip();
    let count = 0;
    sortExpensesChronologically(targetExpenses).forEach((expense, index) => {
      if (!expense.receiptDataUrl) return;
      count += 1;
      const base64Data = expense.receiptDataUrl.split(',')[1];
      const extension = expense.receiptDataUrl.includes('pdf') ? 'pdf' : 'jpg';
      zip.file(`facture_${expense.date}_${index + 1}.${extension}`, base64Data, { base64: true });
    });
    if (count === 0) {
      window.alert("Aucun justificatif n'est disponible.");
      return;
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const url = window.URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'justificatifs_frais.zip';
    anchor.click();
  };

  const handleGenerateEmail = async (targetTrip = trip, targetExpenses = sortedExpenses) => {
    setIsGeneratingEmail(true);
    setIsEmailModalOpen(true);
    try {
      const draft = await generateReimbursementEmail(targetTrip, sortExpensesChronologically(targetExpenses));
      setEmailDraft(draft);
    } catch {
      setEmailDraft({ subject: 'Erreur IA', body: "L'IA n'a pas pu rediger le rapport." });
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const performArchive = () => {
    const newArchive: ArchivedTrip = {
      id: generateId(),
      trip: { ...trip, status: 'archived', name: `${formatShortDate(sortedExpenses[0]?.date || new Date().toISOString())} - Archive` },
      expenses: sortExpensesChronologically(sortedExpenses),
      archivedAt: new Date().toISOString(),
    };
    setArchivedTrips((prev) => [newArchive, ...prev]);
    setExpenses([]);
    setTrip(createNewTrip());
    setIsArchiveConfirmOpen(false);
    setActiveTab('reports');
    showNotification('Voyage archive avec succes.');
  };

  const openDatePicker = (ref: React.RefObject<HTMLInputElement>) => {
    if (!ref.current) return;
    ref.current.focus();
    try {
      if (typeof ref.current.showPicker === 'function') ref.current.showPicker();
    } catch {
      return;
    }
  };

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLogin={(password) => {
          if (password === 'coriolis') {
            sessionStorage.setItem(SESSION_KEY_AUTH, 'true');
            setIsAuthenticated(true);
            return true;
          }
          return false;
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea] text-[#0a0a0a]">
      {notification && (
        <div className="fixed right-6 top-6 z-[100] flex items-center gap-3 border border-[#1a1a1a] bg-[#0a0a0a] px-5 py-3 text-[#f7f3ea] shadow-2xl">
          <CheckCircle size={18} />
          <span className="text-sm font-medium">{notification}</span>
        </div>
      )}

      <div className="mx-auto min-h-screen max-w-[1440px] border-x border-[#e5e0d8] bg-[#f7f3ea]">
        <header className="sticky top-0 z-40 border-b border-[#1a1a1a] bg-[#f7f3ea]/95 backdrop-blur">
          <div className="flex items-center justify-between gap-6 px-4 py-5 md:px-10">
            <div className="flex items-end gap-6">
              <h1 className="font-display text-3xl italic tracking-tight">ExpenseFlow</h1>
              <div className="font-mono-ui hidden text-[10px] uppercase tracking-[0.3em] text-[#7f766a] md:block">Dossier en cours</div>
            </div>
            <div className="flex items-center gap-3">
              <nav className="flex items-center gap-1 border border-[#1a1a1a] p-1">
                  <button onClick={() => setActiveTab('expenses')} className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] ${activeTab === 'expenses' ? 'bg-[#1f4f99] text-[#f7f3ea]' : 'text-[#0a0a0a]'}`}>En cours</button>
                <button onClick={() => setActiveTab('reports')} className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] ${activeTab === 'reports' ? 'bg-[#1f4f99] text-[#f7f3ea]' : 'text-[#0a0a0a]'}`}>Archives</button>
              </nav>
              <button onClick={() => setIsSyncModalOpen(true)} className="border border-[#1a1a1a] p-2 text-[#0a0a0a]" title="Parametres"><Settings size={18} /></button>
              <button onClick={() => { sessionStorage.clear(); setIsAuthenticated(false); }} className="border border-[#1a1a1a] p-2 text-[#0a0a0a]" title="Deconnexion"><LogOut size={18} /></button>
            </div>
          </div>
        </header>

        {activeTab === 'expenses' ? (
          <>
            <section className="border-b border-[#e5e0d8] px-4 py-10 md:px-10 md:py-14">
              <div className="grid gap-10 md:grid-cols-[1.2fr_0.8fr] md:items-end">
                <div>
                  <div className="font-mono-ui mb-5 text-[10px] uppercase tracking-[0.3em] text-[#7f766a]">
                    Voyage en cours · {trip.departureDate ? formatShortDate(trip.departureDate) : '--'} {trip.returnDate ? `— ${formatShortDate(trip.returnDate)}` : ''}
                  </div>
                  <h2 className="font-display text-6xl leading-[0.92] tracking-tight md:text-8xl">
                    {trip.destinationCountry || 'Destination'}
                    <span className="text-[#7f766a] italic"> — dossier</span>
                  </h2>
                  <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-[#37322d]">
                    <div><span className="text-[#8b8175]">Origine </span>{trip.departureLocation || 'Non specifiee'}</div>
                    <div><span className="text-[#8b8175]">Destination </span>{trip.destinationCountry || 'Non specifiee'}</div>
                    <div><span className="text-[#8b8175]">Duree </span>{tripDurationDays || 0} jours</div>
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <div className="font-mono-ui mb-3 text-[10px] uppercase tracking-[0.3em] text-[#7f766a]">Total engage</div>
                  <div className="font-display text-7xl leading-none tracking-tight md:text-8xl">
                    {formatAmount(totalAmount).split(',')[0]}
                    <span className="text-4xl text-[#8b8175] md:text-5xl">,{formatAmount(totalAmount).split(',')[1]}</span>
                  </div>
                  <div className="font-mono-ui mt-3 text-[10px] uppercase tracking-[0.2em] text-[#4b6792]">{tripCurrency} · {expenses.length} lignes</div>
                </div>
              </div>
            </section>

            <section className="border-b border-[#e5e0d8] px-4 py-8 md:px-10">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="font-mono-ui text-[10px] uppercase tracking-[0.3em] text-[#7f766a]">Itineraire et metadata</div>
                <div className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">{lastSyncAt ? `Derniere synchro · ${formatDateTime(lastSyncAt)}` : 'Jamais synchronise'}</div>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="border border-[#e5e0d8] bg-[#fbf7f0] p-5">
                  <div className="mb-4 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">
                    <span className="font-mono-ui">Route</span>
                    <span className="font-mono-ui">{tripDurationDays || 0} jours</span>
                  </div>
                  <div className="relative py-6">
                    <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-[#c8beaf]" />
                    <div className="relative flex items-center justify-between">
                      <div className="bg-[#f7f3ea] pr-3">
                        <div className="font-mono-ui text-[11px] uppercase tracking-[0.2em]">DEP</div>
                        <div className="mt-1 text-sm text-[#4a443c]">{trip.departureLocation || 'Origine'}</div>
                        <div className="mt-1 text-xs text-[#8b8175]">{trip.departureDate ? formatDateTime(trip.departureDate) : 'Date non definie'}</div>
                      </div>
                      <div className="bg-[#f7f3ea] px-3 text-[#2d5da8]">●</div>
                      <div className="bg-[#f7f3ea] pl-3 text-right">
                        <div className="font-mono-ui text-[11px] uppercase tracking-[0.2em]">ARR</div>
                        <div className="mt-1 text-sm text-[#4a443c]">{trip.destinationCountry || 'Destination'}</div>
                        <div className="mt-1 text-xs text-[#8b8175]">{trip.returnDate ? formatDateTime(trip.returnDate) : 'Date non definie'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="font-mono-ui mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">Origine</span>
                    <div className="relative">
                      <MapPin size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8175]" />
                      <input type="text" value={trip.departureLocation || ''} onChange={(e) => handleUpdateTrip('departureLocation', e.target.value)} className="w-full border border-[#d8d0c3] bg-[#fbf7f0] py-3 pl-10 pr-4 text-sm outline-none focus:border-[#1a1a1a]" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="font-mono-ui mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">Destination</span>
                    <div className="relative">
                      <Globe size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8175]" />
                      <input type="text" value={trip.destinationCountry || ''} onChange={(e) => handleUpdateTrip('destinationCountry', e.target.value)} className="w-full border border-[#d8d0c3] bg-[#fbf7f0] py-3 pl-10 pr-4 text-sm outline-none focus:border-[#1a1a1a]" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="font-mono-ui mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">Depart</span>
                    <div className="relative">
                      <CalendarDays size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8175]" />
                      <input ref={departureInputRef} type="datetime-local" value={trip.departureDate || ''} onChange={(e) => handleUpdateTrip('departureDate', e.target.value)} className="w-full border border-[#d8d0c3] bg-[#fbf7f0] py-3 pl-10 pr-10 text-sm outline-none focus:border-[#1a1a1a]" />
                      <button type="button" onClick={() => openDatePicker(departureInputRef)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1"><Calendar size={14} /></button>
                    </div>
                  </label>
                  <label className="block">
                    <span className="font-mono-ui mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">Retour</span>
                    <div className="relative">
                      <Clock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8175]" />
                      <input ref={returnInputRef} type="datetime-local" value={trip.returnDate || ''} onChange={(e) => handleUpdateTrip('returnDate', e.target.value)} className="w-full border border-[#d8d0c3] bg-[#fbf7f0] py-3 pl-10 pr-10 text-sm outline-none focus:border-[#1a1a1a]" />
                      <button type="button" onClick={() => openDatePicker(returnInputRef)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1"><Calendar size={14} /></button>
                    </div>
                  </label>
                </div>
              </div>
            </section>

            <section className="border-b border-[#e5e0d8] px-4 py-8 md:px-10">
              <div className="font-mono-ui mb-5 text-[10px] uppercase tracking-[0.3em] text-[#7f766a]">Repartition</div>
              <div className="mb-6 flex h-[3px] overflow-hidden bg-[#e5e0d8]">
                {categoryTotals.length > 0 ? categoryTotals.map(([category, amount], index) => (
                  <div key={category} className={index === 0 ? 'bg-[#0a0a0a]' : index === 1 ? 'bg-[#555]' : 'bg-[#9d9487]'} style={{ width: `${(amount / totalAmount) * 100}%` }} />
                )) : <div className="w-full bg-[#d8d0c3]" />}
              </div>
              <div className="grid gap-6 md:grid-cols-3 xl:grid-cols-6">
                {categoryTotals.length > 0 ? categoryTotals.map(([category, amount]) => (
                  <div key={category}>
                    <div className="font-mono-ui mb-2 text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">{CATEGORY_LABELS[category] || category}</div>
                  <div className="font-display text-4xl leading-none tracking-tight text-[#1f4f99]">
                      {formatAmount(amount).split(',')[0]}
                      <span className="text-xl text-[#8b8175]">,{formatAmount(amount).split(',')[1]}</span>
                    </div>
                    <div className="font-mono-ui mt-2 text-[10px] text-[#8b8175]">{Math.round((amount / totalAmount) * 100)}% · {expenses.filter((expense) => expense.category === category).length}</div>
                  </div>
                )) : <div className="text-sm text-[#8b8175]">Aucune depense pour le moment.</div>}
              </div>
            </section>

            <section className="px-4 py-10 md:px-10">
              <div className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="font-mono-ui mb-3 text-[10px] uppercase tracking-[0.3em] text-[#7f766a]">Journal</div>
                  <h3 className="font-display text-4xl tracking-tight md:text-5xl">Chronologie <span className="text-[#8b8175] italic">des depenses</span></h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { setEditingExpense(null); setIsFormOpen(true); }} className="flex items-center gap-2 border border-[#1f4f99] bg-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#f7f3ea]"><Plus size={14} /> Nouvelle ligne</button>
                  <button onClick={() => handleGenerateEmail()} disabled={expenses.length === 0} className="flex items-center gap-2 border border-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#1f4f99] disabled:opacity-40"><Sparkles size={14} /> Rapport IA</button>
                  <button onClick={() => handleDownloadZip()} disabled={expenses.length === 0} className="flex items-center gap-2 border border-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#1f4f99] disabled:opacity-40"><Paperclip size={14} /> Justificatifs</button>
                  <button onClick={() => { if (syncEnabled) handlePushToSupabase(); else { setIsSyncModalOpen(true); showNotification('Active la synchronisation pour sauvegarder.'); } }} disabled={isSyncing} className="flex items-center gap-2 border border-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#1f4f99] disabled:opacity-40"><Save size={14} /> Sauvegarder</button>
                  <button onClick={handleCopyTripSummary} disabled={expenses.length === 0} className="flex items-center gap-2 border border-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#1f4f99] disabled:opacity-40"><FileText size={14} /> Copier voyage</button>
                  <button onClick={() => setIsArchiveConfirmOpen(true)} disabled={expenses.length === 0} className="border border-[#1f4f99] px-4 py-3 font-display text-lg italic text-[#1f4f99] disabled:opacity-40">Cloturer le dossier</button>
                  <button onClick={handleClearAll} disabled={expenses.length === 0} className="flex items-center gap-2 border border-[#b26355] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#b26355] disabled:opacity-40"><Trash2 size={14} /> Reset</button>
                </div>
              </div>

              {groupedExpenses.length === 0 ? (
                <div className="border border-dashed border-[#cfc6b9] px-6 py-20 text-center">
                  <div className="font-display text-4xl italic text-[#8b8175]">Aucune depense enregistree</div>
                  <p className="mt-3 text-sm text-[#8b8175]">Ajoute une ligne pour commencer le dossier.</p>
                </div>
              ) : groupedExpenses.map(([date, items]) => (
                <div key={date} className="grid gap-6 border-b border-[#e5e0d8] py-7 md:grid-cols-[160px_1fr_170px] md:gap-8">
                  <div>
                    <div className="font-display text-5xl leading-none">{new Date(`${date}T12:00:00`).getDate()}</div>
                    <div className="font-mono-ui mt-2 text-[10px] uppercase tracking-[0.18em] text-[#7f766a]">{formatDayLabel(date)} · {formatTimelineOffset(date, timelineStartDate, timelineReferenceYear)}</div>
                  </div>
                  <div>
                    {items.map((expense, itemIndex) => (
                      <div key={expense.id} className={`grid gap-4 py-4 md:grid-cols-[110px_1fr_auto] md:items-center ${itemIndex > 0 ? 'border-t border-dotted border-[#d8d0c3]' : ''}`}>
                        <div><CategoryChip category={expense.category} /></div>
                        <div>
                          <div className="text-base font-medium">{expense.location}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#8b8175]">
                            {expense.description && <span className="font-display text-sm italic">{expense.description}</span>}
                            {expense.category === 'Hotel' && expense.hotelNights ? <span>{expense.hotelNights} nuit(s)</span> : null}
                            {expense.category === 'Hotel' && expense.hotelBreakfasts ? <span>{expense.hotelBreakfasts} petit(s)-dej.</span> : null}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-3">
                          <div className="font-display text-3xl leading-none tracking-tight">{formatAmount(expense.amount)}</div>
                          <div className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-[#8b8175]">{expense.currency}</div>
                          <button
                            type="button"
                            onClick={() => expense.receiptDataUrl && setPreviewImage(expense.receiptDataUrl)}
                            disabled={!expense.receiptDataUrl}
                            className="flex items-center gap-1 border border-[#1f4f99] px-2.5 py-2 text-[10px] uppercase tracking-[0.12em] text-[#1f4f99] disabled:border-[#d8d0c3] disabled:text-[#b8afa3]"
                            title={expense.receiptDataUrl ? 'Visualiser la facture analysee' : 'Aucune facture disponible'}
                          >
                            <Eye size={14} />
                            Voir
                          </button>
                          <button type="button" onClick={() => { setEditingExpense(expense); setIsFormOpen(true); }} className="p-2 text-[#0a0a0a]" title="Modifier"><FileText size={16} /></button>
                          <button type="button" onClick={() => handleDeleteExpense(expense.id)} className="p-2 text-[#b26355]" title="Supprimer"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-left md:text-right">
                    <div className="font-mono-ui mb-2 text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">Sous-total</div>
                    <div className="font-display text-4xl leading-none tracking-tight">{formatAmount(items.reduce((sum, expense) => sum + toSafeAmount(expense.amount), 0))}</div>
                    <div className="font-mono-ui mt-2 text-[10px] uppercase tracking-[0.18em] text-[#8b8175]">{tripCurrency}</div>
                  </div>
                </div>
              ))}
            </section>
          </>
        ) : (
          <section className="px-4 py-10 md:px-10">
            <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="font-mono-ui mb-3 text-[10px] uppercase tracking-[0.3em] text-[#7f766a]">Archives</div>
                <h2 className="font-display text-5xl tracking-tight">Historique <span className="text-[#8b8175] italic">des dossiers</span></h2>
                <p className="mt-3 text-sm text-[#6e6559]">{archivedTrips.length} rapport(s) archives</p>
              </div>
              <div className="relative w-full md:w-[420px]">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8b8175]" />
                <input type="text" value={archiveSearchTerm} onChange={(e) => setArchiveSearchTerm(e.target.value)} placeholder="Rechercher par lieu, date ou nom" className="w-full border border-[#d8d0c3] bg-[#fbf7f0] py-3 pl-11 pr-4 text-sm outline-none focus:border-[#1a1a1a]" />
              </div>
            </div>

            <div className="space-y-4">
              {filteredAndSortedArchives.length === 0 ? (
                <div className="border border-dashed border-[#cfc6b9] px-6 py-20 text-center text-[#8b8175]">
                  <Archive size={48} className="mx-auto mb-4" />
                  <div className="font-display text-4xl italic">{archiveSearchTerm ? 'Aucun resultat' : 'Aucune archive'}</div>
                </div>
              ) : filteredAndSortedArchives.map((archive) => {
                const archiveTotal = archive.expenses.reduce((sum, expense) => sum + toSafeAmount(expense.amount), 0);
                return (
                  <div key={archive.id} className="grid gap-5 border border-[#e5e0d8] bg-[#fbf7f0] p-6 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <button type="button" onClick={() => setSelectedArchive(archive)} className="text-left">
                      <div className="font-mono-ui mb-2 text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">Archive · {formatShortDate(archive.trip.departureDate || archive.archivedAt)}</div>
                      <div className="font-display text-3xl tracking-tight">{archive.trip.name}</div>
                      <div className="mt-2 text-sm text-[#6e6559]">{archive.trip.departureLocation || 'Origine non specifiee'} · {archive.trip.destinationCountry || 'Destination non specifiee'}</div>
                    </button>
                    <div className="text-left md:text-right">
                      <div className="font-display text-4xl leading-none tracking-tight">{formatAmount(archiveTotal)}</div>
                      <div className="font-mono-ui mt-2 text-[10px] uppercase tracking-[0.2em] text-[#7f766a]">{archive.expenses[0]?.currency || tripCurrency} · {archive.expenses.length} lignes</div>
                    </div>
                    <div className="flex items-center gap-2 md:justify-end">
                      <button type="button" onClick={() => setSelectedArchive(archive)} className="border border-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#1f4f99]">Voir details</button>
                      <button type="button" onClick={(e) => handleDeleteArchive(archive.id, e)} className="border border-[#b26355] p-3 text-[#b26355]" title="Supprimer"><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <Modal isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingExpense(null); }} title={editingExpense ? 'Modifier la facture' : 'Nouvelle facture intelligente'}>
        <ExpenseForm initialData={editingExpense} defaultCurrency={tripCurrency} onClose={() => { setIsFormOpen(false); setEditingExpense(null); }} onSubmit={editingExpense ? handleEditExpense : handleAddExpense} />
      </Modal>

      <Modal isOpen={isArchiveConfirmOpen} onClose={() => setIsArchiveConfirmOpen(false)} title="Cloture du dossier">
        <div className="space-y-6">
          <div className="border-l-4 border-[#7d6244] bg-[#f4eee4] p-5 text-sm text-[#4a443c]">
            L'archivage verrouille les frais actuels. Vous pourrez les consulter mais plus les modifier.
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setIsArchiveConfirmOpen(false)} className="border border-[#0a0a0a] px-4 py-3 text-[10px] uppercase tracking-[0.15em]">Annuler</button>
                  <button onClick={performArchive} className="border border-[#1f4f99] bg-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#f7f3ea]">Valider</button>
          </div>
        </div>
      </Modal>

      {previewImage && (
        <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} title="Justificatif">
          <div className="flex min-h-[400px] items-center justify-center bg-[#f4eee4] p-4">
            {previewImage.startsWith('data:application/pdf') || previewImage.toLowerCase().endsWith('.pdf') ? (
              <iframe src={previewImage} title="Justificatif PDF" className="h-[70vh] w-full bg-white" />
            ) : (
              <img src={previewImage} alt="Facture" className="max-h-[70vh] max-w-full object-contain" />
            )}
          </div>
        </Modal>
      )}

      {isEmailModalOpen && (
        <Modal isOpen={isEmailModalOpen} onClose={() => setIsEmailModalOpen(false)} title="Demande de remboursement">
          <div className="space-y-6">
            {isGeneratingEmail ? (
              <div className="py-16 text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#0a0a0a] border-t-transparent" />
                <p className="text-sm text-[#4a443c]">Generation du rapport en cours...</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="font-mono-ui block text-[10px] uppercase tracking-[0.15em] text-[#7f766a]">Objet</label>
                  <input className="w-full border border-[#d8d0c3] bg-[#fbf7f0] p-4 text-sm outline-none" value={emailDraft?.subject || ''} readOnly />
                </div>
                <div className="space-y-2">
                  <label className="font-mono-ui block text-[10px] uppercase tracking-[0.15em] text-[#7f766a]">Message</label>
                  <textarea className="h-72 w-full resize-none border border-[#d8d0c3] bg-[#fbf7f0] p-4 text-sm outline-none" value={emailDraft?.body || ''} readOnly />
                </div>
                <a href={`mailto:sandrine@coralise.com?subject=${encodeURIComponent(emailDraft?.subject || '')}&body=${encodeURIComponent(emailDraft?.body || '')}`} className="block border border-[#1f4f99] bg-[#1f4f99] px-4 py-3 text-center text-[10px] uppercase tracking-[0.15em] text-[#f7f3ea]">
                  Transferer par email
                </a>
              </>
            )}
          </div>
        </Modal>
      )}

      <Modal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} title="Parametres">
        <div className="space-y-5">
          {isSupabaseEnabled && supabaseUser && (
            <>
              <div className="border border-[#d8d0c3] bg-[#fbf7f0] p-4">
                <p className="font-mono-ui text-[10px] uppercase tracking-[0.15em] text-[#7f766a]">Compte</p>
                <p className="mt-2 text-sm font-medium text-[#0a0a0a]">{supabaseUser.email || supabaseUser.id}</p>
                <p className="mt-1 text-xs text-[#7f766a]">Derniere synchro: {lastSyncAt ? formatDateTime(lastSyncAt) : 'Jamais'}</p>
              </div>
              {syncError && <div className="text-xs text-[#b26355]">Erreur: {syncError}</div>}
              <div className="flex flex-col gap-3">
                <button onClick={handlePullFromSupabase} className="border border-[#0a0a0a] px-4 py-3 text-[10px] uppercase tracking-[0.15em]">Charger depuis Supabase</button>
                <button onClick={handlePushToSupabase} className="border border-[#1f4f99] bg-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#f7f3ea]">Envoyer vers Supabase</button>
                <button onClick={handleSupabaseSignOut} className="border border-[#0a0a0a] px-4 py-3 text-[10px] uppercase tracking-[0.15em]">Deconnexion</button>
              </div>
              {syncError === 'Failed to fetch' && (
                <SupabaseConfigPanel
                  isOpen={isConfigPanelOpen}
                  onToggle={() => setIsConfigPanelOpen((prev) => !prev)}
                  configUrl={configUrl}
                  configKey={configKey}
                  setConfigUrl={setConfigUrl}
                  setConfigKey={setConfigKey}
                  onSave={() => saveSupabaseConfig(configUrl, configKey)}
                  onClear={clearSupabaseConfig}
                />
              )}
            </>
          )}

          {isSupabaseEnabled && !supabaseUser && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMagicLink();
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-2 block text-xs font-medium text-[#4a443c]">Email</label>
                <input type="email" value={syncEmail} onChange={(e) => setSyncEmail(e.target.value)} placeholder="prenom.nom@entreprise.com" className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]" />
              </div>
              {syncError && <div className="text-xs text-[#b26355]">Erreur: {syncError}</div>}
              <button type="submit" className="w-full border border-[#1f4f99] bg-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#f7f3ea]" disabled={!syncEmail}>Envoyer le lien magique</button>
              <p className="text-xs text-[#7f766a]">Utilise le meme email sur un autre terminal pour recuperer l'etat sauvegarde.</p>
              <SupabaseConfigPanel
                isOpen={isConfigPanelOpen}
                onToggle={() => setIsConfigPanelOpen((prev) => !prev)}
                configUrl={configUrl}
                configKey={configKey}
                setConfigUrl={setConfigUrl}
                setConfigKey={setConfigKey}
                onSave={() => saveSupabaseConfig(configUrl, configKey)}
                onClear={clearSupabaseConfig}
              />
            </form>
          )}

          {!isSupabaseEnabled && (
            <div className="space-y-4">
              <p className="text-sm text-[#4a443c]">Aucune configuration Supabase detectee.</p>
              <SupabaseConfigPanel
                isOpen
                onToggle={() => {}}
                configUrl={configUrl}
                configKey={configKey}
                setConfigUrl={setConfigUrl}
                setConfigKey={setConfigKey}
                onSave={() => saveSupabaseConfig(configUrl, configKey)}
                onClear={clearSupabaseConfig}
                forceOpen
              />
            </div>
          )}

          {isSyncing && <p className="text-xs text-[#7f766a]">Synchronisation en cours...</p>}

          <div className="overflow-hidden border border-[#d8d0c3]">
            <div className="flex items-center justify-between bg-[#f4eee4] px-4 py-3">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.15em] text-[#7f766a]">Devise</span>
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.15em]">{tripCurrency}</span>
            </div>
            <div className="space-y-3 p-4">
              <select value={tripCurrency} onChange={(e) => handleChangeCurrency(e.target.value)} className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-3 py-2 text-sm outline-none focus:border-[#1a1a1a]">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
                <option value="JPY">JPY</option>
                <option value="CAD">CAD</option>
                <option value="NOK">NOK</option>
                <option value="SEK">SEK</option>
                <option value="DKK">DKK</option>
              </select>
              <p className="text-xs text-[#7f766a]">Change la devise pour toutes les depenses existantes, sans conversion.</p>
            </div>
          </div>

          <div className="overflow-hidden border border-[#d8d0c3]">
            <div className="flex items-center justify-between bg-[#f4eee4] px-4 py-3">
              <span className="font-mono-ui text-[10px] uppercase tracking-[0.15em] text-[#7f766a]">IA et modele</span>
              <span className={`font-mono-ui text-[10px] uppercase tracking-[0.15em] ${aiKeyActive ? 'text-[#31473a]' : 'text-[#b26355]'}`}>{aiKeyActive ? 'Cle active' : 'Aucune cle'}</span>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex gap-2">
                {(['gemini', 'openai'] as const).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => {
                      saveProvider(provider);
                      setAiProvider(provider);
                      setAiModel(provider === 'openai' ? DEFAULT_MODEL_OPENAI : DEFAULT_MODEL_GEMINI);
                    }}
                    className={`flex-1 border px-3 py-2 text-xs uppercase tracking-[0.15em] ${aiProvider === provider ? 'border-[#1f4f99] bg-[#1f4f99] text-[#f7f3ea]' : 'border-[#d8d0c3] bg-[#fbf7f0]'}`}
                  >
                    {provider}
                  </button>
                ))}
              </div>
              <input type="text" value={aiModel} onChange={(e) => setAiModel(e.target.value)} onBlur={() => saveModel(aiModel)} placeholder={aiProvider === 'openai' ? DEFAULT_MODEL_OPENAI : DEFAULT_MODEL_GEMINI} className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-3 py-2 text-xs outline-none focus:border-[#1a1a1a]" />
              {aiProvider === 'gemini' ? (
                <input type="password" value={geminiKeyInput} onChange={(e) => setGeminiKeyInput(e.target.value)} placeholder="AIza..." className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-3 py-2 text-xs outline-none focus:border-[#1a1a1a]" />
              ) : (
                <input type="password" value={openAIKeyInput} onChange={(e) => setOpenAIKeyInput(e.target.value)} placeholder="sk-..." className="w-full border border-[#d8d0c3] bg-[#fbf7f0] px-3 py-2 text-xs outline-none focus:border-[#1a1a1a]" />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (aiProvider === 'gemini') {
                      saveGeminiKey(geminiKeyInput);
                      setGeminiKeySaved(Boolean(geminiKeyInput.trim()));
                    } else {
                      saveOpenAIKey(openAIKeyInput);
                      setOpenAIKeySaved(Boolean(openAIKeyInput.trim()));
                    }
                    saveModel(aiModel);
                  }}
                  disabled={aiProvider === 'gemini' ? !geminiKeyInput.trim() : !openAIKeyInput.trim()}
                  className="flex-1 border border-[#1f4f99] bg-[#1f4f99] px-3 py-2 text-xs uppercase tracking-[0.15em] text-[#f7f3ea] disabled:opacity-40"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (aiProvider === 'gemini') {
                      saveGeminiKey('');
                      setGeminiKeyInput('');
                      setGeminiKeySaved(false);
                    } else {
                      saveOpenAIKey('');
                      setOpenAIKeyInput('');
                      setOpenAIKeySaved(false);
                    }
                  }}
                  className="border border-[#0a0a0a] px-3 py-2 text-xs uppercase tracking-[0.15em]"
                >
                  Effacer
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {selectedArchive && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0a0a0a]/90 p-6 backdrop-blur">
          <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden bg-[#f7f3ea]">
            <div className="flex items-start justify-between border-b border-[#d8d0c3] p-8">
              <div>
                <h2 className="font-display text-5xl tracking-tight">{selectedArchive.trip.name}</h2>
                <div className="mt-3 space-y-1 text-sm text-[#6e6559]">
                  <p>Depart : {selectedArchive.trip.departureLocation || 'Non specifie'}</p>
                  <p>Du {selectedArchive.trip.departureDate ? formatDateTime(selectedArchive.trip.departureDate) : 'N/A'} au {selectedArchive.trip.returnDate ? formatDateTime(selectedArchive.trip.returnDate) : 'N/A'}</p>
                </div>
              </div>
              <button onClick={() => setSelectedArchive(null)} className="border border-[#0a0a0a] p-3"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              <ExpenseTable expenses={selectedArchive.expenses} isReadonly onEdit={() => {}} onDelete={() => {}} onViewReceipt={setPreviewImage} />
            </div>
            <div className="flex flex-col gap-4 border-t border-[#d8d0c3] p-8 md:flex-row md:items-center md:justify-between">
              <div className="font-display text-5xl tracking-tight">Total : {formatAmount(selectedArchive.expenses.reduce((sum, expense) => sum + toSafeAmount(expense.amount), 0))} {selectedArchive.expenses[0]?.currency || tripCurrency}</div>
              <div className="flex flex-col gap-3 md:flex-row">
                <button onClick={() => handleDownloadZip(selectedArchive.expenses)} className="border border-[#0a0a0a] px-4 py-3 text-[10px] uppercase tracking-[0.15em]">Telecharger ZIP</button>
                <button onClick={() => handleGenerateEmail(selectedArchive.trip, selectedArchive.expenses)} className="border border-[#1f4f99] bg-[#1f4f99] px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#f7f3ea]">Regenerer rapport</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
