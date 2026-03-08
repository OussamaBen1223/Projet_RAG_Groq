require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");

// FIX : Pour les versions de Node < 18 qui ne connaissent pas 'Blob'
if (typeof Blob === "undefined") {
  const { Blob } = require("buffer");
  global.Blob = Blob;
}

const { ChatGroq } = require("@langchain/groq");
const { CohereClient } = require("cohere-ai");
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});
const { HuggingFaceInferenceEmbeddings } = require("@langchain/community/embeddings/hf");
const { PGVectorStore } = require("@langchain/community/vectorstores/pgvector");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { DocxLoader } = require("@langchain/community/document_loaders/fs/docx");
const { TextLoader } = require("langchain/document_loaders/fs/text");
const { loadQAChain } = require("langchain/chains");
const { PromptTemplate } = require("@langchain/core/prompts");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { CallbackHandler } = require("langfuse-langchain");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const connectionString = process.env.SUPABASE_DB_URL ? `${process.env.SUPABASE_DB_URL}?pgbouncer=true` : undefined;
const pool = connectionString ? new Pool({ connectionString }) : null;
const adapter = pool ? new PrismaPg(pool) : null;
const prisma = adapter ? new PrismaClient({ adapter }) : new PrismaClient();

const app = express();

// --- CONFIGURATION BULLMQ & REDIS ---
const redisConnection = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: { rejectUnauthorized: false } // Requis pour Upstash Redis Serverless
}) : null;

const uploadQueue = redisConnection ? new Queue('PdfUploadQueue', { connection: redisConnection }) : null;

// --- WORKER BULLMQ (TRAITEMENT BACKGROUND) ---
if (redisConnection) {
  const worker = new Worker('PdfUploadQueue', async (job) => {
    console.log(`🚀 [Worker] Démarrage du Traitement PDF pour la session ${job.data.sessionId} (Job: ${job.id})...`);
    await job.updateProgress(10);

    const { files, sessionId } = job.data;
    const allDocs = [];
    const loadErrors = [];
    const indexedDocsStats = [];

    // 1. Lecture et Split des fichiers
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const filename = file.originalname || "document.unknown";
        const ext = path.extname(filename).toLowerCase();
        let loader;

        if (ext === ".pdf") {
          loader = new PDFLoader(file.path);
        } else if (ext === ".docx") {
          loader = new DocxLoader(file.path);
        } else if (ext === ".txt" || ext === ".md" || ext === ".csv") {
          loader = new TextLoader(file.path);
        } else {
          throw new Error(`Format non supporté : ${ext}`);
        }

        const docs = await loader.load();
        // ✅ FIX EBUSY : on supprime le fichier APRÈS loader.load() pour éviter
        // le "resource busy or locked" sous Windows (le loader garde un handle ouvert)
        if (fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (unlinkErr) {
            console.warn(`⚠️ [Worker] Impossible de supprimer ${file.path}:`, unlinkErr.message);
          }
        }

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 800,
          chunkOverlap: 150,
        });
        const splitDocs = await splitter.splitDocuments(docs);

        const isUsefulChunk = (text) => {
          const trimmed = text.trim();
          if (trimmed.length < 150) return false;
          const lines = trimmed.split('\n');
          const urlLines = lines.filter(l => l.trim().match(/^https?:\/\//i)).length;
          if (urlLines / lines.length > 0.5) return false;
          return true;
        };

        const filteredDocs = splitDocs.filter(doc => isUsefulChunk(doc.pageContent));
        const count = filteredDocs.length;
        console.log(`🔬 [Worker] ${filename}: ${splitDocs.length} blocs → ${count} conservés`);

        filteredDocs.forEach((doc) => {
          doc.metadata = { ...doc.metadata, source: filename, sessionId };
        });
        allDocs.push(...filteredDocs);
        indexedDocsStats.push({ name: filename, pages: docs.length });
      } catch (fileErr) {
        const msg = file.originalname + " : " + (fileErr.message || String(fileErr));
        loadErrors.push(msg);
        console.error("⚠️ [Worker] Erreur lecture fichier:", msg);
        // Nettoyage disque même en cas d'erreur
        if (fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (_) { }
        }
      }

      // Update la barre de progression artificielle (selon nb de fichiers analysés)
      await job.updateProgress(10 + Math.floor(((i + 1) / files.length) * 30));
    }

    if (allDocs.length === 0) {
      throw new Error(loadErrors.length ? "Aucun document n'a pu être lu. " + loadErrors.join(" | ") : "Aucun contenu extrait des documents.");
    }

    await job.updateProgress(50); // Lecture terminée, passage vecteur

    // 2. Vectorisation (Supabase)
    const store = await getVectorStore();
    if (!store) throw new Error("Base de données Supabase inatteignable.");

    try {
      console.log(`🗑️ [Worker] Suppression des anciens vecteurs (session=${sessionId})...`);
      await store.pool.query(
        `DELETE FROM "${store.tableName}" WHERE metadata->>'sessionId' = $1`,
        [sessionId]
      );
    } catch (err) {
      console.warn("⚠️ [Worker] DELETE échoué. Tentative de TRUNCATE...", err.message);
      try {
        await store.pool.query(`TRUNCATE TABLE "${store.tableName}"`);
      } catch (err2) {
        console.error("❌ [Worker] TRUNCATE échoué.", err2.message);
      }
    }

    await job.updateProgress(70);

    let retry = true;
    let attempts = 0;
    while (retry && attempts < 3) {
      try {
        await store.addDocuments(allDocs);
        console.log("✅ [Worker] Vecteurs injectés !");
        retry = false;
      } catch (err) {
        if (err.message && err.message.includes("loading")) {
          attempts++;
          console.log(`⚠️ [Worker] Hugging Face charge le modèle... Essai ${attempts}/3`);
          await new Promise((resolve) => setTimeout(resolve, 10000));
        } else {
          throw err;
        }
      }
    }

    await job.updateProgress(90);

    // 3. Modèles SQL relationnels (Prisma)
    try {
      await prisma.session.upsert({
        where: { id: sessionId },
        create: { id: sessionId },
        update: {},
      });

      await prisma.document.deleteMany({
        where: { sessionId: sessionId },
      });

      const docEntries = indexedDocsStats.map(stat => ({
        fileName: stat.name,
        pageCount: stat.pages,
        sessionId: sessionId,
      }));
      await prisma.document.createMany({
        data: docEntries,
      });
      console.log(`📦 [Worker] Prisma : Stats enregistrées.`);
    } catch (dbErr) {
      console.error("❌ [Worker] Prisma erreur :", dbErr);
    }

    await job.updateProgress(100);
    return { indexedDocs: indexedDocsStats, count: files.length };

  }, { connection: redisConnection });

  worker.on('completed', job => {
    console.log(`🟢 [Worker] Job ${job.id} est TERMINÉ.`);
  });

  worker.on('failed', (job, err) => {
    console.log(`🔴 [Worker] Job ${job.id} a ÉCHOUÉ avec l'erreur : ${err.message}`);
  });
}

