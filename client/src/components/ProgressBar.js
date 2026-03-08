import React from 'react';
import './ProgressBar.css';

export function ProgressBar({ indeterminate = true }) {
  return (
    <div className="progress-bar" role="progressbar" aria-valuetext={indeterminate ? "Chargement en cours" : undefined}>
      <div className={`progress-bar-fill ${indeterminate ? 'progress-bar-indeterminate' : ''}`} />
    </div>
  );
}
