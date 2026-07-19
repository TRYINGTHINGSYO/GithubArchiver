import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createRelayServer } from "./server.js";
import { resolveApiKeys } from "./secrets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(root, ".env") });
// Optional: parent directory .env when Foundry is nested during migration.
dotenv.config({ path: path.resolve(root, "../.env") });

const port = Number(process.env.PORT ?? 8787) || 8787;
const keys = await resolveApiKeys();
const openaiApiKey = keys.openaiApiKey;
const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4.1";
const cursorAgentBin = process.env.CURSOR_AGENT_BIN ?? "agent";
const cursorApiKey = keys.cursorApiKey;
const defaultMaxRounds = Number(process.env.MAX_ROUNDS ?? 12) || 12;

const app = createRelayServer({
  port,
  openaiApiKey,
  openaiModel,
  cursorAgentBin,
  cursorApiKey,
  defaultMaxRounds,
});

await app.listen();

console.log(`Foundry listening on http://127.0.0.1:${port}`);
if (!openaiApiKey) {
  console.warn(
    "Warning: OPENAI_API_KEY is not set. Run: foundry setup  (or copy .env.example)",
  );
} else {
  console.log(`API keys: ${keys.source}`);
}
console.log(`Cursor agent binary: ${cursorAgentBin}`);
console.log(`OpenAI model: ${openaiModel}`);
console.log(`Default max rounds: ${defaultMaxRounds}`);
