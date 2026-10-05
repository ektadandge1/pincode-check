export function compactCollectionName(value: string): string {
  const words = value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  return words.slice(0, 3).join(" ") || "Collection";
}
