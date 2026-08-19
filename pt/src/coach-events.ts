const RAW_TEXT_KEYS =
  /^(body|text|message|prompt|response|reply|content|raw|note|transcript)$/iu;

function inspect(value: unknown, depth: number): void {
  if (depth > 4) throw new Error("coach event metadata is too deeply nested");
  if (typeof value === "string" && value.length > 256) {
    throw new Error("coach event metadata string exceeds 256 characters");
  }
  if (Array.isArray(value)) {
    for (const item of value) inspect(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_TEXT_KEYS.test(key)) {
      throw new Error(`coach event metadata cannot contain raw-text key: ${key}`);
    }
    inspect(child, depth + 1);
  }
}

/** Enforce compact structured analytics; raw conversation belongs in message_log only. */
export function encodeCoachEventMetadata(metadata: Record<string, unknown> = {}): string {
  inspect(metadata, 0);
  const encoded = JSON.stringify(metadata);
  if (encoded.length > 2048) throw new Error("coach event metadata exceeds 2048 characters");
  return encoded;
}
