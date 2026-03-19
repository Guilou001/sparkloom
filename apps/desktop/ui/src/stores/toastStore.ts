import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = String(++nextId);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (toast.type !== "error") {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, 3000);
    }
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Shorthand helpers (callable from anywhere, no hooks needed) */
export const toast = {
  success: (message: string) =>
    useToastStore.getState().addToast({ type: "success", message }),
  error: (message: string, action?: Toast["action"]) =>
    useToastStore.getState().addToast({ type: "error", message, action }),
  info: (message: string) =>
    useToastStore.getState().addToast({ type: "info", message }),
};
