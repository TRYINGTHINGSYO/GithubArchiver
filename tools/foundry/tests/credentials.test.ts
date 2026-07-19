import { describe, expect, it } from "vitest";
import { credentialStoreInfo, detectCredentialBackend } from "../src/credentials.js";

describe("credential store messaging", () => {
  it("defaults to locally encrypted credential file", () => {
    const prev = process.env.FOUNDRY_CREDENTIAL_BACKEND;
    delete process.env.FOUNDRY_CREDENTIAL_BACKEND;
    expect(detectCredentialBackend()).toBe("file");
    const info = credentialStoreInfo("file");
    expect(info.label).toMatch(/Locally encrypted credential file/i);
    expect(info.description).not.toMatch(/fully secure secret store/i);
    if (prev === undefined) delete process.env.FOUNDRY_CREDENTIAL_BACKEND;
    else process.env.FOUNDRY_CREDENTIAL_BACKEND = prev;
  });
});
