import React from 'react';
import { Expense, ExpenseCategory } from '../types';
import { MapPin, Receipt, Pencil, Trash2, Moon, Coffee } from 'lucide-react';

interface ExpenseTableProps {
  expenses: Expense[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  onViewReceipt: (url: string) => void;
  isReadonly?: boolean;
}

const CategoryBadge: React.FC<{ category: ExpenseCategory }> = ({ category }) => {
  const colors: Record<ExpenseCategory, string> = {
    [ExpenseCategory.Meals]: 'bg-orange-50 text-orange-700 border-orange-200',
    [ExpenseCategory.Hotel]: 'bg-blue-50 text-blue-700 border-blue-200',
    [ExpenseCategory.Taxi]: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    [ExpenseCategory.Transport]: 'bg-purple-50 text-purple-700 border-purple-200',
    [ExpenseCategory.Parking]: 'bg-slate-50 text-slate-600 border-slate-200',
    [ExpenseCategory.Fuel]: 'bg-red-50 text-red-700 border-red-200',
    [ExpenseCategory.Tolls]: 'bg-teal-50 text-teal-700 border-teal-200',
    [ExpenseCategory.Misc]: 'bg-teal-50 text-teal-700 border-teal-200',
  };
  return <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border ${colors[category]}`}>{category}</span>;
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
};

const ExpenseTable: React.FC<ExpenseTableProps> = ({ expenses, onEdit, onDelete, onViewReceipt, isReadonly = false }) => {
  if (expenses.length === 0) {
    return (
      <div className="text-center py-24 glass-card rounded-[2.5rem] border-2 border-dashed border-white/70 mt-6 soft-shadow">
        <Receipt size={48} className="mx-auto text-slate-200 mb-4" />
        <p className="text-slate-400 font-black">Aucune dépense enregistrée.</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-[2rem] border border-white/60 soft-shadow overflow-hidden mt-6">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/70 border-b border-white/60">
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Lieu & Détails</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Montant</th>
              <th className="px-8 py-5 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Reçu</th>
              {!isReadonly && <th className="px-8 py-5 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {expenses.map((expense) => (
              <tr key={expense.id} className="hover:bg-slate-50/70 transition-colors group">
                <td className="px-8 py-6 text-sm font-black text-slate-900">{formatDate(expense.date)}</td>
                <td className="px-8 py-6"><CategoryBadge category={expense.category} /></td>
                <td className="px-8 py-6 text-sm text-slate-500 font-bold">
                  <div className="flex items-center gap-2"><MapPin size={14} className="text-teal-400"/> {expense.location}</div>
                  
                  {/* Affichage des détails Hôtel */}
                  {expense.category === ExpenseCategory.Hotel && (
                    <div className="flex gap-3 mt-1.5 ml-0.5">
                       {expense.hotelNights !== undefined && expense.hotelNights > 0 && (
                         <span className="flex items-center gap-1 text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100" title="Nuits">
                           <Moon size={10} /> {expense.hotelNights}
                         </span>
                       )}
                       {expense.hotelBreakfasts !== undefined && expense.hotelBreakfasts > 0 && (
                         <span className="flex items-center gap-1 text-[10px] font-black uppercase text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100" title="Petits-déjeuners">
                           <Coffee size={10} /> {expense.hotelBreakfasts}
                         </span>
                       )}
                    </div>
                  )}
                </td>
                <td className="px-8 py-6">
                  <span className="text-xl font-black text-slate-900">{expense.amount.toFixed(2)}</span>
                  <span className="ml-1.5 text-[10px] font-black text-slate-300 uppercase">{expense.currency}</span>
                </td>
                <td className="px-8 py-6 text-center">
                  {expense.receiptDataUrl ? (
                    <button type="button" onClick={() => onViewReceipt(expense.receiptDataUrl!)} className="p-3 text-teal-700 bg-teal-50 rounded-xl hover:bg-teal-100 transition-all shadow-sm">
                      <Receipt size={18} />
                    </button>
                  ) : <span className="text-slate-200">—</span>}
                </td>
                {!isReadonly && (
                  <td className="px-8 py-6 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => onEdit(expense)} className="p-3 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-all">
                        <Pencil size={18} />
                      </button>
                      <button type="button" onClick={() => onDelete(expense.id)} className="p-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExpenseTable;

