import type { ProjectTemplateId, ScaffoldFile, ScaffoldPlan } from "./types.js";

function pkgJson(
  name: string,
  description: string,
  extras: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      name: name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      version: "0.1.0",
      private: true,
      type: "module",
      description,
      scripts: {
        dev: "echo \"implement me\"",
        build: "echo \"build ok\"",
        test: "node --test",
        typecheck: "echo \"typecheck ok\"",
        ...(extras.scripts as object | undefined),
      },
      ...extras,
    },
    null,
    2,
  );
}

function readme(name: string, description: string, template: string): string {
  return `# ${name}

${description}

Scaffolded by **Foundry** (template: \`${template}\`).

## Develop

\`\`\`bash
npm install
npm test
npm run build
\`\`\`
`;
}

function gitignore(): string {
  return `node_modules/
dist/
build/
.env
.env.*
!.env.example
.DS_Store
coverage/
.foundry/worktrees/
`;
}

function foundryConfig(): string {
  return `plugins: []
approval:
  before_pushes: true
  before_deploys: true
  before_database_changes: true
  before_dependency_updates: true
  before_commits: false
trust: safe_edits
require_plan_approval: true
supervisor: true
auto_verify: true
`;
}

/** Deterministic starter files per template. Custom/LLM plans can replace these. */
export function buildTemplatePlan(
  name: string,
  description: string,
  template: ProjectTemplateId,
  packageManager: "npm" | "pnpm" | "yarn" = "npm",
): ScaffoldPlan {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const files: ScaffoldFile[] = [
    { path: "README.md", content: readme(name, description, template) },
    { path: ".gitignore", content: gitignore() },
    { path: "foundry.config.yaml", content: foundryConfig() },
    { path: ".env.example", content: "# Add secrets here\n" },
  ];

  const notes: string[] = [];
  let installCommand = `${packageManager} install`;
  const verifyCommands = ["npm test", "npm run build"];

  switch (template) {
    case "web-app":
      files.push(
        {
          path: "package.json",
          content: pkgJson(slug, description, {
            scripts: {
              dev: "node src/server.js",
              build: "node -e \"console.log('build ok')\"",
              test: "node --test tests/*.test.js",
            },
          }),
        },
        {
          path: "src/server.js",
          content: `import http from "node:http";
const port = Number(process.env.PORT || 5173);
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body><h1>${name}</h1><p>${description.replace(/"/g, '\\"')}</p></body></html>");
});
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  server.listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port));
}
export { server };
`,
        },
        {
          path: "tests/smoke.test.js",
          content: `import test from "node:test";
import assert from "node:assert/strict";
test("scaffold ok", () => assert.equal(1 + 1, 2));
`,
        },
      );
      notes.push("Minimal Node HTTP web app scaffold (swap for SvelteKit/etc. via task graph)");
      break;

    case "api-service":
      files.push(
        {
          path: "package.json",
          content: pkgJson(slug, description, {
            scripts: {
              start: "node src/index.js",
              test: "node --test tests/*.test.js",
              build: "node -e \"console.log('build ok')\"",
            },
          }),
        },
        {
          path: "src/index.js",
          content: `import http from "node:http";
const port = Number(process.env.PORT || 8788);
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "${slug}" }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1");
`,
        },
        {
          path: "tests/health.test.js",
          content: `import test from "node:test";
import assert from "node:assert/strict";
test("api scaffold", () => assert.ok(true));
`,
        },
      );
      break;

    case "cli":
      files.push(
        {
          path: "package.json",
          content: pkgJson(slug, description, {
            bin: { [slug]: "./bin/cli.js" },
            scripts: {
              test: "node --test tests/*.test.js",
              build: "node -e \"console.log('build ok')\"",
            },
          }),
        },
        {
          path: "bin/cli.js",
          content: `#!/usr/bin/env node
console.log("${name}:", process.argv.slice(2).join(" ") || "(no args)");
`,
        },
        {
          path: "tests/cli.test.js",
          content: `import test from "node:test";
import assert from "node:assert/strict";
test("cli scaffold", () => assert.ok(true));
`,
        },
      );
      break;

    case "static-site":
      files.push(
        {
          path: "package.json",
          content: pkgJson(slug, description, {
            scripts: {
              build: "node -e \"console.log('static build ok')\"",
              test: "node --test tests/*.test.js",
            },
          }),
        },
        {
          path: "index.html",
          content: `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${name}</title></head><body><h1>${name}</h1><p>${description}</p></body></html>\n`,
        },
        {
          path: "tests/static.test.js",
          content: `import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("index exists", () => assert.match(readFileSync("index.html","utf8"), /${name}/));
`,
        },
      );
      break;

    case "blank":
    case "custom":
    case "desktop":
    case "automation":
    case "discord-bot":
    case "data-pipeline":
    default:
      files.push(
        {
          path: "package.json",
          content: pkgJson(slug, description, {
            scripts: {
              test: "node --test tests/*.test.js",
              build: "node -e \"console.log('build ok')\"",
            },
          }),
        },
        {
          path: "src/index.js",
          content: `export function hello() { return "${name}"; }\n`,
        },
        {
          path: "tests/basic.test.js",
          content: `import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "../src/index.js";
test("hello", () => assert.equal(hello(), "${name}"));
`,
        },
      );
      if (template === "custom") {
        notes.push(
          "Custom brief provided — supervisor/task graph should expand structure after scaffold",
        );
      }
      break;
  }

  return {
    name,
    template,
    files,
    installCommand,
    verifyCommands,
    notes,
  };
}

export const TEMPLATE_CATALOG: Array<{
  id: ProjectTemplateId;
  label: string;
  description: string;
}> = [
  { id: "web-app", label: "Web application", description: "HTTP/UI app starter" },
  { id: "api-service", label: "API service", description: "JSON HTTP service" },
  { id: "desktop", label: "Desktop application", description: "Desktop shell (blank + notes)" },
  { id: "cli", label: "CLI tool", description: "Command-line binary" },
  { id: "automation", label: "Automation script", description: "Scripting project" },
  { id: "static-site", label: "Static website", description: "HTML site" },
  { id: "discord-bot", label: "Discord bot", description: "Bot starter (blank + notes)" },
  { id: "data-pipeline", label: "Data pipeline", description: "Pipeline starter" },
  { id: "blank", label: "Blank project", description: "Minimal package" },
  { id: "custom", label: "Custom (from description)", description: "NL brief drives structure" },
];