// --- SÉCURITÉ & ROBUSTESSE ---
// Trust proxy si derrière un reverse proxy HTTPS en prod (ex: NGINX, Heroku)
app.set('trust proxy', 1);

// CORS Cohérents : restriction de l'origine
const allowedOrigins = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : ["http://localhost:3000", "http://localhost:3001"];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Limitation Globale du trafic API (Toutes les routes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Autorise 200 requêtes pour toutes les routes confondues par IP
  message: { error: "Trop de requêtes, veuillez patienter." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Limite spécifique pour le Chat & Suggestion (Eviter un abus de l'API externe LLM)
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Autorise 30 messages par minute
  message: { error: "Veuillez ralentir, la limite de fréquence de messages a été atteinte." },
});

// Limite spécifique pour l'Upload (Eviter les spams de gros fichiers)
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads max par IP par 15 minutes
  message: { error: "Limite de téléchargements atteinte. Veuillez réessayer plus tard." },
});

// S'assurer que le dossier uploads existe (évite erreur multer/PDFLoader)
const uploadsDir = "uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("📁 Dossier uploads/ créé.");
}
const upload = multer({
  dest: uploadsDir + "/",
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo limit
  fileFilter: (req, file, cb) => {
    // Validation stricte du type MIME
    const allowedMimeTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
      "text/plain",
      "text/markdown",
      "text/csv"
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Format de fichier non autorisé. Seuls les PDF, DOCX, TXT, MD, et CSV sont acceptés."), false);
    }
  }
});
// Initialisation des modèles
const model = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  // Remplacement temporaire du modèle (limite de tokens atteinte pour le 70b)
  model: "llama-3.1-8b-instant",
  streaming: true,
});
const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,
  model: "sentence-transformers/all-MiniLM-L6-v2",
});

