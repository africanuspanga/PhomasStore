export function normalizeProductCode(code: string | null | undefined): string {
  if (!code) {
    return "";
  }

  const normalized = code
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return normalized.replace(/^0+(?=\d)/, "");
}

export function getProductCodeLookupCandidates(code: string | null | undefined): string[] {
  if (!code) {
    return [];
  }

  const raw = code.toString().trim();
  if (!raw) {
    return [];
  }

  const uppercase = raw.toUpperCase();
  const noWhitespace = uppercase.replace(/\s+/g, "");
  const noHyphenOrWhitespace = uppercase.replace(/[-\s]/g, "");
  const normalized = normalizeProductCode(uppercase);

  return Array.from(new Set([
    raw,
    uppercase,
    noWhitespace,
    noHyphenOrWhitespace,
    normalized,
  ].filter(Boolean)));
}
