/** Keep a distinct model description, but never repeat the type code as its fallback. */
export function aircraftTypeSummary(typeCode: string | undefined, description: string): string {
  const code = typeCode?.trim();
  const label = description.trim();
  if (!code) return label;
  if (!label || code.toUpperCase() === label.toUpperCase()) return code;
  return `${code} · ${label}`;
}
