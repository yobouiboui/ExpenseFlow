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
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center p-4 font-sans">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-200">
        <div className="flex justify-center mb-6">
          <div className="bg-indigo-100 p-4 rounded-full shadow-inner">
            <Lock className="w-10 h-10 text-indigo-600" />
          </div>
        </div>
        
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">ExpenseFlow</h2>
          <p className="text-gray-500 text-sm">Portail de gestion des frais de déplacement</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              placeholder="Entrez votre mot de passe"
              className={`w-full px-4 py-3 rounded-lg border ${error ? 'border-red-500 focus:ring-red-500 bg-red-50' : 'border-gray-300 focus:ring-indigo-500 bg-white'} focus:outline-none focus:ring-2 transition-all text-gray-900 placeholder-gray-400`}
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
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg transform active:scale-95"
          >
            Accéder au tableau de bord
            <ArrowRight size={18} />
          </button>
        </form>
        
        <div className="mt-8 text-center border-t border-gray-100 pt-6">
            <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Coriolis Composites</p>
            <p className="text-[10px] text-gray-300 mt-1">Accès réservé au personnel autorisé</p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;