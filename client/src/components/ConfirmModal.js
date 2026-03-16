import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ConfirmModal - A professional, animated replacement for window.confirm()
 *
 * Props:
 *  - isOpen: boolean
 *  - title: string
 *  - message: string
 *  - confirmLabel: string (default: "Confirmer")
 *  - cancelLabel: string (default: "Annuler")
 *  - variant: 'danger' | 'warning' | 'info' (default: 'danger')
 *  - onConfirm: () => void
 *  - onCancel: () => void
 */
const ConfirmModal = ({
  isOpen,
  title = 'Confirmation',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'danger',
  onConfirm,
  onCancel,
}) => {
  const variantStyles = {
    danger: {
      icon: '🚨',
      iconBg: 'bg-red-100',
      confirmBtn: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    },
    warning: {
      icon: '⚠️',
      iconBg: 'bg-amber-100',
      confirmBtn: 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-400',
    },
    info: {
      icon: 'ℹ️',
      iconBg: 'bg-indigo-100',
      confirmBtn: 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500',
    },
  };
  const s = variantStyles[variant] || variantStyles.danger;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 pt-6 pb-4 flex items-start gap-4">
                <div className={`flex-shrink-0 w-12 h-12 ${s.iconBg} rounded-full flex items-center justify-center text-2xl`}>
                  {s.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-slate-800 mb-1">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-slate-100 mx-6" />

              {/* Footer */}
              <div className="px-6 py-4 flex items-center justify-end gap-3">
                <button
                  onClick={onCancel}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={`px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${s.confirmBtn}`}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ConfirmModal;