// Config Postgres (Supabase) — utilise SUPABASE_DB_URL dans .env
// Si le mot de passe contient / ou #, les encoder en %2F et %23
const pgConfig = {
  postgresConnectionOptions: {
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: process.env.SUPABASE_DB_URL ? { rejectUnauthorized: false } : false,
  },
  tableName: "pdf_embeddings",
};

let vectorStore = null;

async function getVectorStore() {
  if (!process.env.SUPABASE_DB_URL) return null;
  if (vectorStore && vectorStore.pool) return vectorStore;
  if (vectorStore) return null;
  try {
    vectorStore = await PGVectorStore.initialize(embeddings, pgConfig);
    console.log("📦 Connexion au vector store Supabase (pgvector) OK.");
    return vectorStore;
  } catch (err) {
    const msg = err?.message ?? "";
    if (msg.includes("getaddrinfo") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
      console.warn("⚠️ Supabase injoignable (réseau/DNS). Utilisation du stockage en mémoire.");
      return null;
    }
    throw err;
  }
}
const uploadMiddleware = upload.array("files", 10);

app.post("/upload", uploadLimiter, (req, res, next) => {
  uploadMiddleware(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Un ou plusieurs fichiers dépassent la taille maximale autorisée (25 Mo)." });
      }
      return res.status(400).json({ error: "Erreur d'upload : " + err.message });
    } else if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  // Optionnel : Augmenter le timeout côté serveur (5 min) pour le traitement des gros PDFs
  res.setTimeout(300000);

  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) {
    return res.status(400).json({ error: "Aucun fichier fourni" });
  }

  try {
    console.log("--- 📥 Fichiers reçus :", files.map((f) => f.originalname).join(", "));
    const sessionId = req.body.sessionId || "default_session";

    // Si Redis n'est pas configuré, on fait un fallback synchrone basique (pour éviter de casser le code de l'utilisateur s'il a oublié Upstash)
    if (!uploadQueue) {
      console.error("⚠️ Redis URL non configurée ! Mode synchrone dégradé actif. Cela peut bloquer le serveur sur les gros fichiers.");
      return res.status(500).json({ error: "La file d'attente Redis / BullMQ n'est pas configurée. Le traitement de gros documents nécessite l'URL REDIS_URL dans .env." });
    }

    // On prépare les fichiers pour le Worker (il lui faut le chemin absolu sur disque)
    const fileJobs = files.map(f => ({
      originalname: f.originalname,
      path: f.path,
      mimetype: f.mimetype
    }));

    // Ajout à la file d'attente Asynchrone
    const job = await uploadQueue.add('ProcessPdfJob', {
      files: fileJobs,
      sessionId: sessionId
    }, {
      // ✅ FIX 404 /queue : garder les jobs 5 min après completion pour que
      // le frontend puisse les lire via polling (était true = supprimé immédiatement)
      removeOnComplete: { count: 10, age: 5 * 60 },
      removeOnFail: { count: 20, age: 24 * 60 * 60 }
    });

    console.log(`✅ [BullMQ] Job ${job.id} ajouté à la file d'attente pour la session ${sessionId}.`);

    // On répond IMMÉDIATEMENT au client avec l'ID du job.
    // Le vrai calcul long (chunking + LLM Embeddings) continue dans le vide en arrière-plan.
    res.status(202).json({
      message: "Les documents ont été ajoutés à la file d'attente et sont en cours de traitement.",
      jobId: job.id,
      status: "queued"
    });

  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error("❌ ERREUR /upload:", msg);
    res.status(500).json({ error: msg });
  }
});

// --- ROUTE POUR SUIVRE LA PROGRESSION DE L'UPLOAD ---
app.get("/queue/:jobId", async (req, res) => {
  if (!uploadQueue) {
    return res.status(500).json({ error: "File d'attente non configurée." });
  }

  try {
    const job = await uploadQueue.getJob(req.params.jobId);

    if (!job) {
      return res.status(404).json({ error: "Job introuvable." });
    }

    const state = await job.getState();
    const progress = job.progress;
    const reason = job.failedReason;
    const result = job.returnvalue;

    res.json({
      id: job.id,
      state: state, // 'waiting', 'active', 'completed', 'failed', 'delayed'
      progress: progress,
      reason: reason,
      result: result
    });

  } catch (error) {
    console.error("❌ Erreur /queue/:jobId:", error);
    res.status(500).json({ error: "Erreur lors de la vérification du job." });
  }
});

