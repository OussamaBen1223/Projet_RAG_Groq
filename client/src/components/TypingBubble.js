import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion } from 'framer-motion';
import { FcLink } from 'react-icons/fc';

/**
 * Composant TypingBubble
 * Affiche la réponse de l'IA avec un effet de streaming et des sources (citations) interactives.
 */
export function TypingBubble({ text, sources = [], isStreaming, onSourceClick }) {
  // L'IA stream en temps réel depuis App.js qui accumule le texte (text prop).
  // Lorsque isStreaming est true, on affiche le bloc curseur clignotant à la fin.
  
  // Pré-traitement : transforme les citations [1], [2] en liens Markdown factices
  // ex: [1] -> [ [1] ](#source-1)
  const preprocessCitations = (textToRender) => {
    if (!textToRender) return "";
    return textToRender.replace(/\[(\d+)\]/g, (match, id) => `[${match}](#source-${id})`);
  };

  const processedText = preprocessCitations(text);

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* En-tête de la bulle */}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
          <span className="text-white text-xs font-bold">IA</span>
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Assistant M</span>
        {isStreaming && (
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-full"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
            <span className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400 tracking-wider">Génération...</span>
          </motion.div>
        )}
      </div>

      {/* Contenu Markdown */}
      <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm ml-4 relative">
        <div className="prose prose-slate dark:prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-pre:bg-slate-900 prose-pre:text-slate-50">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Rendu personnalisé pour les liens (pour intercepter nos citations In-Text)
              a: ({ node, href, children, ...props }) => {
                if (href?.startsWith('#source-')) {
                  const sourceId = parseInt(href.replace('#source-', ''), 10);
                  const source = sources.find(s => s.id === sourceId) || sources[sourceId - 1];
                  
                  if (source) {
                    return (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:hover:bg-indigo-800/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded cursor-pointer transition-colors align-baseline"
                        onClick={(e) => { e.preventDefault(); onSourceClick && onSourceClick(source); }}
                        title={source.source ? `Source : ${source.source}` : `Voir la source`}
                      >
                        <FcLink size={12} className="opacity-70" />
                        {children}
                      </motion.button>
                    );
                  }
                }
                // Liens standards sortants
                return <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-500 transition-colors" {...props}>{children}</a>;
              }
            }}
          >
            {processedText}
          </ReactMarkdown>
          
          {/* Curseur animé s'affichant à la fin du texte pendant le streaming */}
          {isStreaming && (
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="inline-block w-2.5 h-4 bg-indigo-500 ml-1 translate-y-0.5 rounded-sm"
            />
          )}
        </div>
      </div>

      {/* Liste complète des sources en bas de bulle */}
      {sources?.length > 0 && !isStreaming && (
        <motion.div 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="ml-4 mt-1 flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-70">
              <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sources :
          </span>
          {sources.map((src, i) => (
            <button
              key={i}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-xs text-slate-600 dark:text-slate-300 rounded-lg shadow-sm transition-all"
              onClick={() => onSourceClick && onSourceClick(src)}
            >
              <FcLink size={14} />
              <span className="truncate max-w-[150px] font-medium">
                {src.source || `Source ${src.id || i + 1}`}
              </span>
              {src.page && <span className="opacity-60 text-[10px] px-1 bg-slate-100 dark:bg-slate-700 rounded-md">p.{src.page}</span>}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
