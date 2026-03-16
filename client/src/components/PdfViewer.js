import React from 'react';
import { motion } from 'framer-motion';

export function PdfViewer({ source, onClose }) {
    if (!source) return null;

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-hidden w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700/50 shadow-sm z-10">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg">
                        <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Extrait de Document
                    </h3>
                </div>
                <button 
                    onClick={onClose}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
                    title="Fermer le panneau"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 dark:bg-slate-900/50">
                <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="max-w-2xl mx-auto bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200/60 dark:border-slate-700/50"
                >
                    <div className="mb-4 pb-4 border-b border-slate-100 dark:border-slate-700/50">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            {source?.source || "Document inconnu"} 
                            {source.page && (
                                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs rounded-full font-medium">
                                    Page {source.page}
                                </span>
                            )}
                        </h4>
                    </div>
                    
                    <div className="prose prose-sm dark:prose-invert max-w-none mb-8 text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50/50 dark:bg-slate-900/50 p-4 rounded-xl font-serif">
                        {source?.content || "Aucun contenu extrait."}
                    </div>
                    
                    {/* The Info Alert - Redesigned */}
                    <div className="flex gap-3 p-4 rounded-xl bg-blue-50/80 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30">
                        <div className="flex-shrink-0 mt-0.5">
                            <svg className="w-5 h-5 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <p className="text-sm text-blue-800 dark:text-blue-300/90 leading-relaxed">
                            <span className="font-semibold mb-1 block">Information de stockage</span>
                            Pour des raisons d'optimisation, les fichiers originaux sont purgés du serveur après leur vectorisation. Ceci est le <strong>fragment exact</strong> vu et utilisé par l'IA pour générer sa réponse.
                        </p>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