app.post("/chat", chatLimiter, async (req, res) => {
  // Timeout serveur temporaire augmenté pour le chat (2 min)
  res.setTimeout(120000);
  try {
    const { question, sessionId = "default_session" } = req.body;
    const store = vectorStore || (await getVectorStore());
    if (!store) {
      return res.status(400).json({ error: "Upload un PDF d'abord" });
    }

    // On récupère un large ensemble de candidats pour filtrer ensuite par sessionId
    let docs;
    try {
      docs = await store.similaritySearch(question, 30);
    } catch (err) {
      console.error("❌ Erreur lors de la recherche de similarité.", err.message);
      return res.status(500).json({ error: "Erreur interne du serveur lors de la recherche." });
    }

    // --- FILTRAGE PAR SESSIONID (critique pour le changement de PDF) ---
    // On isole explicitement les documents de la session courante.
    // Cela évite que l'IA utilise des extraits d'anciens PDF uploadés dans la même session Supabase.
    const sessionDocs = docs.filter(doc => doc.metadata?.sessionId === sessionId);
    if (sessionDocs.length > 0) {
      docs = sessionDocs;
      console.log(`✅ ${docs.length} chunks trouvés pour la session ${sessionId}`);
    } else {
      // Fallback si aucun doc pour la session (ex: sessionId absent des métadonnées)
      console.warn("⚠️ Aucun doc avec sessionId correspondant, utilisation de tous les résultats...");
    }

    if (!docs || docs.length === 0) {
      return res.status(400).json({ error: "Upload un PDF d'abord ou pose une question liée au document." });
    }

    // --- COHERE RE-RANKING (Intelligent Semantic Sort) ---
    try {
      if (process.env.COHERE_API_KEY) {
        // Préparer les documents pour Cohere (il s'attend à un tableau de strings ou d'objets avec une clé 'text')
        const cohereDocs = docs.map(d => ({ text: d.pageContent }));

        console.log(`🧠 [Re-Ranker] Envoi de ${cohereDocs.length} fragments à Cohere pour tri intelligent...`);
        const reranked = await cohere.v2.rerank({
          model: 'rerank-multilingual-v3.0',
          query: question,
          documents: cohereDocs,
          topN: 5 // On ne garde que les 5 meilleurs pour Groq
        });

        // Reconstruire le tableau de documents originaux (Langchain Document) à partir de l'ordre Cohere
        docs = reranked.results.map(result => {
          console.log(`   - Index ${result.index} | Score de pertinence: ${(result.relevanceScore * 100).toFixed(1)}%`);
          return docs[result.index];
        });
        console.log("✅ [Re-Ranker] Tri terminé avec succès !");
      } else {
        console.warn("⚠️ Clé COHERE_API_KEY manquante, fallback vers le top 5 du tri vectoriel pur.");
        docs = docs.slice(0, 5);
      }
    } catch (rerankError) {
      console.error("❌ Erreur de Re-ranking Cohere:", rerankError.message);
      console.log("⚠️ Fallback d'urgence vers le top 5 vectoriel.");
      docs = docs.slice(0, 5);
    }

    // Lecture du Prompt Anti-Hallucination depuis le fichier externe
    let template;
    try {
      template = fs.readFileSync(path.join(__dirname, "prompt.txt"), "utf-8");
    } catch (err) {
      console.error("Impossible de lire prompt.txt. Fallback vers le système par défaut.");
      template = `Tu es un assistant strict spécialisé dans l'analyse de documents.
Règle N°1 : Tu DOIS répondre à la question en utilisant EXCLUSIVEMENT les informations fournies dans le texte {context}.
Règle N°2 : Si la réponse à la question ne se trouve PAS explicitement dans le {context}, tu ne DOIS PAS essayer de deviner ni utiliser tes connaissances. Tu dois répondre EXACTEMENT par cette phrase et rien d'autre : "Je ne trouve pas cette information dans le document."
Règle N°3 : Le texte fourni est divisé en blocs numérotés (ex: [1], [2], etc.). Quand tu utilises une information d'un bloc, tu DOIS inclure son numéro à la fin de la phrase sous cette forme : "Le ciel est bleu [1]."

Texte fourni :
{context}

Question de l'utilisateur :
{question}

Ta réponse (et souviens-toi de la Règle N°2) :`;
    }

    const QA_PROMPT = new PromptTemplate({
      template,
      inputVariables: ["context", "question"],
    });

    // Préparation SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Extraits sources avec numéro de page et nom du fichier
    const sources = docs.map((doc, index) => ({
      id: index + 1,
      content: doc.pageContent?.trim().slice(0, 300) + (doc.pageContent?.length > 300 ? "…" : ""),
      page: doc.metadata?.loc?.pageNumber ?? doc.metadata?.pdf?.page ?? null,
      source: doc.metadata?.source ?? null,
    }));

    // Envoi des sources en premier (on limite max 800 chars en affichage)
    res.write(`data: ${JSON.stringify({ type: 'sources', data: sources })}\n\n`);

    // On passe le chunking complet car les textes font déjà 800 caractères max chacun depuis l'upload
    const context = docs.map((doc, index) => `[${index + 1}] ${doc.pageContent}`).join("\n\n");
    console.log("=== CONTEXT ENVOYÉ À L'IA ===");
    console.log(context);
    console.log("=============================");

    const formattedPrompt = await QA_PROMPT.format({
      context,
      question
    });

    // --- INTEGRATION LANGFUSE ---
    let callbacks = [];
    let langfuseHandler = null;

    // On ne l'active que si les clés sont fournies dans le .env
    if (process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY) {
      langfuseHandler = new CallbackHandler({
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
        sessionId: sessionId,
      });
      callbacks.push(langfuseHandler);
    }

    // Écoute de la déconnexion client (Stop Génération)
    const abortController = new AbortController();
    req.on("close", () => {
      console.log(`🛑 [Session ${sessionId}] Connexion interrompue par le client. Arrêt de Groq.`);
      abortController.abort();
    });

    let fullResponse = ""; // Accumuler la réponse pour la sauvegarder dans la DB
    try {
      // Le callback va intercepter le début et la fin de l'appel LLM
      const stream = await model.stream(formattedPrompt, {
        callbacks: callbacks,
        signal: abortController.signal
      });

      for await (const chunk of stream) {
        // Langchain ChatGroq returns chunk.content as string, but sometimes chunk is just a string
        const content = typeof chunk === "string" ? chunk : (chunk?.content || chunk?.text || "");
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ type: 'token', data: content })}\n\n`);
        }
      }
    } catch (streamErr) {
      if (streamErr.name === 'AbortError' || streamErr.message.includes('abort') || streamErr.message.includes('cancel')) {
        console.log(`⚠️  Génération LLM avortée proprement.`);
        fullResponse += "\n\n[Génération Interrompue]";
      } else {
        console.error("❌ Erreur pendant le stream Groq:", streamErr.message);
        throw streamErr; // propagé pour déclencher la fermeture avec erreur
      }
    }

    // On s'assure que la trace est bien envoyée au serveur Langfuse (processus asynchrone)
    if (langfuseHandler) {
      await langfuseHandler.flushAsync();
    }

    res.write(`data: [DONE]\n\n`);
    res.end();

    // --- INTEGRATION PRISMA : Historique de Chat ---
    try {
      await prisma.message.createMany({
        data: [
          { role: "user", content: question, sessionId: sessionId },
          { role: "assistant", content: fullResponse, sources: sources, sessionId: sessionId }
        ]
      });
      console.log(`📦 Prisma : Message User + Assistant sauvegardé (session: ${sessionId})`);
    } catch (dbErr) {
      console.error("❌ Prisma : Erreur lors de la sauvegarde du Tchat:", dbErr);
    }

  } catch (e) {
    console.error("❌ Erreur /chat :", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', data: e.message })}\n\n`);
      res.end();
    }
  }
});

