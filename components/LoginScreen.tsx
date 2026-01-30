import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (password: string) => boolean;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onLogin(password)) {
      setError(false);
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col justify-center items-center p-4 font-sans">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-slate-50 to-teal-50" />
      <div className="absolute -top-24 -right-24 h-[420px] w-[420px] rounded-full bg-amber-200/40 blur-3xl" />
      <div className="absolute -bottom-28 -left-24 h-[520px] w-[520px] rounded-full bg-teal-200/40 blur-3xl" />
      <div className="absolute inset-0 bg-noise opacity-40" />
      <div className="relative z-10 glass-card soft-shadow w-full max-w-md rounded-[2rem] border border-white/60 p-8">
        <div className="flex justify-center mb-6">
          <div className="bg-teal-700/10 p-4 rounded-2xl shadow-inner border border-teal-200/60">
            <Lock className="w-10 h-10 text-teal-700" />
          </div>
        </div>
        
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-slate-900 mb-2 font-display tracking-tight">ExpenseFlow</h2>
          <p className="text-slate-600 text-sm">Portail de gestion des frais de déplacement</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              placeholder="Entrez votre mot de passe"
              className={`w-full px-4 py-3 rounded-lg border ${error ? 'border-red-500 focus:ring-red-500 bg-red-50' : 'border-slate-300 focus:ring-teal-500 bg-white'} focus:outline-none focus:ring-2 transition-all text-slate-900 placeholder-slate-400`}
              autoFocus
            />
            {error && (
              <p className="text-red-600 text-xs mt-2 font-medium flex items-center animate-pulse">
                Mot de passe incorrect
              </p>
            )}
          </div>
          
          <button
            type="submit"
            className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg transform active:scale-95"
          >
            Accéder au tableau de bord
            <ArrowRight size={18} />
          </button>
        </form>
        
        <div className="mt-8 text-center border-t border-white/60 pt-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Coriolis Composites</p>
            <p className="text-[10px] text-slate-400 mt-1">Accès réservé au personnel autorisé</p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;

