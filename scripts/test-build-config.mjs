import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const sourceHtml = await readFile('index.html', 'utf8');
assert.ok(sourceHtml.includes("API_CACHE_PREFIX='team-follow-up-api-cache-v1:'"), 'AWS frontend may persist only the versioned API response cache.');
assert.ok(sourceHtml.includes('function requestCachedGet(path,key){'), 'AWS response cache must validate server versions before reusing stored data.');
for (const forbidden of [
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
// SAM is optional, but its template must be a complete from-scratch automation reference.
// The normal deployment method is manual AWS Console creation/configuration.
for (const resourceType of [
  'AWS::Cognito::UserPool',
  'AWS::Cognito::UserPoolClient',
  'AWS::DynamoDB::Table',
  'AWS::IAM::Role',
  'AWS::Amplify::App',
  'AWS::Amplify::Branch',
  'AWS::Budgets::Budget',
  'AWS::Logs::LogGroup',
  'AWS::CloudWatch::Dashboard',
  'AWS::CloudWatch::Alarm',
  'AWS::Serverless::HttpApi',
  'AWS::Serverless::Function'
]) {
  assert.ok(template.includes(`Type: ${resourceType}`), `Full-stack automation template must create ${resourceType}`);
}
assert.match(template, /ITEMS_TABLE:\s*!Ref ItemsTable/, 'Lambda must receive the Items table created by the template');
assert.match(template, /ACTIVITY_TABLE:\s*!Ref ActivityTable/, 'Lambda must receive the Activity table created by the template');
assert.match(template, /USERS_TABLE:\s*!Ref UsersTable/, 'Lambda must receive the Users table created by the template');
assert.match(template, /ARCHIVE_TABLE:\s*!Ref ArchiveTable/, 'Lambda must receive the Archive table created by the template');
assert.match(template, /ResourceNamePrefix:\s*\n\s+Type: String\s*\n\s+Default: TeamFollowUp/, 'Template must default to the console physical resource naming contract');
assert.doesNotMatch(template, /ExistingCognitoUserPoolId|ExistingCognitoAppClientId|ExistingItemsTableName|ExistingActivityTableName|ExistingUsersTableName|ExistingArchiveTableName|AllowedOrigin:/, 'Full-stack template must not depend on pre-created resources or a pre-known website origin');
assert.match(template, /Name: custom:teamUserId|Name: teamUserId/, 'Template must create the custom team identity schema attribute');
const clientBlock = template.match(/  TeamFollowUpAppClient:[\s\S]*?\n  ItemsTable:/)?.[0] || '';
assert.ok(clientBlock, 'Template must define a Cognito app client before its DynamoDB resources');
assert.match(clientBlock, /ReadAttributes:[\s\S]*custom:teamUserId/, 'Browser client must read the team ID attribute');
assert.match(clientBlock, /WriteAttributes:[\s\S]*\n\s+- email\n/, 'Browser client write attributes must be explicitly limited');
assert.doesNotMatch(clientBlock, /WriteAttributes:[\s\S]*custom:teamUserId/, 'Browser client must not write its authorization-relevant team ID');
assert.match(template, /DeletionPolicy: Retain/, 'Table data must be retained on stack deletion');
assert.match(template, /RetentionInDays: 30/, 'CloudWatch logs must have explicit 30-day retention');
assert.match(template, /RoleName: !Sub '\${ResourceNamePrefix}-Api-ExecutionRole'/, 'Automation execution-role name must match the console runbook default');
assert.match(template, /Role: !GetAtt ApiExecutionRole\.Arn/, 'Lambda must be attached to the explicitly defined execution role');
assert.match(template, /AWSLambdaBasicExecutionRole/, 'The explicit execution role must provide standard CloudWatch logging permissions');

const schema = JSON.parse(await readFile('backend/table-schema.json', 'utf8'));
assert.equal(schema.thisFileProvisionsAwsResources, false, 'table-schema.json is documentation, not infrastructure');
assert.ok(schema.tables.some(table => table.name === 'TeamFollowUp-Archive'), 'schema must document Archive table');
assert.ok(!('defaultMode' in schema), 'schema must not describe a built-in runtime database');

console.log('AWS-only build configuration tests passed: mandatory Cognito/API settings, HTTPS endpoint validation, and no local auth/database flags.');
