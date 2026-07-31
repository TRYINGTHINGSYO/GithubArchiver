const SECRET_KEYS = /(token|secret|password|cookie|authorization|api[_-]?key|github_token)/i;
const SECRET_VALUE = /(gh[pousr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{20,})/g;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]');
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(inner);
    }
    return out;
  }
  return value;
}
