import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const sourceHtml = await readFile('index.html', 'utf8');
const authGateStart = sourceHtml.indexOf('<script id="pre-auth-gate">');
assert.ok(authGateStart >= 0, 'page includes the pre-authentication sign-in gate');
const authGateEnd = sourceHtml.indexOf('</script>', authGateStart);
assert.ok(authGateEnd > authGateStart, 'pre-authentication sign-in gate is a complete script');
const authGate = sourceHtml.slice(authGateStart, authGateEnd);
assert.ok(authGate.includes('src="./logo.svg?v=20261030-brandrefresh2"'), 'sign-in logo is rendered without relying on the later app script');
assert.ok(!authGate.includes('applicationLogoMarkup()'), 'pre-auth sign-in cannot call helpers from the later app bootstrap script');

assert.ok(sourceHtml.includes("API_CACHE_PREFIX='team-follow-up-api-cache-v2:'"), 'AWS frontend may persist only the versioned API response cache.');
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
assert.ok(output.includes("$('#workspaceEyebrow').hidden=ui.page==='account';"), 'account page hides the duplicate MY ACCOUNT eyebrow while keeping the bold title');
assert.ok(output.includes("cpu:'CPU'"), 'CPU profile-icon label uses the standard uppercase spelling');
assert.ok(output.includes('M12 11.65c-2.5 0-4.25-2.02-4.25-4.62') && !output.includes('M8.15 5.95') && output.includes('M9.05 11.25v1.12') && output.includes('C4.25 15.9 3 17.55 3 19.72V21h18v-1.28') && !output.includes('m9.25 14.18 2.75 2.27') && !output.includes('M4 21v-2a8 8 0 0 1 16 0v2'), 'User icon keeps its clean original head contour with the refined neck and shoulder silhouette, without hairline or collar details');
assert.ok(output.includes('const ICON_PALETTES = {'), 'profile icons use dedicated color palettes while retaining their source SVG paths');
for (const name of ['wrench','database','helmet','layers']) {
  assert.ok(output.includes(name+':{stroke:['), `color palette is defined for ${name}`);
}
assert.ok(output.includes("wrench:{stroke:['#536477','#DCE5EF','#77879B']"), 'Wrench uses a silver/chrome palette');
assert.ok(output.includes('compass:') && output.includes('circle cx="12" cy="12" r="10"') && output.includes('m16.2 7.8-2.7 5.7-5.7 2.7 2.7-5.7z') && !output.slice(output.indexOf('const ICON_PALETTES = {'),output.indexOf('let iconRenderSequence')).includes('compass:{') && !output.slice(output.indexOf('function icon(name,size=16){'),output.indexOf('\\nfunction ',output.indexOf('function icon(name,size=16){'))).includes("name==='compass'"), 'Compass is restored to its original unfilled currentColor outline');
assert.ok(output.includes("cpu:'<rect") && output.includes('width="14" height="14" rx="2"') && !output.slice(output.indexOf('const ICON_PALETTES = {'),output.indexOf('};',output.indexOf('const ICON_PALETTES = {'))).includes('cpu:{'), 'CPU is restored to its original uncolored outline path and uses currentColor');
assert.ok(!output.slice(output.indexOf('const ICON_PALETTES = {'),output.indexOf('let iconRenderSequence')).includes('engineer:{') && output.includes("engineer:'<path d=\"M5.6 8.1C6 5 8.1 3.2") && output.includes('stroke=\"var(--accent)\"'), 'Engineer keeps the latest monochrome hard-hat SVG and uses the same single application-accent color as Compass');
assert.ok(output.includes("database:{stroke:['#3B82F6','#0F766E']") && output.includes("accent:['#A5F3FC','#22D3EE']"), 'Database uses a modern blue-indigo cylinder with aqua data rings');
const iconRendererStart=output.indexOf('function icon(name,size=16){');
const iconRendererEnd=output.indexOf('\\nfunction ',iconRendererStart);
const iconRenderer=output.slice(iconRendererStart,iconRendererEnd);
assert.ok(!iconRenderer.includes("name==='compass'"), 'Compass renders through the standard outline icon path without a color override');
assert.ok(!iconRenderer.includes("name==='cpu'"), 'CPU renders the original outline through the standard currentColor icon renderer');
assert.ok(iconRenderer.includes("if(name==='engineer')return") &&
          iconRenderer.includes('stroke=\"var(--accent)\"') &&
          output.includes("engineer:'<path d=\"M5.6 8.1C6 5 8.1 3.2"),
  'Engineer uses the latest single-color hard-hat SVG with the application accent stroke and no multicolor palette');
