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
        delete axios.defaults.headers.common['Authorization'];
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
        "text/csv"
      ];
      const validExtensions = [".pdf", ".docx", ".txt", ".md", ".csv"];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      return validTypes.includes(file.type) || validExtensions.includes(ext) || file.type.startsWith("text/");
    };

    const valid = Array.from(selectedFiles).filter(isValidFile);
    const invalid = selectedFiles.length - valid.length;
    if (invalid > 0) showToast(`${invalid} fichier(s) ignoré(s) - formats acceptés: PDF, DOCX, TXT, MD, CSV.`, "error");
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

  const clearChat = async () => {
    if (window.confirm("Es-tu sûr de vouloir effacer tout l'historique de cette conversation ?")) {
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
    }
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

  return (
    <div className="App">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="top-actions-left">
        <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(true)} title="Mes conversations">
          ☰
        </button>
      </div>

      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Mes Conversations</h2>
          <button className="close-sidebar" onClick={() => setIsSidebarOpen(false)}>✕</button>
        </div>
        <button className="new-chat-btn" onClick={startNewSession}>+ Nouvelle discussion</button>
        <div className="sidebar-content">
          {sessionsList.length === 0 ? (
            <p className="no-sessions">Aucune conversation passée.</p>
          ) : (
            sessionsList.map(s => (
              <div key={s.id} className={`sidebar-item ${s.id === sessionId ? 'active' : ''}`} onClick={() => switchSession(s.id)}>
                <span className="sidebar-item-icon">💬</span>
                <div className="sidebar-item-text">
                  <span className="sidebar-item-date">{new Date(s.updatedAt).toLocaleDateString()} à {new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="sidebar-item-id">Session {s.id.substring(0, 6)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="top-actions">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          className="logout-btn"
          onClick={() => supabase.auth.signOut()}
          title="Se déconnecter"
        >
          🚪
        </button>
      </div>

      <h1 className="app-title transition-fade">Chat avec tes documents</h1>

      <div className="upload-section transition-slide">
        {pdfReady ? (
          <div className="active-docs-indicator transition-fade">
            <div className="active-docs-header">
              <h3>Documents actifs ({indexedDocs.length})</h3>
              <button type="button" className="change-docs-btn" onClick={clearFiles} title="Analyser de nouveaux documents">
                Changer de documents
              </button>
            </div>
            <ul className="active-docs-list">
              {indexedDocs.map((doc, idx) => (
                <li key={idx} className="active-doc-item">
                  <span className="doc-name">📄 {doc.name}</span>
                  <span className="doc-badge">{doc.pages} fragments</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div
              className={`dropzone ${isDragging ? 'dropzone-active' : ''} ${files.length ? 'dropzone-has-file' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input').click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
                multiple
                className="dropzone-input"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {files.length ? (
                <div className="dropzone-files">
                  <span className="dropzone-icon">📄</span>
                  <div className="dropzone-file-list">
                    {files.map((f) => (
                      <div key={f.name} className="dropzone-file">
                        <span className="dropzone-filename">{f.name}</span>
                        <button
                          type="button"
                          className="dropzone-remove"
                          onClick={(e) => { e.stopPropagation(); removeFile(f.name); }}
                          aria-label={`Retirer ${f.name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="dropzone-hint">{files.length} fichier(s) · Max 10</p>
                  <button type="button" className="dropzone-add" onClick={(e) => { e.stopPropagation(); document.getElementById('file-input').click(); }}>
                    + Ajouter des documents
                  </button>
                </div>
              ) : (
                <>
                  <span className="dropzone-icon">📁</span>
                  <p className="dropzone-text">
                    <strong>Glisse tes documents ici</strong>
                    <span>ou clique pour parcourir · PDF, DOCX, TXT, MD, CSV</span>
                  </p>
                </>
              )}
            </div>
            {loading && (
              <div className="upload-progress">
                {uploadProgress > 0 ? (
                  <ProgressBar progress={uploadProgress} />
                ) : (
                  <ProgressBar indeterminate={true} />
                )}
                <p className="upload-status">{uploadStatus} {uploadProgress > 0 ? `(${uploadProgress}%)` : ''}</p>
              </div>
            )}
            {uploadError && !loading && (
              <div className="upload-error">
                <p>{uploadError}</p>
                <button type="button" className="retry-btn" onClick={handleUpload}>
                  Réessayer
                </button>
              </div>
            )}
            {!uploadError && (
              <button
                className="upload-btn"
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
          </>
        )}
      </div>

      <div className={`split-view-container ${selectedSource ? 'split-active' : ''}`} ref={splitContainerRef}>
        <div className="chat-section transition-slide" style={{ flex: selectedSource ? `0 0 ${100 - pdfWidth}%` : '1' }}>
          {chat.length > 0 && (
            <div className="chat-actions">
              <button type="button" className="export-chat-btn" onClick={copyChat} title="Copier le chat">
                📋 <span>Copier</span>
              </button>
              <button type="button" className="export-chat-btn" onClick={exportChatTxt} title="Télécharger TXT">
                📄 <span>TXT</span>
              </button>
              <button type="button" className="export-chat-btn" onClick={exportChatPdf} title="Télécharger PDF">
                💾 <span>PDF</span>
              </button>
              <button
                type="button"
                className="clear-chat-btn"
                onClick={clearChat}
                title="Effacer la conversation en cours"
                aria-label="Effacer la conversation"
              >
                🗑️ <span>Effacer l'historique</span>
              </button>
            </div>
          )}
          <div className={`messages ${chat.length === 0 ? 'messages-empty' : ''}`} data-state={pdfReady ? 'ready' : 'waiting'}>
            {chat.length === 0 && (
              <div className="empty-state">
                {pdfReady ? (
                  <>
                    <span className="empty-state-icon">💬</span>
                    <p className="empty-state-title">Pose ta première question</p>
                    <p className="empty-state-desc">Ton document est prêt. Interroge-le sur son contenu.</p>
                    {suggestions.length > 0 && (
                      <div className="suggestions-container">
                        <p className="suggestions-title">Suggestions de questions :</p>
                        {suggestions.map((sugg, i) => (
                          <button key={i} className="suggestion-chip" onClick={() => handleChat(sugg)}>
                            {sugg}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <span className="empty-state-icon">📄</span>
                    <p className="empty-state-title">Aucun document analysé</p>
                    <p className="empty-state-desc">Glisse un ou plusieurs documents ci-dessus et clique sur « Analyser » pour commencer.</p>
                  </>
                )}
              </div>
            )}
            {chat.map((msg, i) => (
              <React.Fragment key={i}>
                <div className="bubble bubble-user transition-bubble">
                  <span className="bubble-label">Vous</span>
                  <p>{msg.q}</p>
                </div>
                {msg.loading ? (
                  <ChatSkeleton />
                ) : msg.hasError ? (
                  <div className="bubble bubble-ai bubble-error transition-bubble">
                    <span className="bubble-label">Erreur</span>
                    <p>{msg.errorMsg}</p>
                    <button type="button" className="retry-btn" onClick={() => handleChat(msg.q)}>
                      Réessayer
                    </button>
                  </div>
                ) : msg.a !== null ? (
                  <TypingBubble
                    text={msg.a}
                    sources={msg.sources}
                    animate={i === chat.length - 1 && !msg.isStreaming}
                    onSourceClick={setSelectedSource}
                  />
                ) : null}
              </React.Fragment>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-row">
            <input
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
                className="stop-btn"
                title="Stopper la génération"
              >
                <div className="stop-icon"></div>
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleChat()}
                disabled={!pdfReady}
              >
                Envoyer
              </button>
            )}
          </div>
        </div>

        {selectedSource && (
          <div className="pdf-section transition-slide" style={{ flex: `0 0 ${pdfWidth}%` }}>
            <div
              className={`pdf-resizer ${isResizing ? 'is-resizing' : ''}`}
              onMouseDown={startResizing}
              title="Redimensionner"
            ></div>
            <PdfViewer
              source={selectedSource}
              onClose={() => setSelectedSource(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;