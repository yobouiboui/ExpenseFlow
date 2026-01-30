
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Download, Mail, Archive, Calendar, Paperclip, CheckCircle, LogOut, Settings, X, AlertTriangle, FileText, Trash2, MapPin, Clock, CalendarDays, Sparkles, Globe, Search, Save } from 'lucide-react';
import ExpenseTable from './components/ExpenseTable';
import Modal from './components/Modal';
import ExpenseForm from './components/ExpenseForm';
import LoginScreen from './components/LoginScreen';
import { Expense, TripMetadata, EmailDraft, ArchivedTrip } from './types';
import { generateReimbursementEmail } from './services/geminiService';
import { supabase, isSupabaseEnabled } from './services/supabaseClient';
import type { User } from '@supabase/supabase-js';
import JSZip from 'jszip';

const STORAGE_KEY_EXPENSES = 'expenseFlow_expenses_prod_v1';
const STORAGE_KEY_ARCHIVE = 'expenseFlow_archive_prod_v1';
const STORAGE_KEY_TRIP = 'expenseFlow_trip_prod_v1';
const SESSION_KEY_AUTH = 'expenseFlow_auth_prod_v1';
const STORAGE_KEY_LAST_SYNC = 'expenseFlow_lastSync_prod_v1';

const generateId = () => Math.random().toString(36).substr(2, 9);

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
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
  returnDate: ''
});

