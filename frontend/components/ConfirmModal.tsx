'use client';
import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export type ConfirmVariant = 'primary' | 'danger';

interface Props {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'primary', onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'INPUT') onConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const isDanger = variant === 'danger';
  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 backdrop-blur-md p-6 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="glass-strong rounded-3xl p-7 max-w-md w-full border border-slate-700/40 shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-4 mb-5">
          <div className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center ${isDanger ? 'bg-rose-500/15' : 'bg-blue-500/15'}`}>
            {isDanger ? <AlertTriangle className="w-5 h-5 text-rose-400" /> : <Info className="w-5 h-5 text-blue-400" />}
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white mb-1.5">{title}</h3>
            <div className="text-sm text-slate-400 leading-relaxed">{message}</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/40 rounded-xl transition-all"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all shadow-lg ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/20'
                : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Convenience hook: useConfirm() returns [ConfirmModal, askConfirm]
type AskConfirmOpts = {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

export function useConfirm() {
  const [state, setState] = useState<({ open: true; resolve: (v: boolean) => void } & AskConfirmOpts) | { open: false }>({ open: false });

  const ask = useCallback((opts: AskConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, resolve, ...opts });
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setState((s) => {
      if (s.open) s.resolve(value);
      return { open: false };
    });
  }, []);

  const node = state.open ? (
    <ConfirmModal
      open
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { node, ask } as const;
}
