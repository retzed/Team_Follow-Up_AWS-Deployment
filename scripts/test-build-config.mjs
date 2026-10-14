import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const publicKeys = [
  'TEAM_FOLLOW_UP_DATA_MODE',
  'TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID',
  'TEAM_FOLLOW_UP_COGNITO_CLIENT_ID',
  'TEAM_FOLLOW_UP_API_BASE_URL',
  'TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE',
  'TEAM_FOLLOW_UP_COGNITO_IDENTITY_MAP',
  'TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED'
];
const baseEnv = { ...process.env };
delete baseEnv.AWS_APP_ID;
for (const key of publicKeys) delete baseEnv[key];

function build(overrides = {}) {
  const env = { ...baseEnv, ...overrides };
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8', env });
  return result;
}
function getRuntimeConfig(html) {
  const match = html.match(/window\.TEAM_FOLLOW_UP_CONFIG = Object\.freeze\(([\s\S]*?)\);\s*<\/script>/);
  assert.ok(match, 'built output must contain runtime config');
  return JSON.parse(match[1]);
}

const hostedBuildWithoutExplicitMode = build({ AWS_APP_ID: 'amplify-test-app' });
assert.notEqual(hostedBuildWithoutExplicitMode.status, 0, 'Amplify builds must set data mode explicitly');
const hostedBuildWithEmptyMode = build({ AWS_APP_ID: 'amplify-test-app', TEAM_FOLLOW_UP_DATA_MODE: '', TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED: 'false' });
assert.notEqual(hostedBuildWithEmptyMode.status, 0, 'Amplify must reject an empty data-mode value instead of defaulting to demo mode');
const hostedBuildWithWhitespaceMode = build({ AWS_APP_ID: 'amplify-test-app', TEAM_FOLLOW_UP_DATA_MODE: '   ', TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED: 'false' });
assert.notEqual(hostedBuildWithWhitespaceMode.status, 0, 'Amplify must reject whitespace-only data-mode values');
const hostedBuildWithoutExplicitLocalAuth = build({ AWS_APP_ID: 'amplify-test-app', TEAM_FOLLOW_UP_DATA_MODE: 'builtin' });
assert.notEqual(hostedBuildWithoutExplicitLocalAuth.status, 0, 'Amplify builds must set the local-auth flag explicitly');

const valid = build({
  TEAM_FOLLOW_UP_DATA_MODE: 'api',
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
  TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123',
  TEAM_FOLLOW_UP_API_BASE_URL: 'https://example.execute-api.us-east-1.amazonaws.com',
  TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE: 'custom:teamUserId'
});
assert.equal(valid.status, 0, `API build should succeed: ${valid.stderr}`);
let output = await readFile('dist/index.html', 'utf8');
let config = getRuntimeConfig(output);
assert.equal(config.dataMode, 'api');
assert.equal(config.cognito.userPoolId, 'us-east-1_Example123');
assert.equal(config.apiBaseUrl, 'https://example.execute-api.us-east-1.amazonaws.com');
assert.equal(config.localAuth.enabled, false, 'real API mode must not enable local authentication');

const missingCognito = build({
  TEAM_FOLLOW_UP_DATA_MODE: 'api',
  TEAM_FOLLOW_UP_API_BASE_URL: 'https://example.execute-api.us-east-1.amazonaws.com'
});
assert.notEqual(missingCognito.status, 0, 'API build without Cognito config must fail closed');
const localAuthInApi = build({
  TEAM_FOLLOW_UP_DATA_MODE: 'api',
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
  TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123',
  TEAM_FOLLOW_UP_API_BASE_URL: 'https://example.execute-api.us-east-1.amazonaws.com',
  TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED: 'true'
});
assert.notEqual(localAuthInApi.status, 0, 'API mode must refuse local authentication');

const insecureApiUrl = build({
  TEAM_FOLLOW_UP_DATA_MODE: 'api',
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
  TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123',
  TEAM_FOLLOW_UP_API_BASE_URL: 'http://example.execute-api.us-east-1.amazonaws.com'
});
assert.notEqual(insecureApiUrl.status, 0, 'API mode must refuse non-HTTPS API endpoints');
const invalidLocalAuth = build({ TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED: 'maybe' });
assert.notEqual(invalidLocalAuth.status, 0, 'Build must reject ambiguous local-auth environment values');

// Restore the normal local/built-in build after testing configurations.
const restore = build({ TEAM_FOLLOW_UP_DATA_MODE: 'builtin' });
assert.equal(restore.status, 0, `default built-in build should be restored: ${restore.stderr}`);
output = await readFile('dist/index.html', 'utf8');
config = getRuntimeConfig(output);
assert.equal(config.dataMode, 'builtin');
assert.equal(config.localAuth.enabled, true);
const template = await readFile('backend/template.yaml', 'utf8');
assert.match(template, /ArchiveTable:\s*\n\s+Type: AWS::DynamoDB::Table/, 'SAM template must provision a dedicated Archive table');
assert.match(template, /ARCHIVE_TABLE:\s*!Ref ArchiveTable/, 'Lambda must be configured with the Archive table name');
assert.match(template, /GSI_ArchiveIndex/, 'Archive table must have a global archive index');
assert.match(template, /GSI_ArchiveRoot/, 'Archive table must have a root hierarchy index');
assert.match(template, /ArchiveTableName:/, 'SAM outputs must expose the Archive table name');
const schema = JSON.parse(await readFile('backend/table-schema.json', 'utf8'));
assert.ok(schema.tables.some(t => t.name === 'TeamFollowUp-Archive'), 'schema must document the Archive table');
assert.ok(schema.tables.find(t => t.name === 'TeamFollowUp-Archive').gsis.some(i => i.name === 'GSI_ArchiveIndex'));

console.log('Amplify build configuration tests passed: API mode, fail-closed validation, local-auth guard, restored built-in default, and Archive infrastructure configuration.');
