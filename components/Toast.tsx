"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { TickCircle, Warning2, InfoCircle, CloseCircle } from "iconsax-react";

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ConfirmState = {
  id: number;
  title: string;
  message?: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (opts: {
    title: string;
    message?: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = ++counter;
      setToasts((list) => [...list, { id, message, tone }]);
      setTimeout(() => remove(id), 3800);
    },
    [remove],
  );

  const confirm = useCallback<ToastContextValue["confirm"]>((opts) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        id: ++counter,
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? "Tasdiqlash",
        danger: opts.danger ?? false,
        resolve,
      });
    });
  }, []);

  function resolveConfirm(ok: boolean) {
    if (confirmState) confirmState.resolve(ok);
    setConfirmState(null);
  }

  return (
    <ToastContext.Provider value={{ toast, confirm }}>
      {children}

      {/* Toast stack */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-[fadeIn_.15s_ease]">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100 animate-[popIn_.18s_cubic-bezier(.16,1,.3,1)]">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  confirmState.danger
                    ? "bg-red-50 text-red-600"
                    : "bg-brand-50 text-brand-600"
                }`}
              >
                <Warning2 size={22} variant="Bold" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">
                  {confirmState.title}
                </h3>
                {confirmState.message && (
                  <p className="mt-1 text-sm text-slate-500">
                    {confirmState.message}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => resolveConfirm(false)}>
                Bekor qilish
              </button>
              <button
                className={confirmState.danger ? "btn-danger" : "btn-primary"}
                onClick={() => resolveConfirm(true)}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

const TONE_STYLE: Record<
  ToastTone,
  { ring: string; icon: ReactNode }
> = {
  success: {
    ring: "ring-emerald-100",
    icon: <TickCircle size={20} variant="Bold" className="text-emerald-500" />,
  },
  error: {
    ring: "ring-red-100",
    icon: <CloseCircle size={20} variant="Bold" className="text-red-500" />,
  },
  info: {
    ring: "ring-brand-100",
    icon: <InfoCircle size={20} variant="Bold" className="text-brand-500" />,
  },
};

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const style = TONE_STYLE[toast.tone];
  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-soft ring-1 ${style.ring} animate-[slideIn_.22s_cubic-bezier(.16,1,.3,1)]`}
    >
      {style.icon}
      <p className="flex-1 text-sm font-medium text-slate-700">
        {toast.message}
      </p>
      <button
        onClick={onClose}
        className="text-slate-300 transition hover:text-slate-500"
        aria-label="Yopish"
      >
        ✕
      </button>
    </div>
  );
}
