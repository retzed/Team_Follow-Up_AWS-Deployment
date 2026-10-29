import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const SOURCE_PATH = 'index.html';
const OUTPUT_PATH = 'dist/index.html';
const required = {
  userPoolId: 'TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID',
  userPoolClientId: 'TEAM_FOLLOW_UP_COGNITO_CLIENT_ID',
  apiBaseUrl: 'TEAM_FOLLOW_UP_API_BASE_URL'
};

function requireValue(envName) {
  const value = process.env[envName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required AWS deployment setting: ${envName}. Configure the Cognito/API outputs in Amplify or your build environment.`);
  }
  return value.trim();
}

function validateUserPoolId(value) {
  if (!/^[A-Za-z0-9-]+_[A-Za-z0-9]+$/.test(value) || /REPLACE|YOUR_|<|>/i.test(value)) {
    throw new Error(`${required.userPoolId} must be a real Cognito User Pool ID (for example, us-east-1_abc123).`);
  }
  return value;
}

function validateClientId(value) {
  if (!/^[A-Za-z0-9]{8,128}$/.test(value) || /REPLACE|YOUR_|<|>/i.test(value)) {
    throw new Error(`${required.userPoolClientId} must be the real public Cognito app-client ID.`);
  }
  return value;
}

function validateApiBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${required.apiBaseUrl} must be a valid HTTPS API Gateway base URL.`);
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !['', '/'].includes(parsed.pathname) ||
    /example\.(com|invalid)$/i.test(parsed.hostname)
  ) {
    throw new Error(`${required.apiBaseUrl} must be a real HTTPS base URL without credentials, a path, query, or fragment.`);
  }
  return parsed.origin;
}

const source = await readFile(SOURCE_PATH, 'utf8');
const configRegex = /<script id="team-follow-up-runtime-config">[\s\S]*?<\/script>/;
if (!configRegex.test(source)) {
  throw new Error('Could not find the runtime config block in index.html.');
}

const userPoolId = validateUserPoolId(requireValue(required.userPoolId));
const userPoolClientId = validateClientId(requireValue(required.userPoolClientId));
const apiBaseUrl = validateApiBaseUrl(requireValue(required.apiBaseUrl));
const teamUserAttribute = (process.env.TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE || 'custom:teamUserId').trim();
if (teamUserAttribute !== 'custom:teamUserId') {
  throw new Error('TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE must be custom:teamUserId; team identity mapping is managed by Cognito.');
}

const runtimeConfig = {
  cognito: { userPoolId, userPoolClientId, teamUserAttribute },
  apiBaseUrl
};
const serialized = JSON.stringify(runtimeConfig, null, 2).replaceAll('<', '\\u003c');
const replacement = `<script id="team-follow-up-runtime-config">\n/* Generated at build time from public AWS configuration. Never put secrets here. */\nwindow.TEAM_FOLLOW_UP_CONFIG = Object.freeze(${serialized});\n</script>`;
const output = source.replace(configRegex, replacement);

await mkdir('dist', { recursive: true });
await writeFile(OUTPUT_PATH, output, 'utf8');

for (const asset of ['favicon.svg', 'favicon.png', 'favicon.ico']) {
  await copyFile(asset, 'dist/' + asset);
}
console.log(`Built AWS-only frontend to ${OUTPUT_PATH} (Cognito + HTTPS API configured).`);
