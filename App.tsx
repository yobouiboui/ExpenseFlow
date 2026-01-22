
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Download, Mail, Archive, Calendar, Paperclip, CheckCircle, LogOut, Settings, X, AlertTriangle, FileText, Trash2, MapPin, Clock, CalendarDays, Sparkles, Globe, Search } from 'lucide-react';
import ExpenseTable from './components/ExpenseTable';
import Modal from './components/Modal';
import ExpenseForm from './components/ExpenseForm';
import LoginScreen from './components/LoginScreen';
import { Expense, TripMetadata, EmailDraft, ArchivedTrip } from './types';
import { generateReimbursementEmail } from './services/geminiService';
import JSZip from 'jszip';

const STORAGE_KEY_EXPENSES = 'expenseFlow_expenses_prod_v1';
const STORAGE_KEY_ARCHIVE = 'expenseFlow_archive_prod_v1';
const STORAGE_KEY_TRIP = 'expenseFlow_trip_prod_v1';
const SESSION_KEY_AUTH = 'expenseFlow_auth_prod_v1';

const generateId = () => Math.random().toString(36).substr(2, 9);

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
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
    return saved ? JSON.parse(saved) : { 
      id: generateId(), 
      status: 'active', 
      startDateManual: null, 
      endDateManual: null, 
      name: 'Voyage Professionnel',
      departureLocation: 'Hamburg, Germany',
      destinationCountry: '',
      departureDate: '',
      returnDate: ''
    };
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
  
  // État pour la recherche dans les archives
  const [archiveSearchTerm, setArchiveSearchTerm] = useState('');

  // Refs pour contrôler l'ouverture du calendrier
  const departureInputRef = useRef<HTMLInputElement>(null);
  const returnInputRef = useRef<HTMLInputElement>(null);

  // Synchronisation persistante
  useEffect(() => { localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses)); }, [expenses]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(archivedTrips)); }, [archivedTrips]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_TRIP, JSON.stringify(trip)); }, [trip]);

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

  const handleDownloadCsv = () => {
    if (expenses.length === 0) return;
    const headers = ["Date", "Categorie", "Lieu", "Montant", "Devise", "Nuits", "PDJ"];
    const rows = expenses.map(e => [
      formatDate(e.date), 
      e.category, 
      e.location, 
      e.amount, 
      e.currency,
      e.hotelNights || '',
      e.hotelBreakfasts || ''
    ]);
    const csvContent = "\ufeff" + [headers, ...rows].map(r => r.join(";")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `frais_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
    URL.revokeObjectURL(url);
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
    setTrip({ 
      id: generateId(), 
      status: 'active', 
      startDateManual: null, 
      endDateManual: null, 
      name: 'Nouveau Voyage',
      departureLocation: 'Hamburg, Germany',
      destinationCountry: '',
      departureDate: '',
      returnDate: ''
    });
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
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {notification && (
        <div className="fixed top-6 right-6 z-[100] bg-indigo-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-right-4">
          <CheckCircle size={20} /> <span className="font-bold">{notification}</span>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white w-9 h-9 rounded-lg flex items-center justify-center font-black text-lg shadow-md">EF</div>
            <h1 className="text-lg font-extrabold text-slate-900 hidden md:block">ExpenseFlow</h1>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex bg-slate-100 p-1 rounded-lg">
              <button onClick={() => setActiveTab('expenses')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'expenses' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>En cours</button>
              <button onClick={() => setActiveTab('reports')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'reports' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Archives</button>
            </nav>
            <button onClick={() => { sessionStorage.clear(); setIsAuthenticated(false); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20}/></button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 md:px-6 py-8 pb-32">
        {activeTab === 'expenses' ? (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-black text-slate-900">Suivi des frais</h2>
              <p className="text-slate-500 font-medium text-sm mt-1">Gérez vos justificatifs et générez vos rapports.</p>
            </div>

            {/* BARRE D'OUTILS HARMONISÉE */}
            <div className="grid grid-cols-2 md:flex md:flex-wrap items-stretch gap-3 mb-6">
              
              {/* Bouton Principal - Ajout */}
              <button 
                onClick={() => { setEditingExpense(null); setIsFormOpen(true); }} 
                className="col-span-2 md:col-span-auto bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-md active:scale-95 transition-all"
              >
                <Plus size={16}/> Nouvelle facture
              </button>

              {/* Groupe Actions Données */}
              <button 
                onClick={() => handleGenerateEmail()} 
                disabled={expenses.length === 0}
                className="bg-indigo-50 text-indigo-700 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all disabled:opacity-40 border border-indigo-100"
              >
                <Sparkles size={16}/> Email IA
              </button>

              <button 
                onClick={() => handleDownloadZip()} 
                disabled={expenses.length === 0}
                className="bg-slate-100 text-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-200 transition-all disabled:opacity-40 border border-slate-200"
              >
                <Paperclip size={16}/> Justificatifs
              </button>

              <button 
                onClick={handleDownloadCsv} 
                disabled={expenses.length === 0} 
                className="bg-white text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-40"
              >
                <FileText size={16}/> CSV
              </button>

              {/* Groupe Actions Destructrices / Cloture */}
              <button 
                onClick={() => setIsArchiveConfirmOpen(true)} 
                disabled={expenses.length === 0} 
                className="bg-white text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-50 shadow-sm disabled:opacity-40 active:scale-95 ml-0 md:ml-auto"
              >
                <Archive size={16}/> Clôturer
              </button>

              <button 
                onClick={handleClearAll} 
                disabled={expenses.length === 0} 
                className="bg-red-50 text-red-600 border border-red-200 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-red-100 transition-all disabled:opacity-40"
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
                <h2 className="text-2xl font-black text-slate-900">Historique des voyages</h2>
                <p className="text-slate-500 font-medium text-sm mt-1">
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
                  className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-11 pr-4 text-sm font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all shadow-sm"
                  value={archiveSearchTerm}
                  onChange={(e) => setArchiveSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredAndSortedArchives.length === 0 ? (
                <div className="col-span-full py-40 text-center bg-white rounded-[3rem] border-4 border-dashed border-slate-200">
                  <Archive size={80} className="mx-auto mb-6 text-slate-200" />
                  <p className="text-2xl font-black text-slate-300">
                    {archiveSearchTerm ? "Aucune archive trouvée" : "Aucune archive pour le moment"}
                  </p>
                </div>
              ) : (
                filteredAndSortedArchives.map(arch => (
                  <div key={arch.id} className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-200 hover:shadow-xl transition-all cursor-pointer group relative" onClick={() => setSelectedArchive(arch)}>
                    <div className="flex justify-between items-start mb-6">
                      <h3 className="font-black text-xl text-slate-900 group-hover:text-indigo-600 transition-colors pr-8">{arch.trip.name}</h3>
                      <div className="flex items-center gap-2 absolute top-8 right-8">
                         <span className="bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full">Archive</span>
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
                        <span className="text-2xl font-black text-indigo-600">{arch.expenses.reduce((s,e)=>s+e.amount,0).toFixed(2)} {arch.expenses[0]?.currency}</span>
                        <span className="text-[10px] font-bold text-slate-400 mt-1">{formatDate(arch.trip.departureDate || arch.archivedAt)}</span>
                      </div>
                      <button className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg font-black text-sm group-hover:bg-indigo-600 group-hover:text-white transition-all">Voir détails</button>
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
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-30">
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
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-[10px] md:text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm truncate"
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
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-[10px] md:text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm truncate"
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
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none z-10">
                       <CalendarDays size={14} />
                    </div>
                    
                    <input 
                      ref={departureInputRef}
                      type="datetime-local" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-8 pr-8 text-[10px] md:text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                      value={trip.departureDate || ''}
                      onChange={(e) => handleUpdateTrip('departureDate', e.target.value)}
                    />
                    
                    {/* Bouton visible déclencheur */}
                    <button 
                      type="button"
                      onClick={(e) => { e.preventDefault(); openDatePicker(departureInputRef); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white border border-slate-100 rounded-lg text-indigo-600 hover:bg-indigo-50 shadow-sm z-20"
                      title="Choisir la date"
                    >
                      <Calendar size={12} />
                    </button>

                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest absolute -top-5 left-1 hidden md:block">Départ</span>
                  </div>

                  {/* RETURN DATE */}
                  <div className="relative flex-1 group min-w-0">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none z-10">
                       <Clock size={14} />
                    </div>
                    
                    <input 
                      ref={returnInputRef}
                      type="datetime-local" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-8 pr-8 text-[10px] md:text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-sm cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                      value={trip.returnDate || ''}
                      onChange={(e) => handleUpdateTrip('returnDate', e.target.value)}
                    />

                    {/* Bouton visible déclencheur */}
                    <button 
                      type="button"
                      onClick={(e) => { e.preventDefault(); openDatePicker(returnInputRef); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white border border-slate-100 rounded-lg text-indigo-600 hover:bg-indigo-50 shadow-sm z-20"
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
                <p className="text-3xl md:text-4xl font-black text-indigo-600 leading-none">
                  {expenses.reduce((s,e)=>s+e.amount,0).toFixed(2)} 
                  <span className="text-xl md:text-2xl text-indigo-300 ml-1">{expenses[0]?.currency || 'EUR'}</span>
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
            <button onClick={performArchive} className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">Valider l'archivage</button>
          </div>
        </div>
      </Modal>

      {/* PREVIEW IMAGE */}
      {previewImage && (
        <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} title="Visualisation du justificatif">
          <div className="bg-slate-100 p-4 rounded-3xl flex items-center justify-center min-h-[400px]">
            <img src={previewImage} alt="Facture" className="max-w-full max-h-[70vh] rounded-2xl shadow-2xl object-contain" />
          </div>
        </Modal>
      )}

      {/* MODAL EMAIL IA */}
      {isEmailModalOpen && (
        <Modal isOpen={isEmailModalOpen} onClose={() => setIsEmailModalOpen(false)} title="Demande de Remboursement">
          <div className="space-y-6">
            {isGeneratingEmail ? (
              <div className="py-24 text-center">
                <div className="animate-spin w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-6"></div>
                <p className="font-black text-xl text-indigo-600 animate-pulse">L'IA Gemini Flash rédige votre rapport...</p>
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
                   <a href={`mailto:sandrine@coralise.com?subject=${encodeURIComponent(emailDraft?.subject||'')}&body=${encodeURIComponent(emailDraft?.body||'')}`} className="flex-1 bg-indigo-600 text-white p-5 rounded-2xl font-black text-center shadow-xl active:scale-95 transition-all hover:bg-indigo-700">Transférer à Sandrine (Email)</a>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

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
              <div className="text-5xl font-black text-indigo-600">Total : {selectedArchive.expenses.reduce((s,e)=>s+e.amount,0).toFixed(2)} {selectedArchive.expenses[0]?.currency}</div>
              <div className="flex gap-4 w-full md:w-auto">
                <button onClick={() => handleDownloadZip(selectedArchive.expenses)} className="flex-1 px-8 py-4 bg-white border-2 border-slate-200 rounded-2xl font-black text-slate-900 hover:bg-slate-50 transition-all">Télécharger ZIP</button>
                <button onClick={() => handleGenerateEmail(selectedArchive.trip, selectedArchive.expenses)} className="flex-1 px-10 py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-xl hover:bg-indigo-700 transition-all">Regénérer Rapport Email</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