// Route pour effacer l'historique d'une session
app.delete("/history/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  try {
    // Supprimer tous les messages liés à cette session
    await prisma.message.deleteMany({
      where: { sessionId: sessionId },
    });
    console.log(`🗑️  Historique effacé côté serveur pour la session ${sessionId}`);
    res.json({ success: true, message: "Historique supprimé avec succès." });
  } catch (err) {
    console.error(`❌ Erreur lors de la suppression de l'historique de la session ${sessionId} :`, err);
    res.status(500).json({ error: "Erreur lors de la suppression de l'historique depuis le serveur." });
  }
});

app.post("/suggest", chatLimiter, async (req, res) => {
  try {
    const { sessionId = "default_session" } = req.body;
    const store = vectorStore || (await getVectorStore());
    if (!store) return res.json({ suggestions: [] });

    // Recherche de contexte générique
    let docs;
    try {
      docs = await store.similaritySearch("introduction résumé contexte principal", 3, { sessionId });
    } catch (err) {
      docs = await store.similaritySearch("introduction résumé contexte principal", 3);
    }
    if (!docs || docs.length === 0) return res.json({ suggestions: [] });

    const context = docs.map((doc) => doc.pageContent).join("\n").substring(0, 3000);

    const SUGGEST_PROMPT = new PromptTemplate({
      template: `Tu es un expert en analyse de documents.
Voici un extrait d'un document :
{context}

Propose exactement 3 questions pertinentes, concises et intéressantes (une phrase courte par question) qu'un utilisateur pourrait poser pour mieux comprendre ce document. Mieux vaut des questions précises sur le contenu.
Ne fournis que les 3 questions, sans numétration, une par ligne, sans introduction ni conclusion.`,
      inputVariables: ["context"],
    });

    const formattedPrompt = await SUGGEST_PROMPT.format({ context });
    const response = await model.invoke(formattedPrompt);
    const textResp = typeof response === "string" ? response : (response?.content || response?.text || "");

    const suggestions = textResp
      .split('\n')
      .map(line => line.trim().replace(/^-[ \t]*/, "").replace(/^[0-9]+[.)][ \t]*/, ""))
      .filter(line => line.length > 10 && line.endsWith("?"))
      .slice(0, 3);

    res.json({ suggestions });
  } catch (e) {
    console.error("❌ Erreur /suggest:", e);
    res.status(500).json({ error: "Erreur lors de la génération des suggestions." });
  }
});