const safeArray = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const isTripEmpty = (trip: TripMetadata) => {
  const name = (trip.name || '').toLowerCase();
  const isDefaultName = name === 'nouveau voyage' || name === 'voyage professionnel';
  const location = (trip.departureLocation || '').toLowerCase();
  const isDefaultLocation = !location || location === 'hamburg, germany';
  return !trip.departureDate && !trip.returnDate && !trip.destinationCountry && isDefaultLocation && isDefaultName;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem(SESSION_KEY_AUTH) === 'true');
  const [activeTab, setActiveTab] = useState<'expenses' | 'reports'>('expenses');
  
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_EXPENSES);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [archivedTrips, setArchivedTrips] = useState<ArchivedTrip[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ARCHIVE);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [trip, setTrip] = useState<TripMetadata>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TRIP);
    return saved ? JSON.parse(saved) : createNewTrip('Voyage Professionnel');
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
  
  // État pour la recherche dans les archives
  const [archiveSearchTerm, setArchiveSearchTerm] = useState('');

  // Refs pour contrôler l'ouverture du calendrier
  const departureInputRef = useRef<HTMLInputElement>(null);
  const returnInputRef = useRef<HTMLInputElement>(null);
  const syncTimerRef = useRef<number | null>(null);

  // Synchronisation persistante
  useEffect(() => { localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses)); }, [expenses]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(archivedTrips)); }, [archivedTrips]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_TRIP, JSON.stringify(trip)); }, [trip]);

  const localStateEmpty = expenses.length === 0 && archivedTrips.length === 0 && isTripEmpty(trip);
  const syncEnabled = isSupabaseEnabled && !!supabaseUser;

  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSupabaseUser(data.session?.user ?? null);
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
          updated_at: new Date().toISOString()
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

      if (localStateEmpty) {
        setExpenses(safeArray(data.expenses));
        setArchivedTrips(safeArray(data.archived_trips));
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
  }, [syncEnabled, supabaseUser?.id]);

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
        updated_at: new Date().toISOString()
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
  }, [expenses, archivedTrips, trip, syncEnabled, hasHydratedFromRemote, supabaseUser?.id]);

  // Calcul automatique des dates et du pays de destination basé sur les dépenses
  useEffect(() => {
    if (expenses.length === 0) return;

    // 1. Logique Dates (Min 08h / Max 20h)
    const sortedDates = expenses
      .map(e => e.date)
      .filter(d => d)
      .sort();

    let suggestedDeparture = trip.departureDate;
    let suggestedReturn = trip.returnDate;

    if (sortedDates.length > 0) {
      const minDate = sortedDates[0];
      const maxDate = sortedDates[sortedDates.length - 1];
      suggestedDeparture = `${minDate}T08:00`;
      suggestedReturn = `${maxDate}T20:00`;
    }

    // 2. Logique Destination (Basé sur la dernière dépense)
    // On prend la dernière dépense, on regarde si ça contient une virgule (ex: "Paris, France")
    // Si oui on prend la partie droite, sinon on prend tout le lieu
    let inferredDestination = trip.destinationCountry;
    if (!trip.destinationCountry) { // Seulement si vide pour ne pas écraser la saisie manuelle
      const lastExpense = expenses[expenses.length - 1];
      if (lastExpense && lastExpense.location) {
        const parts = lastExpense.location.split(',');
        if (parts.length > 1) {
          inferredDestination = parts[parts.length - 1].trim();
        } else {
          inferredDestination = lastExpense.location;
        }
      }
    }

    setTrip(prev => {
      // Éviter les boucles de rendu si rien ne change
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
        destinationCountry: inferredDestination || prev.destinationCountry
      };
    });
  }, [expenses]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSendMagicLink = async () => {
    if (!supabase || !syncEmail) return;
    setIsSyncing(true);
    setSyncError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: syncEmail,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) {
      setSyncError(error.message);
    } else {
      showNotification('Lien envoye. Verifie ton email.');
    }
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
      setExpenses(safeArray(data.expenses));
      setArchivedTrips(safeArray(data.archived_trips));
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
      expenses,
      archived_trips: archivedTrips,
      trip,
      updated_at: new Date().toISOString()
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
    setTrip(prev => ({ ...prev, [field]: value }));
  };

  const handleAddExpense = (data: Omit<Expense, 'id' | 'tripId'>) => {
    const newExp = { ...data, id: generateId(), tripId: trip.id } as Expense;
    setExpenses(prev => [...prev, newExp]);
    showNotification("Dépense ajoutée !");
  };

  const handleEditExpense = (data: Omit<Expense, 'id' | 'tripId'>) => {
    if (!editingExpense) return;
    setExpenses(prev => prev.map(e => e.id === editingExpense.id ? { ...e, ...data } : e));
    setEditingExpense(null);
    showNotification("Dépense mise à jour.");
  };

  const handleDeleteExpense = (id: string) => {
    if (window.confirm("Voulez-vous vraiment supprimer cette facture ?")) {
      const updated = expenses.filter(e => e.id !== id);
      setExpenses(updated);
      localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(updated));
      showNotification("Facture supprimée.");
    }
  };

  const handleClearAll = () => {
    if (window.confirm("ALERTE : Voulez-vous supprimer TOUTES les factures du tableau ? Cette action est irréversible.")) {
      setExpenses([]);
      localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify([]));
      showNotification("Tableau réinitialisé.");
    }
  };

  const handleDeleteArchive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Empêche l'ouverture du détail de l'archive
    if (window.confirm("Voulez-vous vraiment supprimer définitivement ce rapport archivé ?")) {
      const updatedArchives = archivedTrips.filter(a => a.id !== id);
      setArchivedTrips(updatedArchives);
      showNotification("Archive supprimée.");
    }
  };

  const handleCopyTripSummary = async () => {
    if (expenses.length === 0) return;
    const total = expenses.reduce((s, e) => s + e.amount, 0).toFixed(2);
    const expenseLines = expenses.map((e, idx) => {
      const base = `${idx + 1}. ${formatDate(e.date)} | ${e.category} | ${e.location} | ${e.amount} ${e.currency}`;
      if (e.category === 'Hotel') {
        return `${base} | Nuits: ${e.hotelNights || 0} | PDJ: ${e.hotelBreakfasts || 0}`;
      }
      return base;
    }).join('\n');

    const summary = [
      '=== RÉSUMÉ DU VOYAGE ===',
      `Nom: ${trip.name || 'N/A'}`,
      `Statut: ${trip.status || 'N/A'}`,
      `Origine: ${trip.departureLocation || 'N/A'}`,
      `Destination: ${trip.destinationCountry || 'N/A'}`,
      `Départ: ${trip.departureDate ? new Date(trip.departureDate).toLocaleString() : 'N/A'}`,
      `Retour: ${trip.returnDate ? new Date(trip.returnDate).toLocaleString() : 'N/A'}`,
      `Total: ${total} EUR`,
      '',
      '=== DÉPENSES ===',
      expenseLines || 'Aucune dépense',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      showNotification('Résumé copié dans le presse-papiers.');
    } catch (err) {
      console.error('Clipboard error:', err);
      showNotification('Impossible de copier le résumé.');
    }
  };

  const handleDownloadZip = async (targetExpenses = expenses) => {
    const zip = new JSZip();
    let count = 0;
    targetExpenses.forEach((exp, idx) => {
      if (exp.receiptDataUrl) {
        count++;
        const base64Data = exp.receiptDataUrl.split(',')[1];
        const ext = exp.receiptDataUrl.includes('pdf') ? 'pdf' : 'jpg';
        zip.file(`facture_${exp.date}_${idx + 1}.${ext}`, base64Data, { base64: true });
      }
    });
    if (count === 0) return alert("Aucun justificatif n'est disponible.");
    const content = await zip.generateAsync({ type: "blob" });
    const url = window.URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `justificatifs_frais.zip`;
    a.click();
  };

  const handleGenerateEmail = async (targetTrip = trip, targetExpenses = expenses) => {
    setIsGeneratingEmail(true);
    setIsEmailModalOpen(true);
    try {
      const draft = await generateReimbursementEmail(targetTrip, targetExpenses);
      setEmailDraft(draft);
    } catch (e) {
      setEmailDraft({ subject: "Erreur IA", body: "Désolé, l'IA n'a pas pu rédiger le rapport. Vérifiez vos données." });
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const performArchive = () => {
    const newArchive: ArchivedTrip = {
      id: generateId(),
      trip: { ...trip, status: 'archived', name: `${formatDate(expenses[0]?.date || 'Voyage')} - Archive` },
      expenses: [...expenses],
      archivedAt: new Date().toISOString()
    };
    setArchivedTrips(prev => [newArchive, ...prev]);
    setExpenses([]);
    setTrip(createNewTrip());
    setIsArchiveConfirmOpen(false);
    setActiveTab('reports');
    showNotification("Voyage archivé avec succès.");
  };

  // Safe wrapper for date picker
  const openDatePicker = (ref: React.RefObject<HTMLInputElement>) => {
    if (ref.current) {
        // Focus first to ensure the element is active
        ref.current.focus();
        try {
            // Then try to show the picker
            if (typeof ref.current.showPicker === 'function') {
                ref.current.showPicker();
            }
        } catch (error) {
            console.warn('DatePicker open failed:', error);
        }
    }
  };

  // Filtrage et Tri des Archives
  const filteredAndSortedArchives = useMemo(() => {
    return archivedTrips
      .filter((arch) => {
        const term = archiveSearchTerm.toLowerCase();
        // Recherche sur : Nom du voyage, Lieu départ, Pays destination, Dates
        return (
          arch.trip.name.toLowerCase().includes(term) ||
          (arch.trip.departureLocation || '').toLowerCase().includes(term) ||
          (arch.trip.destinationCountry || '').toLowerCase().includes(term) ||
          (arch.trip.departureDate || '').includes(term) ||
          (arch.trip.returnDate || '').includes(term)
        );
      })
      .sort((a, b) => {
        // Tri du plus récent au plus ancien (basé sur la date d'archivage)
        return new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime();
      });
  }, [archivedTrips, archiveSearchTerm]);

  if (!isAuthenticated) return <LoginScreen onLogin={(p) => {
    if (p === 'coriolis') {
      sessionStorage.setItem(SESSION_KEY_AUTH, 'true');
      setIsAuthenticated(true);
      return true;
    }
    return false;
  }} />;

  return (
    <div className="min-h-screen text-slate-900 font-sans relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-slate-50 to-teal-50" />
      <div className="absolute -top-24 -right-24 h-[420px] w-[420px] rounded-full bg-amber-200/40 blur-3xl" />
      <div className="absolute -bottom-32 -left-24 h-[520px] w-[520px] rounded-full bg-teal-200/40 blur-3xl" />
      <div className="absolute inset-0 bg-noise opacity-40" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {notification && (
          <div className="fixed top-6 right-6 z-[100] bg-teal-700 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 fade-up">
            <CheckCircle size={20} /> <span className="font-bold">{notification}</span>
          </div>
        )}

        <header className="glass-card border-b border-white/60 sticky top-0 z-40 px-6 py-4 shadow-sm fade-up">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-teal-700 text-white w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shadow-md">EF</div>
              <h1 className="text-lg font-extrabold text-slate-900 hidden md:block font-display tracking-tight">ExpenseFlow</h1>
            </div>
            <div className="flex items-center gap-4">
              <nav className="flex bg-white/70 p-1 rounded-xl border border-white/80 shadow-sm">
                <button onClick={() => setActiveTab('expenses')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'expenses' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>En cours</button>
                <button onClick={() => setActiveTab('reports')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'reports' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Archives</button>
              </nav>
              <button onClick={() => setIsSyncModalOpen(true)} className="p-2 text-slate-400 hover:text-teal-600 transition-colors" title="Synchronisation">
                <Settings size={20}/>
              </button>
              <button onClick={() => { sessionStorage.clear(); setIsAuthenticated(false); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20}/></button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 md:px-6 py-8 pb-32 fade-up">
        {activeTab === 'expenses' ? (
          <>
            <div className="mb-6">
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 font-display tracking-tight">Suivi des frais</h2>
              <p className="text-slate-600 font-medium text-sm mt-2">Gérez vos justificatifs et générez vos rapports.</p>
            </div>

            {/* BARRE D'OUTILS HARMONISÉE */}
            <div className="grid grid-cols-2 md:flex md:flex-wrap items-stretch gap-3 mb-6 glass-card rounded-[2rem] p-4 border border-white/60 soft-shadow">
              
              {/* Bouton Principal - Ajout */}
              <button 
                onClick={() => { setEditingExpense(null); setIsFormOpen(true); }} 
                className="col-span-2 md:col-span-auto bg-teal-700 text-white px-5 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-teal-800 shadow-lg active:scale-95 transition-all"
              >
                <Plus size={16}/> Nouvelle facture
              </button>

              {/* Groupe Actions Données */}
              <button 
                onClick={() => handleGenerateEmail()} 
                disabled={expenses.length === 0}
                className="bg-amber-50 text-amber-800 px-4 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-amber-100 transition-all disabled:opacity-40 border border-amber-100"
              >
                <Sparkles size={16}/> Email IA
              </button>

              <button 
                onClick={() => handleDownloadZip()} 
                disabled={expenses.length === 0}
                className="bg-slate-100 text-slate-700 px-4 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-200 transition-all disabled:opacity-40 border border-slate-200"
              >
                <Paperclip size={16}/> Justificatifs
              </button>

              <button
                onClick={() => {
                  if (syncEnabled) {
                    handlePushToSupabase();
                  } else {
                    setIsSyncModalOpen(true);
                    showNotification('Active la synchronisation pour sauvegarder.');
                  }
                }}
                disabled={isSyncing}
                className="bg-white text-slate-700 border border-slate-200 px-4 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-40"
              >
                <Save size={16}/> Sauvegarder
              </button>

              <button 
                onClick={handleCopyTripSummary} 
                disabled={expenses.length === 0} 
                className="bg-white text-slate-700 border border-slate-200 px-4 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-40"
              >
                <FileText size={16}/> Copier voyage
              </button>

              {/* Groupe Actions Destructrices / Cloture */}
              <button 
                onClick={() => setIsArchiveConfirmOpen(true)} 
                disabled={expenses.length === 0} 
                className="bg-white text-slate-700 border border-slate-200 px-4 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-50 shadow-sm disabled:opacity-40 active:scale-95 ml-0 md:ml-auto"
              >
                <Archive size={16}/> Clôturer
              </button>

              <button 
                onClick={handleClearAll} 
                disabled={expenses.length === 0} 
                className="bg-red-50 text-red-600 border border-red-200 px-4 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-red-100 transition-all disabled:opacity-40"
              >
                <Trash2 size={16}/> Reset
              </button>
            </div>

            <ExpenseTable 
              expenses={expenses} 
              onEdit={(e) => { setEditingExpense(e); setIsFormOpen(true); }} 
              onDelete={handleDeleteExpense} 
              onViewReceipt={setPreviewImage} 
            />
          </>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 font-display tracking-tight">Historique des voyages</h2>
                <p className="text-slate-600 font-medium text-sm mt-2">
                  {archivedTrips.length} rapports archivés
                </p>
              </div>
              
              {/* BARRE DE RECHERCHE */}
              <div className="relative w-full md:w-96">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <Search size={18} />
                </div>
                <input 
                  type="text" 
                  placeholder="Rechercher par lieu, date ou nom..." 
                  className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-11 pr-4 text-sm font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition-all shadow-sm"
                  value={archiveSearchTerm}
                  onChange={(e) => setArchiveSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredAndSortedArchives.length === 0 ? (
                <div className="col-span-full py-40 text-center glass-card rounded-[3rem] border-4 border-dashed border-white/70 soft-shadow">
                  <Archive size={80} className="mx-auto mb-6 text-slate-200" />
                  <p className="text-2xl font-black text-slate-300">
                    {archiveSearchTerm ? "Aucune archive trouvée" : "Aucune archive pour le moment"}
                  </p>
                </div>
              ) : (
                filteredAndSortedArchives.map(arch => (
                  <div key={arch.id} className="glass-card p-8 rounded-[2rem] soft-shadow hover:shadow-2xl transition-all cursor-pointer group relative border border-white/60" onClick={() => setSelectedArchive(arch)}>
                    <div className="flex justify-between items-start mb-6">
                      <h3 className="font-black text-xl text-slate-900 group-hover:text-teal-700 transition-colors pr-8">{arch.trip.name}</h3>
                      <div className="flex items-center gap-2 absolute top-8 right-8">
                         <span className="bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full">Archive</span>
                         <button 
                           onClick={(e) => handleDeleteArchive(arch.id, e)}
                           className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 hover:text-red-700 transition-colors"
                           title="Supprimer l'archive"
                         >
                           <Trash2 size={14} />
                         </button>
                      </div>
                    </div>
                    <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-2xl font-black text-teal-700">{arch.expenses.reduce((s,e)=>s+e.amount,0).toFixed(2)} EUR</span>
                        <span className="text-[10px] font-bold text-slate-500 mt-1">{formatDate(arch.trip.departureDate || arch.archivedAt)}</span>
                      </div>
                      <button className="bg-teal-50 text-teal-700 px-4 py-2 rounded-lg font-black text-sm group-hover:bg-teal-700 group-hover:text-white transition-all">Voir détails</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* FOOTER AVEC INFOS VOYAGE ET TOTAL */}
      {activeTab === 'expenses' && (
        <div className="sticky bottom-0 glass-card border-t border-white/60 px-6 py-4 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-30">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
             
             {/* LEFT SIDE: Generic Trip Info */}
             <div className="flex-1 w-full md:w-auto flex flex-col gap-2">
                
                {/* FIRST ROW: LOCATIONS */}
                <div className="flex gap-2 w-full">
                  {/* LOCATION INPUT (ORIGIN) */}
                  <div className="relative group flex-1 min-w-0">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <MapPin size={16} />
                    </div>
                    <input 
                      type="text" 
                      placeholder="Origine" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-[10px] md:text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all shadow-sm truncate"
                      value={trip.departureLocation || ''}
                      onChange={(e) => handleUpdateTrip('departureLocation', e.target.value)}
                    />
                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest absolute -top-5 left-1 opacity-0 group-hover:opacity-100 transition-opacity">Origine</span>
                  </div>

                  {/* DESTINATION INPUT */}
                  <div className="relative group flex-1 min-w-0">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <Globe size={16} />
                    </div>
                    <input 
                      type="text" 
                      placeholder="Destination" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-[10px] md:text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all shadow-sm truncate"
                      value={trip.destinationCountry || ''}
                      onChange={(e) => handleUpdateTrip('destinationCountry', e.target.value)}
                    />
                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest absolute -top-5 left-1 opacity-0 group-hover:opacity-100 transition-opacity">Pays</span>
                  </div>
                </div>

                {/* SECOND ROW: DATES CONTAINER */}
                <div className="flex gap-2 w-full">
                  
                  {/* DEPARTURE DATE */}
                  <div className="relative flex-1 group min-w-0">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-teal-400 pointer-events-none z-10">
                       <CalendarDays size={14} />
                    </div>
                    
                    <input 
                      ref={departureInputRef}
                      type="datetime-local" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-8 pr-8 text-[10px] md:text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:bg-white transition-all shadow-sm cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                      value={trip.departureDate || ''}
                      onChange={(e) => handleUpdateTrip('departureDate', e.target.value)}
                    />
                    
                    {/* Bouton visible déclencheur */}
                    <button 
                      type="button"
                      onClick={(e) => { e.preventDefault(); openDatePicker(departureInputRef); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white border border-slate-100 rounded-lg text-teal-600 hover:bg-teal-50 shadow-sm z-20"
                      title="Choisir la date"
                    >
                      <Calendar size={12} />
                    </button>

                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest absolute -top-5 left-1 hidden md:block">Départ</span>
                  </div>

                  {/* RETURN DATE */}
                  <div className="relative flex-1 group min-w-0">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-teal-400 pointer-events-none z-10">
                       <Clock size={14} />
                    </div>
                    
                    <input 
                      ref={returnInputRef}
                      type="datetime-local" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-8 pr-8 text-[10px] md:text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:bg-white transition-all shadow-sm cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                      value={trip.returnDate || ''}
                      onChange={(e) => handleUpdateTrip('returnDate', e.target.value)}
                    />

                    {/* Bouton visible déclencheur */}
                    <button 
                      type="button"
                      onClick={(e) => { e.preventDefault(); openDatePicker(returnInputRef); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white border border-slate-100 rounded-lg text-teal-600 hover:bg-teal-50 shadow-sm z-20"
                      title="Choisir la date"
                    >
                      <Calendar size={12} />
                    </button>

                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest absolute -top-5 left-1 hidden md:block">Retour</span>
                  </div>
                </div>
             </div>

             {/* RIGHT SIDE: Total */}
             <div className="text-right ml-auto flex flex-col items-end pl-4">
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-0.5">Total</p>
                <p className="text-3xl md:text-4xl font-black text-teal-700 leading-none">
                  {expenses.reduce((s,e)=>s+e.amount,0).toFixed(2)} 
                  <span className="text-xl md:text-2xl text-teal-400 ml-1">EUR</span>
                </p>
             </div>

          </div>
        </div>
      )}

      {/* MODAL FORMULAIRE */}
      <Modal isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingExpense(null); }} title={editingExpense ? "Modifier la facture" : "Nouvelle facture intelligente"}>
        <ExpenseForm initialData={editingExpense} onClose={() => { setIsFormOpen(false); setEditingExpense(null); }} onSubmit={editingExpense ? handleEditExpense : handleAddExpense} />
      </Modal>

      {/* CONFIRMATION ARCHIVAGE */}
      <Modal isOpen={isArchiveConfirmOpen} onClose={() => setIsArchiveConfirmOpen(false)} title="Clôture du dossier">
        <div className="space-y-6">
          <div className="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-2xl text-amber-900 font-bold">
             L'archivage verrouille les frais actuels. Vous pourrez les consulter mais plus les modifier.
          </div>
          <div className="flex justify-end gap-4 pt-4">
            <button onClick={() => setIsArchiveConfirmOpen(false)} className="px-6 py-2 font-black text-slate-500 hover:text-slate-700">Annuler</button>
            <button onClick={performArchive} className="bg-teal-700 text-white px-10 py-4 rounded-2xl font-black shadow-xl hover:bg-teal-800 active:scale-95 transition-all">Valider l'archivage</button>
          </div>
        </div>
      </Modal>

      {/* PREVIEW IMAGE */}
      {previewImage && (
        <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} title="Visualisation du justificatif">
          <div className="bg-slate-100 p-4 rounded-3xl flex items-center justify-center min-h-[400px]">
            {previewImage.startsWith('data:application/pdf') || previewImage.toLowerCase().endsWith('.pdf') ? (
              <iframe
                src={previewImage}
                title="Justificatif PDF"
                className="w-full h-[70vh] rounded-2xl shadow-2xl bg-white"
              />
            ) : (
              <img src={previewImage} alt="Facture" className="max-w-full max-h-[70vh] rounded-2xl shadow-2xl object-contain" />
            )}
          </div>
        </Modal>
      )}

      {/* MODAL EMAIL IA */}
      {isEmailModalOpen && (
        <Modal isOpen={isEmailModalOpen} onClose={() => setIsEmailModalOpen(false)} title="Demande de Remboursement">
          <div className="space-y-6">
            {isGeneratingEmail ? (
              <div className="py-24 text-center">
                <div className="animate-spin w-16 h-16 border-4 border-teal-700 border-t-transparent rounded-full mx-auto mb-6"></div>
                <p className="font-black text-xl text-teal-700 animate-pulse">L'IA Gemini Flash rédige votre rapport...</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase text-slate-400">Objet de l'email</label>
                  <input className="w-full !bg-white border border-slate-300 rounded-xl p-4 font-bold !text-black outline-none shadow-inner" value={emailDraft?.subject || ''} readOnly />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase text-slate-400">Message généré</label>
                  <textarea className="w-full !bg-white border border-slate-300 rounded-xl p-4 !text-black font-medium h-72 outline-none shadow-inner resize-none" value={emailDraft?.body || ''} readOnly />
                </div>
                <div className="flex gap-4 pt-4">
                   <a href={`mailto:sandrine@coralise.com?subject=${encodeURIComponent(emailDraft?.subject||'')}&body=${encodeURIComponent(emailDraft?.body||'')}`} className="flex-1 bg-teal-700 text-white p-5 rounded-2xl font-black text-center shadow-xl active:scale-95 transition-all hover:bg-teal-800">Transférer à Sandrine (Email)</a>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL SYNCHRONISATION */}
      <Modal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} title="Synchronisation">
        {!isSupabaseEnabled ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Supabase n'est pas configure. Ajoute VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local puis relance l'app.</p>
            <p className="text-xs text-slate-400">Etat actuel: stockage local uniquement.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {supabaseUser ? (
              <>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-1">
                  <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Compte</p>
                  <p className="font-bold text-slate-800">{supabaseUser.email || supabaseUser.id}</p>
                  <p className="text-xs text-slate-500">Derniere synchro: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Jamais'}</p>
                </div>
                {syncError && (
                  <div className="text-xs text-red-600 font-semibold">Erreur: {syncError}</div>
                )}
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handlePullFromSupabase}
                    className="w-full bg-slate-100 text-slate-700 border border-slate-200 px-4 py-3 rounded-xl font-bold text-xs hover:bg-slate-200 transition-all"
                  >
                    Charger depuis Supabase
                  </button>
                  <button
                    onClick={handlePushToSupabase}
                    className="w-full bg-teal-700 text-white px-4 py-3 rounded-xl font-bold text-xs hover:bg-teal-800 transition-all"
                  >
                    Envoyer vers Supabase
                  </button>
                  <button
                    onClick={handleSupabaseSignOut}
                    className="w-full bg-white text-slate-600 border border-slate-200 px-4 py-3 rounded-xl font-bold text-xs hover:bg-slate-50 transition-all"
                  >
                    Deconnexion
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMagicLink();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">Email</label>
                  <input
                    type="email"
                    value={syncEmail}
                    onChange={(e) => setSyncEmail(e.target.value)}
                    placeholder="prenom.nom@entreprise.com"
                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-200"
                  />
                </div>
                {syncError && (
                  <div className="text-xs text-red-600 font-semibold">Erreur: {syncError}</div>
                )}
                <button
                  type="submit"
                  className="w-full bg-teal-700 text-white px-4 py-3 rounded-xl font-bold text-xs hover:bg-teal-800 transition-all"
                  disabled={!syncEmail}
                >
                  Envoyer le lien magique
                </button>
                <p className="text-xs text-slate-500">
                  Utilise le meme email sur un autre terminal pour recuperer l'etat sauvegarde.
                </p>
              </form>
            )}
            {isSyncing && (
              <p className="text-xs text-slate-500">Synchronisation en cours...</p>
            )}
          </div>
        )}
      </Modal>

      {/* VUE ARCHIVE */}
      {selectedArchive && (
        <div className="fixed inset-0 z-[60] bg-slate-900/95 backdrop-blur-xl flex items-center justify-center p-6 md:p-12">
          <div className="bg-white rounded-[3rem] w-full max-w-6xl max-h-full flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 border-b flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tight">{selectedArchive.trip.name}</h2>
                <div className="mt-2 space-y-1">
                   <p className="text-xs text-slate-500 font-bold">
                     <MapPin size={12} className="inline mr-1"/> Départ : {selectedArchive.trip.departureLocation || 'Non spécifié'}
                   </p>
                   <p className="text-xs text-slate-500 font-bold">
                     <Clock size={12} className="inline mr-1"/> Du {selectedArchive.trip.departureDate ? new Date(selectedArchive.trip.departureDate).toLocaleString() : 'N/A'} au {selectedArchive.trip.returnDate ? new Date(selectedArchive.trip.returnDate).toLocaleString() : 'N/A'}
                   </p>
                </div>
              </div>
              <button onClick={() => setSelectedArchive(null)} className="bg-white p-5 rounded-full shadow-lg border border-slate-100 text-slate-400 hover:text-red-500 transition-all"><X size={28}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-10 bg-white">
              <ExpenseTable expenses={selectedArchive.expenses} isReadonly onEdit={()=>{}} onDelete={()=>{}} onViewReceipt={setPreviewImage} />
            </div>
            <div className="p-10 border-t bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="text-5xl font-black text-teal-700">Total : {selectedArchive.expenses.reduce((s,e)=>s+e.amount,0).toFixed(2)} EUR</div>
              <div className="flex gap-4 w-full md:w-auto">
                <button onClick={() => handleDownloadZip(selectedArchive.expenses)} className="flex-1 px-8 py-4 bg-white border-2 border-slate-200 rounded-2xl font-black text-slate-900 hover:bg-slate-50 transition-all">Télécharger ZIP</button>
                <button onClick={() => handleGenerateEmail(selectedArchive.trip, selectedArchive.expenses)} className="flex-1 px-10 py-4 bg-teal-700 text-white font-black rounded-2xl shadow-xl hover:bg-teal-800 transition-all">Regénérer Rapport Email</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}





