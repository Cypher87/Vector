export const themes = ['dark', 'light'] as const;
export const themeModes = [...themes, 'auto'] as const;

export type Theme = (typeof themes)[number];
export type ThemeMode = (typeof themeModes)[number];

export const defaultTheme: Theme = 'dark';
export const defaultThemeMode: ThemeMode = 'auto';
export const themeStorageKey = 'vector.theme';
export const darkColorSchemeQuery = '(prefers-color-scheme: dark)';

const themeAliases: Record<string, ThemeMode> = {
  dark: 'dark', light: 'light', auto: 'auto',
  vector: 'dark', midnight: 'dark', radar: 'dark', amber: 'dark', daylight: 'light',
};

// Undefined remains undefined in partial sync updates; an invalid value must not reset a preference.
export function normalizeThemeMode(value: unknown): ThemeMode | undefined {
  return typeof value === 'string' && Object.hasOwn(themeAliases, value) ? themeAliases[value] : undefined;
}

export const parseThemeMode = (value: unknown): ThemeMode => normalizeThemeMode(value) ?? defaultThemeMode;
export const resolveTheme = (mode: ThemeMode, prefersDark: boolean): Theme => mode === 'auto' ? prefersDark ? 'dark' : 'light' : mode;

// Runs before first paint. Only fixed application constants are embedded, never user input.
export const themeBootstrapScript = `(()=>{let saved;try{saved=localStorage.getItem(${JSON.stringify(themeStorageKey)})}catch{}const aliases=${JSON.stringify(themeAliases)};const mode=typeof saved==='string'&&Object.hasOwn(aliases,saved)?aliases[saved]:'auto';const dark=typeof matchMedia!=='function'||matchMedia(${JSON.stringify(darkColorSchemeQuery)}).matches;document.documentElement.dataset.theme=mode==='auto'?(dark?'dark':'light'):mode;document.documentElement.dataset.themeMode=mode})()`;
