/** Extract the first http(s) URL from free-form iMessage text. */
export function extractUrl(text: string): string | null {
  const m = text.match(/\bhttps?:\/\/[^\s<>"')\]]+/i);
  if (!m) return null;
  return m[0].replace(/[.,!?;:]+$/, "");
}

export function isVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "vimeo.com" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}
