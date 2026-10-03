export function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
