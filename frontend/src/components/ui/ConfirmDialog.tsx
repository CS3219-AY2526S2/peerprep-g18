import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-6">
      <div className="bg-[#3A3552] rounded-[24px] w-full max-w-sm p-8 border border-white/10 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          {danger && <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />}
          <h3 className="text-white font-bold text-lg">{title}</h3>
        </div>
        <p className="text-gray-300 mb-8 text-sm leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-2xl font-bold text-gray-300 bg-white/5 hover:bg-white/10 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-3 rounded-2xl font-bold transition-all ${
              danger
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white border border-red-500/30'
                : 'btn-secondary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