assert.ok(iconRenderer.includes('fill="none" stroke="#67E8F9"') &&
          iconRenderer.includes('middleRingPath=pathMatch[1].slice(middleStart)'),
  'Database cylinder and internal separator are styled as independent vector paths');
assert.ok(!output.slice(output.indexOf('const ICON_PALETTES = {'), output.indexOf('let iconRenderSequence')).includes('crown:{'), 'Crown is removed from the color palette and returns to its original currentColor outline');
assert.ok(!output.slice(output.indexOf('function icon(name,size=16)'), output.indexOf('\nfunction ', output.indexOf('function icon(name,size=16)'))).includes("name==='crown'") && output.includes("crown:'<path d=\"m3 7 5 5 4-8 4 8 5-5-2 12H5L3 7Z\"/><path d=\"M5 22h14\"/>"), 'Crown uses its untouched original shape without a special fill override');
assert.ok(output.includes("layers:{stroke:['#F0444C','#3295D9','#6658DA','#F28A19']"), 'Layers uses the former logo color palette');
assert.ok(output.includes("function icon(name,size=16)") && output.includes("stroke=\"url(#'+id+'-stroke)\""), 'the icon renderer applies SVG gradients to the existing vector paths');
assert.ok(output.includes('M14.7 6.3a5 5 0 0 0-6.4 6.4') &&
          output.includes('M5.6 8.1C6 5 8.1 3.2') &&
          output.includes('M3.8 13.2v-1.5a8.2 8.2'),
  'Wrench, Engineer, and Helmet silhouettes remain based on the original SVG geometry');
assert.ok(output.includes('networking:\'<image href="./network-icon.svg"'), 'Network profile icon renders the high-quality vector asset');
assert.ok(!output.includes("networking:'<circle cx=\"12\" cy=\"5\" r=\"2.5\""), 'old three-node network icon has been replaced');
const config = getRuntimeConfig(output);
assert.equal(config.cognito.userPoolId, 'us-east-1_Example123');
assert.equal(config.cognito.userPoolClientId, 'examplepublicclient123456789');
assert.equal(config.cognito.teamUserAttribute, 'custom:teamUserId');
assert.equal(config.apiBaseUrl, 'https://app-api.execute-api.us-east-1.amazonaws.com');
assert.ok(!('localAuth' in config), 'runtime config must not contain a local-auth switch');
assert.ok(!('dataMode' in config), 'runtime config must not contain a database-mode switch');
assert.ok(!('identityMap' in config.cognito), 'team identity must not be overridable by a browser-side map');
for (const asset of ['logo.svg', 'favicon.svg', 'favicon.png', 'favicon.ico', 'network-icon.svg']) {
  assert.deepEqual(await readFile('dist/' + asset), await readFile(asset), `AWS artifact includes the deployed ${asset} asset`);
}
const deployedLogo = await readFile('dist/logo.svg', 'utf8');
assert.ok(deployedLogo.includes('fill="#5b62e8"'), 'logo uses the application purple accent');
assert.ok(!deployedLogo.includes('#102e50'), 'logo no longer uses the low-contrast navy');
const deployedFavicon = await readFile('dist/favicon.svg', 'utf8');
assert.ok(deployedFavicon.includes('fill="#5b62e8"'), 'favicon uses the same application purple accent');
assert.ok(!deployedFavicon.includes('#102e50'), 'favicon no longer uses the low-contrast navy');

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
