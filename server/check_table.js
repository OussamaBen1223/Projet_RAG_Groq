require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixTable() {
    try {
        // Supprimer la table pour que LangChain PGVectorStore.initialize() la recree
        console.log('🗑️ Suppression de la table pdf_embeddings...');
        await p.query('DROP TABLE IF EXISTS "pdf_embeddings" CASCADE');
        console.log('✅ Table supprimée. PGVectorStore la recreera automatiquement au prochain démarrage du serveur.');
    } catch (err) {
        console.error('❌ Erreur:', err.message);
    } finally {
        await p.end();
    }
}

fixTable();
