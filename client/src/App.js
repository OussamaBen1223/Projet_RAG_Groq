import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import './App.css';
import { ToastContainer } from './components/Toast';
import { useToast } from './hooks/useToast';
import { Spinner } from './components/Spinner';
import { ChatSkeleton } from './components/ChatSkeleton';
import { TypingBubble } from './components/TypingBubble';
import { ProgressBar } from './components/ProgressBar';
import { PdfViewer } from './components/PdfViewer';
import { supabase } from './supabaseClient';
import Login from './components/Login';
import { FcDataBackup, FcDocument, FcFile, FcFullTrash, FcLandscape, FcNightLandscape, FcLeave } from 'react-icons/fc';
import { motion, AnimatePresence } from 'framer-motion';
import ConfirmModal from './components/ConfirmModal';

const THEME_KEY = 'pdf-chat-theme';
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000";

function App() {
  const [session, setSession] = useState(null);
  const { toasts, showToast, removeToast } = useToast();
  const messagesEndRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [pdfReady, setPdfReady] = useState(() => {
    return localStorage.getItem('pdf-chat-ready') === 'true';
  });
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState(() => {
    const saved = localStorage.getItem('pdf-chat-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [indexedDocs, setIndexedDocs] = useState(() => {
    const saved = localStorage.getItem('pdf-chat-indexed-docs');
    return saved ? JSON.parse(saved) : [];
  });
  const [suggestions, setSuggestions] = useState(() => {
    const saved = localStorage.getItem('pdf-chat-suggestions');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedSource, setSelectedSource] = useState(null);
  const [pdfWidth, setPdfWidth] = useState(45); // Pourcentage
  const splitContainerRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [abortController, setAbortController] = useState(null);
  const [sessionId, setSessionId] = useState(() => {
    let id = localStorage.getItem('pdf-chat-session-id');
    if (!id) {
      id = 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      localStorage.setItem('pdf-chat-session-id', id);
    }
    return id;
  });
  const [sessionsList, setSessionsList] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [theme, setTheme] = useState(() =>
    localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  // Custom confirm modal state
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', variant: 'danger', onConfirm: null });
  const openConfirm = ({ title, message, variant = 'danger', onConfirm }) =>
    setConfirmModal({ isOpen: true, title, message, variant, onConfirm });
  const closeConfirm = () => setConfirmModal(prev => ({ ...prev, isOpen: false, onConfirm: null }));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Écoute de l'état d'authentification Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) axios.defaults.headers.common['Authorization'] = `Bearer ${session.access_token}`;
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${session.access_token}`;
      } else {
        // --- LOGOUT CLEANUP ---
        // Quand l'utilisateur se déconnecte, on nettoie TOUT pour le prochain utilisateur
        delete axios.defaults.headers.common['Authorization'];
        localStorage.removeItem('pdf-chat-history');
        localStorage.removeItem('pdf-chat-indexed-docs');
        localStorage.removeItem('pdf-chat-suggestions');
        localStorage.removeItem('pdf-chat-ready');
        // On génère aussi un nouveau SessionID pour le prochain user (empêche de relire l'ancienne session en BDD)
        const newId = 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        localStorage.setItem('pdf-chat-session-id', newId);
        
        // Reset des states React pour virer l'affichage en cours
        setChat([]);
        setIndexedDocs([]);
        setSuggestions([]);
        setPdfReady(false);
        setSessionId(newId);
        setSessionsList([]);
        setSelectedSource(null);
        setFiles([]); // Vider la liste des fichiers uploadés
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Initialisation : Récupération de l'historique depuis Supabase Postgres
  useEffect(() => {
    if (sessionId && session) {
      axios.get(`${API_URL}/history/${sessionId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
        .then(res => {
          if (res.data) {
            const serverMessages = res.data.messages || [];
            if (serverMessages.length > 0) {
              const chatFormat = serverMessages.map(m => ({
                q: m.sender === 'user' ? m.text : '',
                a: m.sender === 'bot' ? m.text : '',
                sources: m.sources,
              })).reduce((acc, curr, index, array) => {
                // Reconstruire l'objet {q, a, sources, ...} tel qu'attendu par le UI
                if (curr.q) {
                  const next = array[index + 1];
                  acc.push({
                    q: curr.q,
                    a: next?.a || '',
                    sources: next?.sources || []
                  });
                }
                return acc;
              }, []);
              if (chatFormat.length > 0) setChat(chatFormat);
            }

            if (res.data.documents && res.data.documents.length > 0) {
              setIndexedDocs(res.data.documents);
              setPdfReady(true);
            }
          }
        })
        .catch(err => console.warn("Historique non accessible / inexistant :", err));
    }

    if (session) {
      axios.get(`${API_URL}/sessions`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
        .then(res => setSessionsList(res.data || []))
        .catch(err => console.error("Erreur charment liste sessions :", err));
    }
  }, [sessionId, session]);

  const startNewSession = () => {
    const id = 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('pdf-chat-session-id', id);
    setSessionId(id);
    setChat([]);
    setIndexedDocs([]);
    setPdfReady(false);
    setIsSidebarOpen(false);
  };

  const switchSession = (id) => {
    if (id === sessionId) return;
    localStorage.setItem('pdf-chat-session-id', id);
    setSessionId(id);
    setChat([]);
    setIndexedDocs([]);
    setPdfReady(false);
    setIsSidebarOpen(false);
  };

  const deleteSession = async (idToDelete) => {
    try {
      await axios.delete(`${API_URL}/history/${idToDelete}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      showToast("Conversation supprimée", "success");
      
      // Mettre à jour la liste affichée dans la sidebar
      setSessionsList(prev => prev.filter(s => s.id !== idToDelete));
      
      // Si la session supprimée est la session actuellement ouverte, on reset l'interface completement
      if (idToDelete === sessionId) {
        startNewSession();
      }
    } catch (err) {
      console.error("Erreur lors de la suppression de la session :", err);
      showToast("Erreur lors de la suppression.", "error");
    }
  };

  // Sauvegarde de l'état "PDF prêt"
  useEffect(() => {
    localStorage.setItem('pdf-chat-ready', pdfReady);
  }, [pdfReady]);

  // Sauvegarde de l'historique du chat
  useEffect(() => {
    localStorage.setItem('pdf-chat-history', JSON.stringify(chat));
  }, [chat]);

  // Sauvegarde des documents actifs
  useEffect(() => {
    localStorage.setItem('pdf-chat-indexed-docs', JSON.stringify(indexedDocs));
  }, [indexedDocs]);

  // Sauvegarde des suggestions
  useEffect(() => {
    localStorage.setItem('pdf-chat-suggestions', JSON.stringify(suggestions));
  }, [suggestions]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const startResizing = React.useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    const handleMouseMove = (eMove) => {
      if (!splitContainerRef.current) return;
      const containerRect = splitContainerRef.current.getBoundingClientRect();
      const newWidthPx = containerRect.right - eMove.clientX;
      const newWidthPercent = (newWidthPx / containerRect.width) * 100;
      // Limiter le panneau entre 20% et 80% de l'écran
      const clampedWidth = Math.min(Math.max(newWidthPercent, 20), 80);
      setPdfWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleFiles = (selectedFiles) => {
    if (!selectedFiles?.length) return;

    const isValidFile = (file) => {
      const validTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
        "text/csv",
        "image/jpeg",
        "image/png"
      ];
      const validExtensions = [".pdf", ".docx", ".txt", ".md", ".csv", ".jpg", ".jpeg", ".png"];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      return validTypes.includes(file.type) || validExtensions.includes(ext) || file.type.startsWith("text/") || file.type.startsWith("image/");
    };

    const valid = Array.from(selectedFiles).filter(isValidFile);
    const invalid = selectedFiles.length - valid.length;
    if (invalid > 0) showToast(`${invalid} fichier(s) ignoré(s) - formats acceptés: PDF, DOCX, TXT, MD, CSV, JPG, PNG.`, "error");
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      const newFiles = valid.filter((f) => !seen.has(f.name));
      return [...prev, ...newFiles].slice(0, 10);
    });
  };

  const removeFile = (name) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer?.files;
    if (dropped?.length) handleFiles(dropped);
  };

  const handleUpload = async () => {
    if (!files.length) return showToast("Choisis au moins un document !", "error");
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("sessionId", sessionId);

    setLoading(true);
    setUploadError(null);
    setUploadProgress(0);
    setUploadStatus("Envoi dans la file d'attente...");

    try {
      // 1. Envoi au Backend et récupération de l'ID du Job (BullMQ)
      const res = await axios.post(`${API_URL}/upload`, formData, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (!res.data.jobId) {
        // Fallback si pas de Redis configuré, le backend agit de manière synchrone classique
        finishUploadSuccess(res.data.indexedDocs || []);
        return;
      }

      const jobId = res.data.jobId;
      setUploadStatus("Traitement en arrière-plan...");

      // 2. Polling progressif (Chaque seconde)
      const interval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`${API_URL}/queue/${jobId}`, {
            headers: { Authorization: `Bearer ${session?.access_token}` }
          });
          const data = statusRes.data;

          setUploadProgress(data.progress || 0);

          if (data.state === 'completed') {
            clearInterval(interval);
            setUploadProgress(100);
            finishUploadSuccess(data.result?.indexedDocs || []);
          } else if (data.state === 'failed') {
            clearInterval(interval);
            throw new Error(data.reason || "Échec du job asynchrone.");
          }
        } catch (pollErr) {
          clearInterval(interval);
          handleUploadError(pollErr);
        }
      }, 1000);

    } catch (err) {
      handleUploadError(err);
    }
  };

  const finishUploadSuccess = async (docs) => {
    setPdfReady(true);
    setIndexedDocs(docs);
    setChat([]);
    setUploadStatus("");
    setUploadProgress(0);
    setUploadError(null);
    showToast(files.length > 1 ? `${files.length} documents analysés !` : "Document analysé ! Tu peux poser tes questions.", "success");
    setLoading(false);

    // Générer suggestions
    try {
      const suggRes = await axios.post(`${API_URL}/suggest`, { sessionId }, { timeout: 30000 });
      setSuggestions(suggRes.data.suggestions || []);
    } catch (err) {
      console.warn("Impossible de récupérer les suggestions", err);
    }
  };

  const handleUploadError = (err) => {
    setUploadError(err.response?.data?.error || err.message || "Erreur lors de l'upload");
    setUploadStatus("");
    setUploadProgress(0);
    showToast("Erreur lors de l'upload", "error");
    setLoading(false);
  };

  const clearFiles = () => {
    setFiles([]);
    setPdfReady(false);
    setIndexedDocs([]);
    setSuggestions([]);
    setChat([]);
    setUploadError(null);
  };

  const handleStop = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  const handleChat = async (retryQuestion = null) => {
    // Ignorer l'événement React passé par onClick
    const isRetryStr = typeof retryQuestion === "string";
    const userQuestion = isRetryStr ? retryQuestion : question;
    if (!userQuestion) return;
    if (!isRetryStr) setQuestion("");

    const newController = new AbortController();
    setAbortController(newController);

    setChat(prev => {
      if (isRetryStr) {
        const idx = prev.findIndex(m => m.q === retryQuestion && m.hasError);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], loading: true, hasError: false };
          return updated;
        }
      }
      return [...prev, { q: userQuestion, a: "", loading: true, isStreaming: false }];
    });
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ question: userQuestion, sessionId }),
        signal: newController.signal
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Erreur serveur HTTP ${res.status}`);
      }

      setChat(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.q === userQuestion && m.loading);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], loading: false, isStreaming: true, a: "", sources: [] };
        }
        return updated;
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const messages = chunk.split("\n\n");
          for (const msg of messages) {
            if (msg.startsWith("data: ")) {
              const dataStr = msg.replace(/^data:\s*/, "");
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }
              try {
                const parsed = JSON.parse(dataStr);
                setChat(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.q === userQuestion);
                  if (idx >= 0) {
                    if (parsed.type === "sources") {
                      updated[idx] = { ...updated[idx], sources: parsed.data };
                    } else if (parsed.type === "token") {
                      updated[idx] = { ...updated[idx], a: updated[idx].a + (parsed.data || "") };
                    } else if (parsed.type === "error") {
                      updated[idx] = { ...updated[idx], hasError: true, errorMsg: parsed.data, isStreaming: false };
                    }
                  }
                  return updated;
                });
              } catch (e) {
                // Ignore incomplete JSON chunks (though split by \n\n should minimize this)
              }
            }
          }
        }
      }

      setChat(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.q === userQuestion);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], isStreaming: false, loading: false };
        }
        return updated;
      });

    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("🛑 Génération annulée par l'utilisateur.");
        setChat(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.q === userQuestion && (m.loading || m.isStreaming));
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], loading: false, isStreaming: false, a: updated[idx].a + " [Interrompu]" };
          }
          return updated;
        });
      } else {
        const msg = err.message || "Erreur chat";
        showToast(msg, "error");
        setChat(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.q === userQuestion && (m.loading || m.isStreaming));
          if (idx >= 0) {
            updated[idx] = {
              q: userQuestion,
              a: updated[idx].a || null,
              loading: false,
              isStreaming: false,
              hasError: true,
              errorMsg: msg,
            };
          }
          return updated;
        });
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const clearChat = () => {
    openConfirm({
      title: 'Effacer la conversation',
      message: "Es-tu sûr de vouloir effacer tout l'historique de cette conversation ? Cette action est irréversible.",
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        try {
          await axios.delete(`${API_URL}/history/${sessionId}`, {
            headers: { Authorization: `Bearer ${session?.access_token}` }
          });
          setChat([]);
          localStorage.removeItem('pdf-chat-history');
          showToast("Historique effacé.", "success");
        } catch (err) {
          console.error("Erreur l'effacement de l'historique :", err);
          showToast("Erreur lors de la suppression de l'historique serveur.", "error");
        }
      },
    });
  };

  const exportChatTxt = () => {
    if (!chat.length) return;
    const text = chat.map(m => `Utilisateur : ${m.q}\nAssistant : ${m.loading ? '...' : (m.hasError ? 'Erreur' : m.a)}\n---`).join('\n\n');
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat_export_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Conversation exportée", "success");
  };

  const exportChatPdf = () => {
    if (!chat.length) return;
    const doc = new jsPDF();
    let yPos = 20;
    const pageHeight = doc.internal.pageSize.height;
    const marginLeft = 15;
    const maxWidth = 180;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Export - Chat avec tes documents", marginLeft, yPos);
    yPos += 15;

    doc.setFontSize(11);

    chat.forEach((m) => {
      // Utilisateur
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 60, 150);
      doc.text("Vous :", marginLeft, yPos);
      yPos += 7;

      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      const userLines = doc.splitTextToSize(m.q, maxWidth);
      doc.text(userLines, marginLeft, yPos);
      yPos += (userLines.length * 5) + 8;

      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }

      // IA
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 150, 60);
      doc.text("IA :", marginLeft, yPos);
      yPos += 7;

      doc.setFont("helvetica", "normal");
      doc.setTextColor(50, 50, 50);
      const aiText = m.loading ? '...' : (m.hasError ? 'Erreur' : m.a);
      const aiLines = doc.splitTextToSize(aiText || '', maxWidth);
      doc.text(aiLines, marginLeft, yPos);
      yPos += (aiLines.length * 5) + 12;

      // Ligne de séparation
      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      } else {
        doc.setDrawColor(200, 200, 200);
        doc.line(marginLeft, yPos - 5, marginLeft + maxWidth, yPos - 5);
        yPos += 5;
      }
    });

    doc.save(`chat_export_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast("Conversation exportée en PDF", "success");
  };

  const copyChat = async () => {
    if (!chat.length) return;
    const text = chat.map(m => `Utilisateur : ${m.q}\nAssistant : ${m.loading ? '...' : (m.hasError ? 'Erreur' : m.a)}\n---`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast("Conversation copiée !", "success");
    } catch (e) {
      showToast("Erreur lors de la copie", "error");
    }
  };

  if (!session) {
    return (
      <div className="App" data-theme={theme}>
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <Login />
      </div>
    );
  }

  const getUserGreeting = () => {
    if (!session || !session.user) return '';
    const hour = new Date().getHours();
    const greeting = hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour';

    const metadata = session.user.user_metadata;
    let name = 'utilisateur';
    if (metadata?.full_name) {
      name = metadata.full_name;
    } else if (metadata?.name) {
      name = metadata.name;
    } else if (metadata?.first_name) {
      name = `${metadata.first_name} ${metadata?.last_name || ''}`.trim();
    } else if (session?.user?.email) {
      name = session.user.email.split('@')[0];
    }

    // Capitalize first letter of name
    if (name && name.length > 0) {
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }

    return `${greeting} ${name} !`;
  };

  return (
    <div className="min-h-screen text-slate-800 dark:text-slate-200 transition-colors duration-300 flex flex-col items-center">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Custom confirmation modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        confirmLabel="Confirmer"
        cancelLabel="Annuler"
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirm}
      />

      {/* Top Left Actions */}
      <div className="fixed top-4 left-4 z-50">
        <button 
          className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-md hover:shadow-lg transition-all"
          onClick={() => setIsSidebarOpen(true)} 
          title="Mes conversations"
        >
          ☰
        </button>
      </div>

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 w-80 bg-white dark:bg-slate-900 shadow-2xl z-[100] transform transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Mes Conversations</h2>
          <button className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setIsSidebarOpen(false)}>✕</button>
        </div>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
           <button className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors" onClick={startNewSession}>+ Nouvelle discussion</button>
        </div>
        <div className="overflow-y-auto p-2" style={{ height: 'calc(100vh - 140px)' }}>
          {sessionsList.length === 0 ? (
            <p className="text-center text-slate-500 mt-8">Aucune conversation passée.</p>
          ) : (
            sessionsList.map(s => (
              <div 
                key={s.id} 
                className={`group flex items-center justify-between p-3 mb-2 rounded-xl cursor-pointer transition-colors ${s.id === sessionId ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'}`} 
                onClick={() => switchSession(s.id)}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <span className="text-xl shrink-0">💬</span>
                  <div className="flex flex-col truncate">
                    <span className="text-sm font-medium truncate">
                      {new Date(s.updatedAt).toLocaleDateString()} à {new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-xs text-slate-500 truncate">Session {s.id.substring(0, 6)}</span>
                  </div>
                </div>
                
                {/* Delete Button (visible on hover) */}
                <button
                  className="p-1.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-all shrink-0"
                  onClick={(e) => {
                    e.stopPropagation(); // Maintient le clic ici et empêche switchSession de se lancer
                    openConfirm({
                      title: 'Supprimer la conversation',
                      message: 'Êtes-vous sûr de vouloir supprimer définitivement cette conversation ? Cette action est irréversible.',
                      variant: 'danger',
                      onConfirm: () => { closeConfirm(); deleteSession(s.id); },
                    });
                  }}
                  title="Supprimer cette conversation"
                >
                  <FcFullTrash size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Overlay when sidebar open */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-40 transition-opacity" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Top Right Actions */}
      <div className="fixed top-4 right-4 flex gap-2 z-50">
        <button
          className="w-11 h-11 flex items-center justify-center bg-white dark:bg-slate-800 rounded-xl shadow-md hover:shadow-lg transition-transform hover:scale-105"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        >
          {theme === 'dark' ? <FcLandscape size={24} /> : <FcNightLandscape size={24} />}
        </button>
        <button
          className="w-11 h-11 flex items-center justify-center bg-white dark:bg-slate-800 rounded-xl shadow-md hover:shadow-lg transition-transform hover:scale-105"
          onClick={() => openConfirm({
            title: 'Se déconnecter',
            message: 'Êtes-vous sûr de vouloir vous déconnecter de votre compte ?',
            variant: 'warning',
            onConfirm: () => { closeConfirm(); supabase.auth.signOut(); },
          })}
          title="Se déconnecter"
        >
          <FcLeave size={24} />
        </button>
      </div>

      {/* Main Content Container */}
      <div className="w-full max-w-6xl mt-16 px-4 flex flex-col items-center gap-6">
        
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h2 className="text-lg font-medium text-slate-500 mb-1">{getUserGreeting()}</h2>
          <h1 className="text-4xl font-extrabold text-slate-800 dark:text-white tracking-tight">Chat avec tes documents</h1>
        </motion.div>

        {/* Upload Section */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-3xl"
        >
          {pdfReady ? (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold m-0">Documents actifs ({indexedDocs.length})</h3>
                <button 
                  type="button" 
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition" 
                  onClick={clearFiles}
                >
                  Changer de documents
                </button>
              </div>
              <ul className="flex flex-col gap-2 m-0 p-0">
                {indexedDocs.map((doc, idx) => (
                  <li key={idx} className="flex flex-row items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
                    <span className="truncate font-medium flex-1 mr-2 flex items-center gap-2">📄 {doc.name}</span>
                    <span className="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full font-semibold whitespace-nowrap">
                      {doc.pages} fragments
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div
                className={`min-h-[160px] p-6 flex flex-col items-center justify-center border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-200 relative
                  ${isDragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 scale-[1.02]' : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:border-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800'}
                  ${files.length ? 'border-solid border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10' : ''}
                `}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,image/jpeg,image/png"
                  multiple
                  className="absolute w-0 h-0 opacity-0"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                
                {files.length ? (
                  <div className="w-full flex flex-col gap-3">
                    <span className="text-4xl mx-auto opacity-90">📄</span>
                    <div className="max-h-32 overflow-y-auto w-full flex flex-col gap-2">
                      {files.map((f) => (
                        <div key={f.name} className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                          <span className="text-sm font-medium truncate">{f.name}</span>
                          <button
                            type="button"
                            className="ml-2 px-2 text-slate-400 hover:text-red-500 transition-colors"
                            onClick={(e) => { e.stopPropagation(); removeFile(f.name); }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center mt-2">
                       <p className="text-sm text-slate-500 m-0">{files.length} fichier(s) · Max 10</p>
                       <button type="button" className="text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:underline" onClick={(e) => { e.stopPropagation(); document.getElementById('file-input').click(); }}>
                        + Ajouter des documents
                       </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="text-5xl mb-3 opacity-90">📁</span>
                    <div className="text-center">
                      <strong className="block text-lg font-medium">Glisse tes documents ou images ici</strong>
                      <span className="text-sm text-slate-500 mt-1 block">ou clique pour parcourir · PDF, DOCX, TXT, MD, CSV, JPG, PNG</span>
                    </div>
                  </>
                )}
              </div>

              {loading && (
                <div className="flex flex-col gap-2">
                  {uploadProgress > 0 ? (
                    <ProgressBar progress={uploadProgress} />
                  ) : (
                    <ProgressBar indeterminate={true} />
                  )}
                  <p className="text-sm text-slate-500 m-0 text-center">{uploadStatus} {uploadProgress > 0 ? `(${uploadProgress}%)` : ''}</p>
                </div>
              )}

              {uploadError && !loading && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex flex-col gap-3">
                  <p className="text-red-600 dark:text-red-400 m-0 text-sm font-medium">{uploadError}</p>
                  <button type="button" className="self-start px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700" onClick={handleUpload}>
                    Réessayer
                  </button>
                </div>
              )}

              {!uploadError && (
                <button
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-lg transition-all shadow-md flex items-center justify-center gap-2"
                  onClick={handleUpload}
                  disabled={loading || !files.length}
                >
                  {loading ? (
                    <>
                      <Spinner size="sm" />
                      <span>Analyse en cours…</span>
                    </>
                  ) : (
                    files.length > 1 ? `Analyser les ${files.length} documents` : "Analyser le document"
                  )}
                </button>
              )}
            </div>
          )}
        </motion.div>

      <div className={`flex w-full gap-4 transition-all duration-300 relative ${selectedSource ? 'h-[600px]' : 'h-[500px]'}`} ref={splitContainerRef}>
        <motion.div 
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-lg overflow-hidden relative" 
          style={{ flex: selectedSource ? `0 0 ${100 - pdfWidth}%` : '1' }}
        >
          {chat.length > 0 && (
            <div className="flex items-center justify-end gap-2 p-3 bg-slate-50 border-b border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 z-10">
              <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition" onClick={copyChat} title="Copier le chat">
                <FcDataBackup size={16} /> <span>Copier</span>
              </button>
              <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition" onClick={exportChatTxt} title="Télécharger TXT">
                <FcDocument size={16} /> <span>TXT</span>
              </button>
              <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition" onClick={exportChatPdf} title="Télécharger PDF">
                <FcFile size={16} /> <span>PDF</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/40 transition"
                onClick={clearChat}
                title="Effacer la conversation en cours"
                aria-label="Effacer la conversation"
              >
                <FcFullTrash size={16} /> <span className="hidden sm:inline">Effacer</span>
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {chat.length === 0 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="m-auto flex flex-col items-center justify-center text-center p-8 max-w-sm"
              >
                {pdfReady ? (
                  <>
                    <span className="text-5xl mb-4 opacity-50">💬</span>
                    <p className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">Pose ta question</p>
                    <p className="text-slate-500 mb-6 font-medium">Tes documents sont prêts. Que veux-tu savoir ?</p>
                    {suggestions.length > 0 && (
                      <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                        <p className="w-full text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">Suggestions</p>
                        {suggestions.map((sugg, i) => (
                          <button key={i} className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-300 rounded-xl text-sm font-medium transition-colors" onClick={() => handleChat(sugg)}>
                            {sugg}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-5xl mb-4 opacity-50">📄</span>
                    <p className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">Aucun document actif</p>
                    <p className="text-slate-500">Ajoute des documents pour commencer une nouvelle analyse.</p>
                  </>
                )}
              </motion.div>
            )}
            <AnimatePresence>
              {chat.map((msg, i) => (
                <React.Fragment key={i}>
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="max-w-[85%] self-end bg-indigo-600 text-white p-4 rounded-2xl rounded-br-sm shadow-sm"
                  >
                    <span className="block text-xs font-bold uppercase tracking-wider text-indigo-200 mb-1">Vous</span>
                    <p className="m-0 text-[0.95rem] leading-relaxed break-words">{msg.q}</p>
                  </motion.div>
                  
                  {msg.loading ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <ChatSkeleton />
                    </motion.div>
                  ) : msg.hasError ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-[85%] self-start bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800 p-4 rounded-2xl rounded-bl-sm"
                    >
                      <span className="block text-xs font-bold uppercase tracking-wider text-red-500 mb-1">Erreur</span>
                      <p className="m-0 text-slate-800 dark:text-slate-200">{msg.errorMsg}</p>
                      <button type="button" className="mt-3 px-3 py-1.5 bg-white border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 dark:bg-slate-800 dark:border-red-800 dark:hover:bg-red-900/30 transition-colors" onClick={() => handleChat(msg.q)}>
                        Réessayer
                      </button>
                    </motion.div>
                  ) : msg.a !== null ? (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="self-start max-w-[85%]">
                      <TypingBubble text={msg.a} sources={msg.sources} animate={i === chat.length - 1 && !msg.isStreaming} onSourceClick={setSelectedSource} />
                    </motion.div>
                  ) : null}
                </React.Fragment>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700">
            <div className="flex gap-3 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all">
              <input
                className="flex-1 bg-transparent border-none outline-none px-4 text-[1rem] text-slate-800 dark:text-slate-200 placeholder-slate-400"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={pdfReady ? "Pose une question sur le document..." : "Analyse un document pour activer le chat"}
                disabled={!pdfReady}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChat();
                  }
                }}
              />
              {loading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="px-6 py-3 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-xl font-bold transition-colors flex items-center gap-2 hover:bg-red-200 dark:hover:bg-red-900/50"
                  title="Stopper la génération"
                >
                  <div className="w-3 h-3 bg-current rounded-sm"></div>
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleChat()}
                  disabled={!pdfReady}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Envoyer
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {selectedSource && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-lg overflow-hidden flex-[0_0_45%]" 
            style={{ flex: `0 0 ${pdfWidth}%` }}
          >
            <div
              className={`absolute left-0 inset-y-0 w-2 cursor-col-resize hover:bg-indigo-400/50 active:bg-indigo-500 z-10 transition-colors ${isResizing ? 'bg-indigo-500' : ''}`}
              onMouseDown={startResizing}
              title="Redimensionner"
            />
            <PdfViewer
              source={selectedSource}
              onClose={() => setSelectedSource(null)}
            />
          </motion.div>
        )}
      </div>
      </div> {/* End main content container */}
    </div>
  );
}

export default App;