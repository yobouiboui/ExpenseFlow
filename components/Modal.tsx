import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
      <div className="glass-card rounded-2xl soft-shadow w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col border border-white/60">
        <div className="flex items-center justify-between p-5 border-b border-white/60">
          <h3 className="text-lg font-semibold text-slate-900 font-display">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-teal-700 p-1">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
