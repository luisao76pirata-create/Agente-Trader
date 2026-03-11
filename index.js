import { createAgentRuntime, loadCharacterTryPath, defaultCharacter } from "@elizaos/core";
import { SqliteDatabaseAdapter } from "@elizaos/adapter-sqlite";
import { TelegramClientInterface } from "@elizaos/plugin-telegram";
import { OpenAIPlugin } from "@elizaos/plugin-openai";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env vars directly from process.env (Railway injects them automatically)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set");
  process.exit(1);
}

console.log("✅ TELEGRAM_BOT_TOKEN found");
console.log("✅ OPENAI_API_KEY found");

// Load character file
let character;
try {
  const characterPath = path.join(__dirname, "characters/solana-trader.character.json");
  const raw = readFileSync(characterPath, "utf-8");
  character = JSON.parse(raw);
  console.log(`✅ Character loaded: ${character.name}`);
} catch (err) {
  console.error("ERROR loading character file:", err.message);
  process.exit(1);
}

// Inject secrets into character settings
character.settings = character.settings || {};
character.settings.secrets = {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
};

// Setup SQLite database
const dbPath = path.join("/root/.eliza", "db", "agent.db");
const db = new SqliteDatabaseAdapter(dbPath);

// Start the agent
async function main() {
  try {
    console.log("🚀 Starting SolanaTrader agent...");

    const runtime = await createAgentRuntime({
      character,
      db,
      plugins: [OpenAIPlugin],
      providers: [],
      actions: [],
    });

    // Start Telegram client
    const telegramClient = await TelegramClientInterface.start(runtime);
    console.log("✅ Telegram client started successfully");

    // Handle shutdown
    process.on("SIGINT", async () => {
      console.log("Shutting down...");
      await TelegramClientInterface.stop(runtime);
      process.exit(0);
    });

  } catch (err) {
    console.error("ERROR starting agent:", err);
    process.exit(1);
  }
}

main();
