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



// Theme changes are a root-level style update. They must not rebuild the
// workspace or account DOM while the browser is repainting the new palette.
const themeHelperStart = html.indexOf('let themeSwitchSequence=0;');
const applyTranslationsStart = html.indexOf('function applyTranslations(){', themeHelperStart);
assert.ok(themeHelperStart >= 0 && applyTranslationsStart > themeHelperStart,
  'The complete dedicated applyTheme helper and its sequence counter must exist before translation rendering.');
const applyThemeSource = html.slice(themeHelperStart, applyTranslationsStart);
function verifyApplyTheme(theme) {
  const button = { innerHTML: '', title: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const themeSelect = { value: theme === 'light' ? 'dark' : 'light' };
  const classes = new Set();
  const frameCallbacks = [];
  const context = {
    ui: { theme },
    document: { documentElement: {
      dataset: { theme: theme === 'light' ? 'dark' : 'light' },
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); }
      }
    } },
    requestAnimationFrame: callback => frameCallbacks.push(callback),
    $: selector => selector === '#themeToggle' ? button : selector === '#accountTheme' ? themeSelect : null,
    icon: name => `icon:${name}`
  };
  vm.runInNewContext(applyThemeSource + '\nthis.applyTheme = applyTheme;', context);
  context.applyTheme();
  assert.equal(context.document.documentElement.dataset.theme, theme);
  assert.ok(classes.has('theme-switching'), 'Theme transitions stay suppressed during the palette repaint.');
  assert.equal(frameCallbacks.length, 1, 'The suppression cleanup waits for an animation frame.');
  assert.equal(button.innerHTML, theme === 'light' ? 'icon:moon' : 'icon:sun');
  assert.equal(button.title, theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  assert.equal(button.attributes['aria-label'], button.title);
  assert.equal(themeSelect.value, theme, 'The account theme selector stays synchronized.');
  frameCallbacks.shift()();
  assert.ok(classes.has('theme-switching'), 'Suppression remains active through the next frame.');
  assert.equal(frameCallbacks.length, 1, 'Cleanup waits one additional frame so the new palette can paint.');
  frameCallbacks.shift()();
  assert.ok(!classes.has('theme-switching'), 'Normal interactions regain their transitions after the theme repaint.');
}
verifyApplyTheme('light');
verifyApplyTheme('dark');

assert.ok(html.includes('html.theme-switching *,html.theme-switching *::before,html.theme-switching *::after{transition:none!important;animation:none!important}'),
  'Theme changes must suppress all descendant and pseudo-element transitions while the palette is repainted.');
const preferenceHandlerStart = html.indexOf('async function changeUserPreference(key,value){');
const renderFunctionStart = html.indexOf('function render(){', preferenceHandlerStart);
assert.ok(preferenceHandlerStart >= 0 && renderFunctionStart > preferenceHandlerStart,
  'The preference handler must remain available for targeted update testing.');
const preferenceHandlerSource = html.slice(preferenceHandlerStart, renderFunctionStart);
async function simulatePreferenceChange({ key, value, fail = false }) {
  let renderCalls = 0;
  let applyThemeCalls = 0;
  let savedPreferences = null;
  const context = {
    ui: { lang: 'en', theme: 'dark' },
    rawCurrentUser: () => ({ id: 'u1', preferences: { lang: 'en', theme: 'dark' } }),
    render: () => { renderCalls += 1; },
    applyTheme: () => { applyThemeCalls += 1; },
    window: {
      TeamFollowUpDataApi: {
        updateMyProfile: async fields => {
          savedPreferences = fields.preferences;
          if (fail) throw new Error('simulated save failure');
          return { user: { id: 'u1' } };
        }
      }
    },
    mergeProfileIntoData: () => {},
    toast: () => {},
    tr: () => 'Account error'
  };
  vm.runInNewContext(preferenceHandlerSource + '\nthis.changeUserPreference = changeUserPreference;', context);
  await context.changeUserPreference(key, value);
  return { context, renderCalls, applyThemeCalls, savedPreferences };
}
{
  const result = await simulatePreferenceChange({ key: 'theme', value: 'light' });
  assert.equal(result.context.ui.theme, 'light');
  assert.equal(result.renderCalls, 0, 'A successful theme change must not run the full renderer.');
  assert.equal(result.applyThemeCalls, 2, 'Apply the theme immediately and resynchronize after the save.');
  assert.equal(result.savedPreferences.theme, 'light', 'The selected theme is still persisted to the signed-in user profile.');
}
{
  const result = await simulatePreferenceChange({ key: 'theme', value: 'light', fail: true });
  assert.equal(result.context.ui.theme, 'dark', 'A failed theme save restores the previous theme.');
  assert.equal(result.renderCalls, 0, 'Theme rollback must not run the full renderer.');
  assert.equal(result.applyThemeCalls, 2, 'Theme rollback is applied directly.');
}
{
  const result = await simulatePreferenceChange({ key: 'lang', value: 'ar' });
  assert.equal(result.context.ui.lang, 'ar');
  assert.equal(result.renderCalls, 2, 'Language changes still render the translated interface.');
  assert.equal(result.applyThemeCalls, 0, 'The theme-only path does not alter language updates.');
}

// During API hydration, capture the persisted theme and apply it only after
// the initial workspace render has finished. This avoids interleaving a full
// data render with the saved-theme palette change.
assert.ok(html.includes("if(['light','dark'].includes(profile.preferences.theme))hydratedUserTheme=profile.preferences.theme;"),
  'Workspace hydration must retain the signed-in user theme for post-render application.');
assert.ok(html.includes('skipNextSidebarApiRefresh=true;render();\n  if(hydratedUserTheme){ui.theme=hydratedUserTheme;applyTheme();}'),
  'The saved API theme must be applied after the initial workspace render.');
if (html.includes('savedUserTheme=null;')) {
  assert.ok(html.includes('render();\n if(savedUserTheme){ui.theme=savedUserTheme;applyTheme();}'),
    'The local demo theme must also be applied after its initial render.');
}

console.log('Theme tests passed: OS preference detection, saved-theme precedence, fast theme-only application, save rollback, and post-render hydration.');
