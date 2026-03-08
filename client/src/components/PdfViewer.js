import React from 'react';

export function PdfViewer({ source, onClose }) {
    // Comportement de fallback car les fichiers originaux sont effacés dans `server/index.js`

    return (
        <div className="pdf-viewer-container transition-slide">
            <div className="pdf-viewer-header">
                <h3>📄 Extracteur de Source PDF</h3>
                <div className="pdf-viewer-actions">
                    <button className="pdf-close-btn" onClick={onClose} title="Fermer">✕</button>
                </div>
            </div>
            <div className="pdf-viewer-content">
                <div className="pdf-mock-page">
                    <h4>{source?.source || "Document inconnu"} {source.page ? `- Page ${source.page}` : ''}</h4>
                    <hr />
                    <p className="pdf-mock-text">
                        {source?.content || "Aucun contenu extrait."}
                    </p>
                    <div className="pdf-mock-warning">
                        <span className="pdf-mock-warning-icon">ℹ️</span>
                        Pour des raisons de stockage, les fichiers originaux sont effacés du serveur après indexation vectorielle.
                        Ceci est le fragment exact vu et utilisé par l'IA.
                    </div>
                </div>
            </div>
        </div>
    );
}
