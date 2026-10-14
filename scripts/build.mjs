import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = await readFile('index.html', 'utf8');
const readString = (key, fallback) => {
  const re = new RegExp(`${key}:\\s*["']([^"']*)["']`);
  return source.match(re)?.[1] ?? fallback;
};
const isAmplifyBuild = Boolean(process.env.AWS_APP_ID);
const configuredDataMode = process.env.TEAM_FOLLOW_UP_DATA_MODE;
if (isAmplifyBuild && configuredDataMode === undefined) {
  throw new Error('Set TEAM_FOLLOW_UP_DATA_MODE explicitly in Amplify Hosting; refusing to publish with an implicit local/demo mode.');
}
const dataMode = (configuredDataMode || readString('dataMode', 'builtin')).toLowerCase();
if (!['builtin', 'api'].includes(dataMode)) throw new Error('TEAM_FOLLOW_UP_DATA_MODE must be builtin or api.');
const userPoolId = process.env.TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID || readString('userPoolId', 'REPLACE_WITH_COGNITO_USER_POOL_ID');
const clientId = process.env.TEAM_FOLLOW_UP_COGNITO_CLIENT_ID || readString('userPoolClientId', 'REPLACE_WITH_PUBLIC_APP_CLIENT_ID');
const apiBaseUrl = process.env.TEAM_FOLLOW_UP_API_BASE_URL || readString('apiBaseUrl', 'REPLACE_WITH_API_GATEWAY_BASE_URL');
const teamUserAttribute = process.env.TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE || readString('teamUserAttribute', 'custom:teamUserId');
let identityMap = {};
if (process.env.TEAM_FOLLOW_UP_COGNITO_IDENTITY_MAP) {
  try { identityMap = JSON.parse(process.env.TEAM_FOLLOW_UP_COGNITO_IDENTITY_MAP); }
  catch { throw new Error('TEAM_FOLLOW_UP_COGNITO_IDENTITY_MAP must be valid JSON.'); }
  if (!identityMap || typeof identityMap !== 'object' || Array.isArray(identityMap)) throw new Error('TEAM_FOLLOW_UP_COGNITO_IDENTITY_MAP must be a JSON object.');
}
const configuredCognito = !/REPLACE_WITH|^\s*$/.test(userPoolId) && !/REPLACE_WITH|^\s*$/.test(clientId);
const localEnv = process.env.TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED;
if (isAmplifyBuild && localEnv === undefined) {
  throw new Error('Set TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED explicitly in Amplify Hosting; use false for hosted builds.');
}
const truthy = ['1', 'true', 'yes', 'on'];
const falsy = ['0', 'false', 'no', 'off'];
if (localEnv !== undefined && ![...truthy, ...falsy].includes(localEnv.toLowerCase())) {
  throw new Error('TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED must be true or false.');
}
const localAuthEnabled = localEnv !== undefined
  ? truthy.includes(localEnv.toLowerCase())
  : (dataMode === 'builtin' && !configuredCognito);
if (dataMode === 'api' && !configuredCognito) throw new Error('API mode requires TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID and TEAM_FOLLOW_UP_COGNITO_CLIENT_ID.');
if (dataMode === 'api' && /REPLACE_WITH|^\s*$/.test(apiBaseUrl)) throw new Error('API mode requires TEAM_FOLLOW_UP_API_BASE_URL.');
if (dataMode === 'api') {
  let parsedApiUrl;
  try { parsedApiUrl = new URL(apiBaseUrl); }
  catch { throw new Error('TEAM_FOLLOW_UP_API_BASE_URL must be a valid HTTPS URL.'); }
  if (parsedApiUrl.protocol !== 'https:' || parsedApiUrl.username || parsedApiUrl.password || parsedApiUrl.search || parsedApiUrl.hash || !['', '/'].includes(parsedApiUrl.pathname)) {
    throw new Error('TEAM_FOLLOW_UP_API_BASE_URL must be a base HTTPS URL without credentials, query, fragment, or a path.');
  }
}
if (dataMode === 'api' && localAuthEnabled) throw new Error('Local auth must be disabled when TEAM_FOLLOW_UP_DATA_MODE=api.');

const config = {
  cognito: { userPoolId, userPoolClientId: clientId, teamUserAttribute, identityMap },
  localAuth: { enabled: localAuthEnabled },
  dataMode,
  apiBaseUrl
};
const safelySerialized = JSON.stringify(config, null, 2).replaceAll('<', '\\u003c');
const replacement = `<script id="team-follow-up-runtime-config">\n/* Generated at build time from public Amplify environment variables. Never put secrets here. */\nwindow.TEAM_FOLLOW_UP_CONFIG = Object.freeze(${safelySerialized});\n</script>`;
const configRegex = /<script id="team-follow-up-runtime-config">[\s\S]*?<\/script>/;
if (!configRegex.test(source)) throw new Error('Could not find the runtime config block in index.html.');
const output = source.replace(configRegex, replacement);
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', output, 'utf8');
console.log(`Built static dashboard to dist/ (dataMode=${dataMode}, cognito=${configuredCognito ? 'configured' : 'placeholder'}, localAuth=${localAuthEnabled})`);
