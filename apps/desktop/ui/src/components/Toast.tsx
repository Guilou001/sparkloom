import { useToastStore, type Toast as ToastData } from "../stores/toastStore";
import { Check, X, AlertCircle, Info } from "lucide-react";

const icons: Record<ToastData["type"], React.ReactNode> = {
  success: <Check size={16} style={{ color: "#22c55e" }} />,
  error: <AlertCircle size={16} style={{ color: "#ef4444" }} />,
  info: <Info size={16} style={{ color: "#6366f1" }} />,
};

const borderColors: Record<ToastData["type"], string> = {
  success: "rgba(34,197,94,0.4)",
  error: "rgba(239,68,68,0.4)",
  info: "rgba(99,102,241,0.4)",
};

function ToastItem({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm"
      style={{
        backgroundColor: "var(--color-surface-elevated)",
        borderColor: borderColors[toast.type],
        animation: "toast-slide-in 200ms ease-out",
      }}
    >
      {icons[toast.type]}
      <span className="flex-1 text-sm" style={{ color: "var(--color-text)" }}>
        {toast.message}
      </span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            removeToast(toast.id);
          }}
          className="rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-white/10"
          style={{ color: "var(--color-primary)" }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => removeToast(toast.id)}
        className="opacity-50 transition-opacity hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
      <style>{`
        @keyframes toast-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
