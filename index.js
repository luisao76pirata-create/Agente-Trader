import { AgentRuntime, elizaLogger, ModelProviderName, stringToUuid, settings } from "@elizaos/core";
import { SqliteDatabaseAdapter } from "@elizaos/adapter-sqlite";
import { TelegramClientInterface } from "@elizaos/client-telegram";
import { solanaPlugin } from "@elizaos/plugin-solana";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// 1. Configuración de la Base de Datos (Para que el agente tenga memoria)
const dbPath = path.join(process.cwd(), "data", "db.sqlite");
if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
const dbAdapter = new SqliteDatabaseAdapter(new Database(dbPath));

// 2. Carga del Personaje (ADN del agente)
const character = {
    name: "Alpha-Centauri-01",
    modelProvider: ModelProviderName.OPENAI,
    settings: {
        secrets: {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
            SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY,
        },
    },
    system: "Eres un agente financiero experto en Solana. Operas en modo simulación (DRY_RUN) para maximizar beneficios con riesgo mínimo.",
    bio: ["Analista de DeFAI", "Experto en arbitraje", "Cazador de tendencias en X"],
    adjectives: ["Analítico", "Preciso", "Seguro"]
};

// 3. Creación del Runtime (El motor principal)
async function startAgent() {
    elizaLogger.info("🚀 Alpha-Centauri-01 iniciando el motor...");

    const runtime = new AgentRuntime({
        databaseAdapter: dbAdapter,
        token: process.env.OPENAI_API_KEY,
        modelProvider: ModelProviderName.OPENAI,
        character: character,
        plugins: [solanaPlugin, bootstrapPlugin],
        agentId: stringToUuid(character.name),
    });

    // Inicializar el motor
    await runtime.initialize();

    // 4. Conectar a Telegram
    if (process.env.TELEGRAM_BOT_TOKEN) {
        elizaLogger.info("📱 Conectando con el Cuartel General de Telegram...");
        const tgClient = await TelegramClientInterface.start(runtime);
        elizaLogger.success("✅ ¡Telegram Online! Alpha-Centauri-01 te está esperando.");
    } else {
        elizaLogger.warn("⚠️ No se encontró TELEGRAM_BOT_TOKEN. El agente no podrá hablarte.");
    }
}

// Arrancar el proceso
startAgent().catch((error) => {
    elizaLogger.error("❌ Error crítico al despertar al agente:", error);
    process.exit(1);
});
