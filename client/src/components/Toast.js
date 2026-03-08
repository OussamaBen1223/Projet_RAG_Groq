import React from 'react';
import './Toast.css';

export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(({ id, message, type }) => (
        <div
          key={id}
          className={`toast toast-${type}`}
          role="alert"
          onClick={() => removeToast(id)}
        >
          <span className="toast-icon">
            {type === 'success' && '✓'}
            {type === 'error' && '✕'}
            {type === 'info' && 'ℹ'}
          </span>
          <span className="toast-message">{message}</span>
        </div>
      ))}
    </div>
  );
}
