import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const sourceHtml = await readFile('index.html', 'utf8');
for (const forbidden of [
  'localStorage',
  'team-follow-up-local-auth-v1',
  'initializeLocalAuth',
  'makeLocalContext',
  'seedData(',
  'function resetDemoData(',
  'mockRoute',
  'TEAM_FOLLOW_UP_DATA_MODE',
  'TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED',
  'localAuth',
  'builtin.local',
  'memoryTables',
  'TABLES_KEY',
  'STORAGE_KEY'
]) {
  assert.ok(!sourceHtml.includes(forbidden), `AWS-only frontend must not contain ${forbidden}`);
}

const envKeys = [
  'TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID',
  'TEAM_FOLLOW_UP_COGNITO_CLIENT_ID',
  'TEAM_FOLLOW_UP_API_BASE_URL',
  'TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE'
];
const baseEnv = { ...process.env };
for (const key of envKeys) delete baseEnv[key];

function build(overrides = {}) {
  return spawnSync(process.execPath, ['scripts/build.mjs'], {
    encoding: 'utf8',
    env: { ...baseEnv, ...overrides }
  });
}
function getRuntimeConfig(html) {
  const match = html.match(/window\.TEAM_FOLLOW_UP_CONFIG = Object\.freeze\(([\s\S]*?)\);\s*<\/script>/);
  assert.ok(match, 'built output must contain AWS runtime config');
  return JSON.parse(match[1]);
}

const noConfig = build();
assert.notEqual(noConfig.status, 0, 'AWS-only build must reject missing AWS configuration');
assert.match(noConfig.stderr, /TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID/);

const missingClient = build({
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
  TEAM_FOLLOW_UP_API_BASE_URL: 'https://app-api.execute-api.us-east-1.amazonaws.com'
});
assert.notEqual(missingClient.status, 0, 'AWS-only build must require the Cognito app-client ID');

const missingApi = build({
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
  TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123456789'
});
assert.notEqual(missingApi.status, 0, 'AWS-only build must require the API URL');

const invalidPool = build({
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'REPLACE_WITH_POOL',
  TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123456789',
  TEAM_FOLLOW_UP_API_BASE_URL: 'https://app-api.execute-api.us-east-1.amazonaws.com'
});
assert.notEqual(invalidPool.status, 0, 'Build must reject placeholder Cognito IDs');

for (const apiUrl of [
  'http://app-api.execute-api.us-east-1.amazonaws.com',
  'https://app-api.execute-api.us-east-1.amazonaws.com/path',
  'https://user:pass@app-api.execute-api.us-east-1.amazonaws.com',
  'https://app-api.execute-api.us-east-1.amazonaws.com?x=1',
  'https://example.com'
]) {
  const badApi = build({
    TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
    TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123456789',
    TEAM_FOLLOW_UP_API_BASE_URL: apiUrl
  });
  assert.notEqual(badApi.status, 0, `Build must reject invalid API base URL: ${apiUrl}`);
}

const valid = build({
  TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID: 'us-east-1_Example123',
  TEAM_FOLLOW_UP_COGNITO_CLIENT_ID: 'examplepublicclient123456789',
  TEAM_FOLLOW_UP_API_BASE_URL: 'https://app-api.execute-api.us-east-1.amazonaws.com',
  TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE: 'custom:teamUserId'
});
assert.equal(valid.status, 0, `AWS-configured build should succeed: ${valid.stderr}`);

const output = await readFile('dist/index.html', 'utf8');
const config = getRuntimeConfig(output);
assert.equal(config.cognito.userPoolId, 'us-east-1_Example123');
assert.equal(config.cognito.userPoolClientId, 'examplepublicclient123456789');
assert.equal(config.cognito.teamUserAttribute, 'custom:teamUserId');
assert.equal(config.apiBaseUrl, 'https://app-api.execute-api.us-east-1.amazonaws.com');
assert.ok(!('localAuth' in config), 'runtime config must not contain a local-auth switch');
assert.ok(!('dataMode' in config), 'runtime config must not contain a database-mode switch');
assert.ok(!('identityMap' in config.cognito), 'team identity must not be overridable by a browser-side map');

const template = await readFile('backend/template.yaml', 'utf8');
assert.match(template, /ArchiveTable:\s*\n\s+Type: AWS::DynamoDB::Table/, 'SAM template must provision Archive');
assert.match(template, /ARCHIVE_TABLE:\s*!Ref ArchiveTable/, 'Lambda must receive the Archive table name');
assert.match(template, /GSI_ArchiveIndex/, 'Archive table must define its archive index');
assert.match(template, /GSI_ArchiveRoot/, 'Archive table must define its hierarchy index');

const schema = JSON.parse(await readFile('backend/table-schema.json', 'utf8'));
assert.equal(schema.thisFileProvisionsAwsResources, false, 'table-schema.json is documentation, not infrastructure');
assert.ok(schema.tables.some(table => table.name === 'TeamFollowUp-Archive'), 'schema must document Archive table');
assert.ok(!('defaultMode' in schema), 'schema must not describe a built-in runtime database');

console.log('AWS-only build configuration tests passed: mandatory Cognito/API settings, HTTPS endpoint validation, and no local auth/database flags.');
