import React from 'react';
import './ChatSkeleton.css';

export function ChatSkeleton() {
  return (
    <div className="bubble bubble-ai bubble-skeleton transition-bubble">
      <span className="bubble-label">IA</span>
      <div className="skeleton-lines">
        <div className="skeleton-line" style={{ width: '90%' }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
        <div className="skeleton-line" style={{ width: '60%' }} />
      </div>
    </div>
  );
}
