export function sanitizeAiOutputFileNameSegment(text: string, fallback: string): string {
  const collapsed = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return collapsed.slice(0, 32) || fallback
}
