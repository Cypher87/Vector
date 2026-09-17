export const themes = ['vector', 'midnight', 'radar', 'amber', 'daylight'] as const;

export type Theme = (typeof themes)[number];

export const defaultTheme: Theme = 'vector';

export function parseTheme(value: unknown): Theme {
  return themes.includes(value as Theme) ? value as Theme : defaultTheme;
}
