import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const detectorStart = html.indexOf('function detectInitialPreferences(){');
const resolverStart = html.indexOf('function resolvePreferredTheme(', detectorStart);
const initialPreferencesStart = html.indexOf('const initialPreferences=detectInitialPreferences();', resolverStart);
assert.ok(detectorStart >= 0 && resolverStart > detectorStart && initialPreferencesStart > resolverStart,
  'The initial preference detector and saved-theme resolver must exist in the startup path.');

const detectorSource = html.slice(detectorStart, resolverStart);
const resolverSource = html.slice(resolverStart, initialPreferencesStart);

function loadThemeHelpers({
  language = 'en-US',
  dark = false,
  light = true,
  forcedColors = false,
  mediaAvailable = true,
  throwFromMedia = false
} = {}) {
  const context = {
    navigator: {
      language,
      languages: language ? [language] : []
    },
    window: {}
  };

  if (mediaAvailable) {
    context.window.matchMedia = query => {
      if (throwFromMedia) throw new Error('matchMedia unavailable');
      if (query === '(forced-colors: active)') return { matches: forcedColors };
      if (query === '(prefers-color-scheme: dark)') return { matches: dark };
      if (query === '(prefers-color-scheme: light)') return { matches: light };
      return { matches: false };
    };
  }

  vm.runInNewContext(
    detectorSource + '\n' + resolverSource +
    '\nthis.detectInitialPreferences = detectInitialPreferences;' +
    '\nthis.resolvePreferredTheme = resolvePreferredTheme;',
    context
  );
  return context;
}

// The OS color scheme is detected independently of whether the browser locale
// is one of the two supported UI languages.
{
  const result = loadThemeHelpers({ language: 'en-US', dark: true, light: false }).detectInitialPreferences();
  assert.equal(result.lang, 'en');
  assert.equal(result.theme, 'dark');
}
{
  const result = loadThemeHelpers({ language: 'ar-EG', dark: false, light: true }).detectInitialPreferences();
  assert.equal(result.lang, 'ar');
  assert.equal(result.theme, 'light');
}
{
  const result = loadThemeHelpers({ language: 'fr-FR', dark: false, light: true }).detectInitialPreferences();
  assert.equal(result.lang, 'en', 'Unsupported browser locales retain the English UI fallback.');
  assert.equal(result.theme, 'light', 'Unsupported browser locales must not suppress a readable OS light theme.');
}
{
  const result = loadThemeHelpers({ language: 'fr-FR', dark: true, light: false }).detectInitialPreferences();
  assert.equal(result.theme, 'dark', 'Unsupported browser locales must not suppress a readable OS dark theme.');
}

// When the system theme cannot be determined reliably, dark is the fallback.
for (const options of [
  { mediaAvailable: false },
  { mediaAvailable: true, throwFromMedia: true },
  { dark: false, light: false },
  { dark: true, light: true },
  { forcedColors: true, dark: false, light: true }
]) {
  assert.equal(loadThemeHelpers(options).detectInitialPreferences().theme, 'dark');
}

// An explicitly saved user theme always wins. Otherwise preserve an existing
// valid preference; only a genuinely unset preference falls back to the OS.
{
  const resolve = loadThemeHelpers().resolvePreferredTheme;
  assert.equal(resolve('light', 'dark', 'dark'), 'light', 'The signed-in user’s saved light preference wins over dark defaults.');
  assert.equal(resolve('dark', 'light', 'light'), 'dark', 'The signed-in user’s saved dark preference wins over a light OS theme.');
  assert.equal(resolve(undefined, 'light', 'dark'), 'light', 'An existing valid preference is retained when the incoming profile omits it.');
  assert.equal(resolve(undefined, undefined, 'light'), 'light', 'A first-time profile without a saved theme inherits the OS light theme.');
  assert.equal(resolve(undefined, undefined, 'dark'), 'dark', 'A first-time profile without a saved theme inherits the OS dark fallback.');
  assert.equal(resolve('invalid', undefined, 'invalid'), 'dark', 'Invalid theme values fall back safely to dark.');
}

// The head bootstrap paints the sign-in screen from the system preference and
// stores that initial value separately from later signed-in theme changes.
const headScript = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1] || '';
assert.ok(headScript.includes('root.dataset.systemTheme=theme') && headScript.includes('root.dataset.theme=theme'),
  'The document head must apply and retain the initial system theme before the sign-in UI is shown.');
assert.ok(!headScript.includes('supported&&') && !headScript.includes('let lang=\'en\', theme=\'dark\', supported=false'),
  'The early system-theme detection must not depend on whether the browser language is supported.');

// Missing profile themes must remain unset while data is normalized. They must
// never be silently converted into an explicit dark preference before merge.
assert.ok(!html.includes("theme:['light','dark'].includes(user.preferences?.theme)?user.preferences.theme:'dark'"),
  'API team-user normalization must not invent a dark preference.');
assert.ok(!html.includes("theme:['light','dark'].includes(u.preferences?.theme)?u.preferences.theme:'dark'"),
  'The built-in table serializer must not persist a synthetic dark preference.');
assert.ok(html.includes('theme:resolvePreferredTheme(incomingPreferences.theme,oldPreferences.theme,initialPreferences.theme)'),
  'Profile hydration must prioritize stored preferences and use the detected OS theme only when no saved theme exists.');

console.log('Theme initialization tests passed: OS light/dark detection, unsupported locales, safe dark fallback, saved user preference precedence, and missing-theme profile hydration.');