// --- ROUTE POUR RECUPERER L'HISTORIQUE ---
app.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Récupèration des messages triés chronologiquement
    const messages = await prisma.message.findMany({
      where: { sessionId: sessionId },
      orderBy: { createdAt: 'asc' }
    });

    // Récupération des documents actifs de cette session
    const documents = await prisma.document.findMany({
      where: { sessionId: sessionId },
      orderBy: { createdAt: 'asc' }
    });

    // On reformate les messages pour matcher le state Frontend ({ text, sender, sources })
    const formattedMessages = messages.map(msg => ({
      text: msg.content,
      sender: msg.role === 'user' ? 'user' : 'bot',
      sources: msg.sources || []
    }));

    res.json({
      messages: formattedMessages,
      documents: documents.map(d => ({ name: d.fileName, pages: d.pageCount }))
    });
  } catch (e) {
    console.error("❌ Erreur lecture historique:", e);
    res.status(500).json({ error: "Impossible de lire l'historique." });
  }
});

const cron = require('node-cron');

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});

// --- CRON JOB: Nettoyage automatique des sessions inactives ---
// S'exécute tous les jours à minuit (0 0 * * *)
cron.schedule('0 0 * * *', async () => {
  console.log("🧹 [Cron] Début du nettoyage des vieilles sessions...");
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. Trouver les sessions inactives
    const oldSessions = await prisma.session.findMany({
      where: { updatedAt: { lt: sevenDaysAgo } },
      select: { id: true }
    });

    if (oldSessions.length === 0) {
      console.log("🟢 [Cron] Aucune session inactive à supprimer.");
      return;
    }

    const sessionIds = oldSessions.map(s => s.id);
    console.log(`🗑️ [Cron] ${sessionIds.length} sessions inactives détectées. Suppression en cours...`);

    // 2. Supprimer les embeddings directement dans PgVector
    const store = vectorStore || (await getVectorStore());
    if (store) {
      try {
        await store.pool.query(
          `DELETE FROM "${store.tableName}" WHERE metadata->>'sessionId' = ANY($1::text[])`,
          [sessionIds]
        );
        console.log(`✅ [Cron] Vecteurs supprimés.`)
      } catch (vecErr) {
        console.error("❌ [Cron] Erreur lors de la suppression des vecteurs:", vecErr.message);
      }
    }

    // 3. Supprimer les sessions de Prisma (Cascade supprime Messages et Documents)
    const result = await prisma.session.deleteMany({
      where: { id: { in: sessionIds } }
    });
    console.log(`✅ [Cron] ${result.count} sessions supprimées avec succès de PostgreSQL.`);

  } catch (error) {
    console.error("❌ [Cron] Erreur globale lors du nettoyage:", error);
  }
});