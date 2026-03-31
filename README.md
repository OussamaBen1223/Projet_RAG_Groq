# Projet RAG avec Groq, LangChain et Supabase 🚀

Une plateforme métier complète de **RAG (Retrieval-Augmented Generation)** qui permet de discuter intelligemment et en temps réel avec vos documents (PDF, DOCX, TXT, CSV, Images). Le système analyse vos fichiers, "comprend" leur contenu, et utilise une IA experte pour répondre à vos questions en citant ses sources.

![Screenshot de l'application](./assets/Screenshot.png)
![Screenshot de l'application](./assets/Screenshot2.png)
![Screenshot de l'application](./assets/Screenshot3.png)
---

## 🌟 Fonctionnalités Principales

- **Support Multi-Formats** : Lisez du texte depuis des PDF, DOCX, TXT, CSV, ainsi que des images contenant du texte (JPG/PNG grâce à l'OCR intégré).
- **Architecture Asynchrone (Anti-Timeout)** : Les très gros documents sont découpés et vectorisés en arrière-plan grâce à **BullMQ et Redis** pendant que l'utilisateur suit la progression.
- **Précision Extrême (Re-ranking)** : Recherche d'informations hybride utilisant la recherche vectorielle (Supabase) + un filtre d'intelligence sémantique (Cohere Multilingual v3) pour ignorer le bruit.
- **Réponses fluides en Streaming** : Le texte s'affiche mot par mot (Server-Sent Events) comme sur ChatGPT, offrant une expérience utilisateur instantanée.
- **Anti-Hallucination Strict** : Le modèle LLM (Llama 3 via Groq) est contraint par un prompt ciblé de ne répondre qu'en utilisant le contexte, et cite ses sources mathématiquement.
- **Gestion des Sessions & Utilisateurs** : Système d'authentification lié à Supabase Auth, avec conservation de l'historique du chat (Prisma ORM).

---

## 🛠️ Stack Technique Détaillée

### Frontend (Client)
*   **React.js** : Interface utilisateur réactive.
*   **CSS Moderne** : Design UI/UX soigné avec effets "Glassmorphism" et Responsive Design.
*   **Axios & SSE** : Appels API et réception de flux de texte en continu.

### Backend (Serveur)
*   **Node.js & Express** : Serveur principal ultra-rapide et middlewares de sécurité (Rate-Limiting, CORS).
*   **LangChain (JavaScript)** : Orchestration du pipeline RAG, gestion des LLM et Document Loaders.
*   **BullMQ** : File d'attente robuste pour traiter la vectorisation sans bloquer le thread principal.
*   **Tesseract.js** : Moteur OCR pour extraire du texte des fichiers images ou tenter de décoder les PDF scannés.
*   **Prisma ORM** : Pour la base de données relationnelle (historique de chat, métadonnées, sessions).

### IA et Bases de Données (Services Tiers)
*   **Groq (Llama 3 8B/70B)** : Inférence LLM à une vitesse fulgurante.
*   **HuggingFace Embeddings** : Modèle `all-MiniLM-L6-v2` pour créer les vecteurs à moindre coût.
*   **Cohere** : API de Re-ranker pour retrier intelligemment les résultats de vecteur.
*   **Supabase (PostgreSQL + pgvector)** : Stockage des embeddings (vecteurs) pour permettre la recherche sémantique.
*   **Upstash (Redis)** : Hébergement Serverless Redis pour faire fonctionner la file d'attente BullMQ.
*   **Langfuse** : (Optionnel) Observabilité pour surveiller la qualité ou déboguer les prompts LLM.

---

## ⚙️ Comment l'Application Fonctionne (Pipeline RAG)

1. **Ingestion (Upload)** : L'utilisateur envoie son document. Le fichier est placé dans une file d'attente Redis.
2. **Chunking** : Un  "Worker" en arrière-plan découpe le texte en petits morceaux (chunks) de 800 caractères avec un chevauchement (`RecursiveCharacterTextSplitter`).
3. **Embedding** : Chaque morceau est converti en "vecteur mathématique" grâce à HuggingFace.
4. **Stockage** : Ces vecteurs sont sauvegardés dans Supabase (`pgvector`).
5. **Recherche (Retrieval)** : Quand une question est posée, elle est convertie en vecteur pour repêcher les 30 morceaux de documents les plus similaires mathématiquement.
6. **Re-Ranking** : Cohere analyse ces 30 morceaux et ne garde que les 5 extraits qui répondent *véritablement* à la question.
7. **Génération** : Llama-3 (Groq) reçoit la question et les 5 extraits, puis rédige la réponse en direct en affichant l'extrait source.

---

## 🚀 Guide d'Installation (Pour les Testeurs / Développeurs)

Si quelqu'un souhaite tester ou cloner ce projet, voici les étapes à suivre.

### 1. Pré-requis
- **Node.js** (v18 ou supérieur) installé sur votre machine.
- Un projet ouvert sur [Supabase](https://supabase.com).
- Des clés d'API gratuites pour : [Groq](https://console.groq.com), [Cohere](https://dashboard.cohere.com), [HuggingFace](https://huggingface.co/settings/tokens), et optionnellement un [Upstash Redis](https://upstash.com).

### 2. Cloner le repository
```bash
git clone https://github.com/OussamaBen1223/Projet_RAG_Groq.git
cd Projet_RAG_Groq
```

### 3. Configuration du Backend (Serveur)
Ouvrez votre terminal et naviguez dans le dossier serveur :
```bash
cd server
npm install
```

Créez un fichier `.env` dans le dossier `/server` et insérez les clés suivantes :
```ini
# Bases de données & File d'attente
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_ANON_KEY=votre_cle_anon
SUPABASE_DB_URL=postgresql://postgres:password@db.votre-projet.supabase.co:5432/postgres
REDIS_URL=rediss://default:votre_mot_de_passe_upstash

# Clés d'API Intelligence Artificielle
GROQ_API_KEY=votre_cle_groq
COHERE_API_KEY=votre_cle_cohere
HUGGINGFACEHUB_API_TOKEN=votre_cle_huggingface

# Configuration Serveur
CLIENT_ORIGIN=http://localhost:3000
PORT=5000
```

Initialisez la base de données relationnelle via Prisma :
```bash
npx prisma generate
npx prisma db push
```

Démarrez le serveur :
```bash
npm start
```
*(Le serveur tournera sur le port 5000).*

### 4. Configuration du Frontend (Client)
Ouvrez un *nouveau* terminal et naviguez dans le dossier client :
```bash
cd client
npm install
```

Créez un fichier `.env` dans le dossier `/client` (si nécessaire, selon votre configuration React) :
```ini
REACT_APP_API_URL=http://localhost:5000
REACT_APP_SUPABASE_URL=https://votre-projet.supabase.co
REACT_APP_SUPABASE_ANON_KEY=votre_cle_anon
```

Démarrez l'application web :
```bash
npm start
```
*(Le site sera ouvert sur http://localhost:3000).*

---

## 🎯 Comment utiliser l'application ?

1. **Créer un compte** : Vous devez vous inscrire/connecter (géré de manière sécurisée par Supabase Auth).
2. **Ajouter un document** : Utilisez la zone d'upload pour envoyer un ou plusieurs fichiers (Max 10). L'application accepte le texte classique (PDF textuel, DOCX, TXT). *(Note : l'OCR complet pour les PDF scannés nécessite l'installation de bibliothèques C++ locales sur le système de l'hôte).*
3. **Discuter** : Posez votre question dans le chat en bas. Si vous demandez "Qui est l'auteur du document ?", l'IA fouillera, trouvera la réponse, l'affichera immédiatement et générera des encarts de source pour prouver ce qu'elle avance.
4. **Suggestions** : L'IA proposera automatiquement d'autres questions pertinentes à poser en fonction de ce qu'elle vient de lire !

---
*Développé avec ❤️ pour rendre l'analyse de gros documents fluide et accessible.*
