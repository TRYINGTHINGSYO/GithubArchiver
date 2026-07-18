import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createRelayServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(root, ".env") });
// Also allow repo-root .env when launched from the monorepo.
dotenv.config({ path: path.resolve(root, "../../.env") });

const port = Number(process.env.PORT ?? 8787) || 8787;
const openaiApiKey = process.env.OPENAI_API_KEY ?? "";
const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4.1";
const cursorAgentBin = process.env.CURSOR_AGENT_BIN ?? "agent";
const cursorApiKey = process.env.CURSOR_API_KEY;
const defaultMaxRounds = Number(process.env.MAX_ROUNDS ?? 8) || 8;

const app = createRelayServer({
  port,
  openaiApiKey,
  openaiModel,
  cursorAgentBin,
  cursorApiKey,
  defaultMaxRounds,
});

await app.listen();

console.log(`GPT ↔ Cursor Relay listening on http://127.0.0.1:${port}`);
if (!openaiApiKey) {
  console.warn("Warning: OPENAI_API_KEY is not set. Create tools/gpt-cursor-relay/.env");
}
console.log(`Cursor agent binary: ${cursorAgentBin}`);
console.log(`OpenAI model: ${openaiModel}`);
console.log(`Default max rounds: ${defaultMaxRounds}`);
