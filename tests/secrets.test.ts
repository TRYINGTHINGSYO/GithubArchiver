import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSecret, loadSecrets, setSecret } from "../src/secrets.js";

describe("secrets vault", () => {
  let home: string;
  const prevHome = process.env.FOUNDRY_HOME;
  const prevKey = process.env.FOUNDRY_SECRET_KEY;

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.FOUNDRY_HOME;
    else process.env.FOUNDRY_HOME = prevHome;
    if (prevKey === undefined) delete process.env.FOUNDRY_SECRET_KEY;
    else process.env.FOUNDRY_SECRET_KEY = prevKey;
    if (home) await rm(home, { recursive: true, force: true });
  });

  it("encrypts and round-trips secrets", async () => {
    home = await mkdtemp(path.join(tmpdir(), "foundry-vault-"));
    process.env.FOUNDRY_HOME = home;
    process.env.FOUNDRY_SECRET_KEY = "test-key-material";

    await setSecret("OPENAI_API_KEY", "sk-test-123");
    expect(await getSecret("OPENAI_API_KEY")).toBe("sk-test-123");
    const all = await loadSecrets();
    expect(all.OPENAI_API_KEY).toBe("sk-test-123");
  });
});
