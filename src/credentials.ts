/**
 * Credential store abstraction.
 *
 * Preferred backends (not yet fully wired on all platforms):
 *   - Windows: Credential Manager / DPAPI
 *   - macOS: Keychain
 *   - Linux: Secret Service (libsecret)
 *
 * Current default: locally encrypted credential file (AES-256-GCM with a
 * machine-local key). Do NOT market this as a fully secure secret store.
 */

export type CredentialBackend =
  | "file"
  | "keychain"
  | "credential_manager"
  | "secret_service";

export interface CredentialStoreInfo {
  backend: CredentialBackend;
  /** Honest user-facing label */
  label: string;
  /** Longer explanation for doctor/setup */
  description: string;
  pathHint?: string;
}

export function detectCredentialBackend(
  platform: NodeJS.Platform = process.platform,
): CredentialBackend {
  // Prefer OS stores when FOUNDRY_CREDENTIAL_BACKEND is set, else file today.
  const forced = process.env.FOUNDRY_CREDENTIAL_BACKEND?.trim();
  if (
    forced === "keychain" ||
    forced === "credential_manager" ||
    forced === "secret_service" ||
    forced === "file"
  ) {
    return forced;
  }
  // OS backends are stubs until native bindings land — always file for now,
  // but report the intended platform target for honesty in doctor.
  void platform;
  return "file";
}

export function credentialStoreInfo(
  backend: CredentialBackend = detectCredentialBackend(),
): CredentialStoreInfo {
  if (backend === "keychain") {
    return {
      backend,
      label: "macOS Keychain",
      description: "Credentials stored in the system Keychain",
    };
  }
  if (backend === "credential_manager") {
    return {
      backend,
      label: "Windows Credential Manager",
      description: "Credentials stored via DPAPI / Credential Manager",
    };
  }
  if (backend === "secret_service") {
    return {
      backend,
      label: "Linux Secret Service",
      description: "Credentials stored via libsecret / Secret Service",
    };
  }
  return {
    backend: "file",
    label: "Locally encrypted credential file",
    description:
      "AES-256-GCM file under ~/.foundry. Machine-local key derivation — not a substitute for OS keychain/Credential Manager. Set FOUNDRY_SECRET_KEY for extra entropy.",
    pathHint: "~/.foundry/secrets.enc.json",
  };
}
