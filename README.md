# Projet RAG Groq 🚀 - Platforme d'Analyse Documentaire IA

Une plateforme professionnelle de RAG (Retrieval-Augmented Generation) permettant de discuter avec des documents PDF, DOCX et TXT en temps réel avec des performances optimisées.

## 🌟 Points Forts Techniques
- **Architecture Scalable** : Utilisation de **BullMQ + Redis** pour le traitement asynchrone des documents.
- **RAG de Haute Précision** : Recherche hybride combinant **pgvector** (Supabase) et un **Re-ranker sémantique** (Cohere Multilingual v3).
- **Streaming & UX** : Interface React avec streaming de réponses (SSE) et rendu Markdown intégral.
- **Sécurité et Contrôle** : Gestion de l'annulation des requêtes LLM via **AbortController** pour optimiser les coûts d'API.

## 🛠️ Stack Technologique
- **Frontend** : React, CSS3 (Glassmorphism), Axios.
- **Backend** : Node.js (Express), LangChain.
- **Intelligence Artificielle** : Groq (Llama 3), Cohere AI.
- **Base de données** : PostgreSQL avec extension Vector (via Supabase), Prisma ORM.

---
*Projet développé dans une optique de robustesse et de pertinence sémantique.*
