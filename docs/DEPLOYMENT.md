# Deployment runbook

This runbook deploys the shared Team Follow-Up application using AWS resources already created manually. Amplify hosts the frontend; AWS SAM deploys only the API/backend and monitoring resources.

> **Current contract:** the application uses the existing Cognito pool/client and four existing DynamoDB tables in **us-east-1**. SAM does not create, import, or manage Cognito or DynamoDB data resources. It creates API Gateway, Lambda, IAM, and CloudWatch resources only. The Activity table uses `itemId + activityKey`; the Users table has no Cognito-subject GSI. Do not restore the previous WorkItems/ActivityEvents/UserProfiles table design.

## Deployment order

1. Verify the already-added Cognito custom attribute's app-client permissions and the DynamoDB indexes.
2. Create/map the six Cognito team accounts and seed the existing Users table.
3. Create Amplify Hosting and copy its final HTTPS origin.
4. Run repository checks and deploy SAM against the existing resources.
5. Configure Amplify environment variables and publish the website.
6. Run the end-to-end acceptance checklist.

## 1. Check account, Region, and tools

Keep application resources in **US East (N. Virginia), `us-east-1`**. Use a named AWS CLI profile or short-lived credentials; avoid routine use of the root account.

    aws sts get-caller-identity
    aws configure get region

If using a named profile:

    aws sso login --profile team-followup-dev
    aws sts get-caller-identity --profile team-followup-dev

Install/use Node.js 24, Python 3.12, AWS CLI v2, and AWS SAM CLI. The included `amplify.yml` expects Node.js 24; select Amplify's **Amazon Linux 2023** build image or a compatible custom image.

The `TableNamePrefix` parameter names the API, Lambda, log groups, dashboard, and alarms only. It does not rename or provision the existing DynamoDB tables.

## 2. Verify the existing Cognito and DynamoDB resources

### Cognito — required manual checks

| Setting | Value |
|---|---|
| Existing User Pool ID | `us-east-1_7dYZw2Is6` |
| Existing app Client ID | `7id8c2g27fvbh365atqntqurir` |

In **Amazon Cognito → User pools**, select that exact pool and verify:

- The custom attribute `custom:teamUserId` appears in the schema. The operator confirmed it was added on **15 October 2026**; this repository has not queried the live AWS configuration.
- Its intended schema settings are **String**, minimum length **1**, maximum length **32**, and **Mutable** enabled.
- Under **App clients → Team_FollowUp → Attribute permissions → Edit**, enable **Read** and disable **Write** for `custom:teamUserId`. Ensure **Write** is disabled for this attribute on every other app client in the pool as well. The attribute is mutable at the pool level, so browser clients must not be allowed to change the team ID.
- The `Team_FollowUp` app client is a browser/public client with **no client secret** and supports the sign-in/token flow used by the frontend.
- Self-registration remains disabled.

If the attribute does not appear, first check that you selected the correct pool and Region; do not create a duplicate attribute under another name or create a second Cognito pool. Do not proceed to account setup or deployment until the app-client permissions are correct.

### DynamoDB — actual table contract

| Table | Primary key | Global secondary indexes |
|---|---|---|
| `TeamFollowUp-Items` | `itemId` (String) | `ParentIdIndex`, `AssignedToIndex`, `WorkspaceIndex` |
| `TeamFollowUp-Activity` | `itemId` (String) + `activityKey` (String) | None |
| `TeamFollowUp-Users` | `userId` (String) | None |
| `TeamFollowUp-Archive` | `archiveId` (String) | `GSI_ArchiveIndex`, `GSI_ArchiveRoot` |

Confirm all four tables are **ACTIVE**, and confirm the three Items indexes and two Archive indexes are **ACTIVE**. Activity and Users intentionally have no GSIs. The application-wide Activity endpoint scans Activity; Lambda scans the small Users table for the authenticated Cognito subject.

Inspect the live tables if needed:

    aws dynamodb describe-table --table-name TeamFollowUp-Items --region us-east-1 --query 'Table.{Status:TableStatus,Indexes:GlobalSecondaryIndexes[*].[IndexName,IndexStatus]}' --output json
    aws dynamodb describe-table --table-name TeamFollowUp-Archive --region us-east-1 --query 'Table.{Status:TableStatus,Indexes:GlobalSecondaryIndexes[*].[IndexName,IndexStatus]}' --output json
    aws dynamodb describe-table --table-name TeamFollowUp-Activity --region us-east-1 --query 'Table.{Status:TableStatus,Key:KeySchema}' --output json
    aws dynamodb describe-table --table-name TeamFollowUp-Users --region us-east-1 --query 'Table.{Status:TableStatus,Key:KeySchema}' --output json

The four base tables and five GSIs are provisioned at 1 RCU / 1 WCU each (9 RCUs / 9 WCUs total). These are provisioned-capacity settings, not a guarantee of zero cost.

## 3. Create Cognito accounts and seed team mappings

Create one administrator-managed account for each team member in the existing pool and set a unique `custom:teamUserId`:

| Team ID | Display name | Role label |
|---|---|---|
| `u1` | Marwa | Team Leader |
| `u2` | Zyad | AWS Engineer |
| `u3` | Nadine | AWS Engineer |
| `u4` | Omar | AWS Engineer |
| `u5` | Haneen | AWS Engineer |
| `u6` | Dina | AWS Engineer |

Role labels are descriptive only; they do not grant extra privileges. Each team ID must map to exactly one Cognito account. Adding the schema attribute does **not** populate it on any existing user; set the value separately on each account using the Cognito user-details editor or an administrator-controlled command. For example, to assign `u1` to a specific Cognito username:

    aws cognito-idp admin-update-user-attributes --user-pool-id us-east-1_7dYZw2Is6 --username "<exact-cognito-username>" --user-attributes Name=custom:teamUserId,Value=u1 --region us-east-1

Repeat with the correct Cognito username and unique value (`u2` through `u6`) for the other five accounts. Use trusted administrator credentials for this command; never put Cognito usernames or subject values into frontend configuration or commit them to the repository.

Install the Python dependency:

    python -m pip install -r backend/requirements.txt

First perform a dry run against the **existing** Users table:

    python backend/scripts/seed_user_profiles_from_cognito.py --user-pool-id us-east-1_7dYZw2Is6 --table TeamFollowUp-Users --region us-east-1 --dry-run

Verify that all six expected IDs/names appear with correct enabled states. Cognito subject values are not printed. Only after the dry run succeeds, repeat without `--dry-run` to write the mappings. This administrative script overwrites the matching six profile rows in `TeamFollowUp-Users`; review carefully before using the write command.

The operator needs `cognito-idp:ListUsers` on the existing pool and `dynamodb:BatchWriteItem` on `TeamFollowUp-Users`. Do not give those administrative permissions to the application Lambda.

The Lambda maps Cognito JWT `sub` to one enabled `userId` through the `cognitoSub` attribute. There is no Cognito-subject GSI; the scan is intentional for the small team table. Missing, duplicate, or disabled mappings should be denied.

## 4. Create Amplify Hosting and record the final origin

1. Open **AWS Amplify → Create new app → Host web app** and connect the private GitHub repository `retzed/Team_Follow-Up_AWS-Deployment`.
2. Select the intended branch and use the Amazon Linux 2023 build image with Node.js 24 support.
3. Copy the exact **HTTPS origin** (scheme + hostname only, no path/trailing slash). If using a custom domain, attach/validate it first and use that final origin.
4. The first build can fail before the API exists because `TEAM_FOLLOW_UP_API_BASE_URL` is not known yet. Record the Amplify origin and continue to backend deployment; return to Amplify configuration after Step 5.

## 5. Validate and deploy the backend

From the repository root:

    python -m pip install -r backend/requirements-dev.txt
    npm run test:all
    python -m compileall -q backend/src backend/scripts scripts/test-infrastructure.py
    sam validate --lint --template-file backend/template.yaml
    sam build --template-file backend/template.yaml

Fix every failure before proceeding. GitHub Actions runs similar checks but does not deploy resources or verify the live AWS environment.

Deploy the backend using the exact Amplify origin. In guided prompts, use these parameters:

| Parameter | Value/instruction |
|---|---|
| Stack name | `team-follow-up-dev` or a deliberately selected name |
| Region | `us-east-1` |
| `TableNamePrefix` | `TeamFollowUp` (API/log/dashboard names only) |
| `ExistingCognitoUserPoolId` | `us-east-1_7dYZw2Is6` |
| `ExistingCognitoAppClientId` | `7id8c2g27fvbh365atqntqurir` |
| `ExistingItemsTableName` | `TeamFollowUp-Items` |
| `ExistingActivityTableName` | `TeamFollowUp-Activity` |
| `ExistingUsersTableName` | `TeamFollowUp-Users` |
| `ExistingArchiveTableName` | `TeamFollowUp-Archive` |
| `AllowedOrigin` | Exact HTTPS origin copied from Amplify |
| `LogRetentionDays` | `30` |

Run:

    sam build --template-file backend/template.yaml
    sam deploy --guided --template-file .aws-sam/build/template.yaml

Review the CloudFormation change set before approving. **It should create API Gateway, Lambda, IAM, and CloudWatch resources only.** If it proposes a Cognito pool or any DynamoDB table, stop; that is the wrong template revision/parameter contract.

Retrieve outputs after deployment:

    aws cloudformation describe-stacks --stack-name team-follow-up-dev --region us-east-1 --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table

Record these outputs in private deployment notes (not Git): `CognitoUserPoolId`, `CognitoUserPoolClientId`, `ApiBaseUrl`, `ItemsTableName`, `ActivityTableName`, `UsersTableName`, `ArchiveTableName`, and `CloudWatchDashboardName`. The four table outputs report existing names; the stack does not own or configure their schema or capacity.

## 6. Configure Amplify for live data

In **Amplify → App settings → Environment variables**, set these values on the branch being deployed:

| Variable | Value |
|---|---|
| `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID` | Output `CognitoUserPoolId` (existing pool) |
| `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID` | Output `CognitoUserPoolClientId` (existing client) |
| `TEAM_FOLLOW_UP_API_BASE_URL` | Output `ApiBaseUrl` |
| `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE` | `custom:teamUserId` |

Save the settings and trigger a new build/redeploy. The frontend has no local/demo database or sign-in fallback. These are public browser configuration values; never add AWS access keys or a Cognito client secret to Amplify.

If the Amplify hostname changes later, update `AllowedOrigin` in the SAM stack and redeploy before testing browser API calls.

## 7. Verify the deployed environment

Use at least two accounts in separate browsers/sessions:

1. Sign in with a seeded team account. An unmapped or disabled profile should receive an authorization denial.
2. Create a project and a job. Refresh and verify both appear in the second session.
3. Add tasks/follow-ups under allowed parent types. Verify invalid hierarchy combinations are rejected.
4. Edit an item's name, assignee, status, priority, or due date. Confirm Activity History records the change and attributes it to the signed-in user.
5. Archive a subtree, verify it appears in Archive and previous activity remains, then restore a valid parent/child selection.
6. Request an API route without a valid Cognito access token and confirm API Gateway rejects it.
7. Open the dashboard from `CloudWatchDashboardName`. With the default prefix, Lambda logs are at `/aws/lambda/TeamFollowUp-Api` and API access logs at `/TeamFollowUp/apigateway/access`.

## 8. Releases, legacy migration, monitoring, and cost

### Releases

- **Frontend:** merge reviewed changes to the Amplify-connected branch. Amplify uses `amplify.yml` and publishes `dist/`.
- **Backend:** rerun Step 5 checks, review the template/change set, and deploy with `sam build` and `sam deploy`.
- Keep stack names/prefixes separate between environments. Each backend stack reuses the existing resources unless you intentionally change the parameter values.

### Legacy ActivityEvents migration warning

`backend/scripts/migrate_activity_application_index.py` targets a legacy schema with `eventId` as the table primary key and `GSI_ApplicationTimeline`. It is **not compatible** with the existing `TeamFollowUp-Activity` table, whose key is `itemId + activityKey` and which has no GSIs. Do not run the legacy script against `TeamFollowUp-Activity`. The current handler queries item-specific history and scans Activity for application-wide history.

### Monitoring, recovery, and cost

- SAM creates CloudWatch log groups, dashboard, and alarms for Lambda errors/throttles and API Gateway 5xx responses. Alarm notifications are not wired to email by default.
- Keep optional backups and point-in-time recovery disabled for this cost-controlled lab unless you explicitly approve the feature and its price.
- DynamoDB provisioned throughput, Cognito usage, Lambda/API requests, and CloudWatch log ingestion/storage can still incur charges. The $1 budget sends alerts; it does not cap spend. Check account credits separately in Billing.
- The existing Cognito pool and four DynamoDB tables are not managed by the backend CloudFormation stack. Removing the stack leaves them intact; this is not a backup. Plan data exports/backups separately.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Amplify build fails | Confirm Node.js 24/Amazon Linux 2023 and all three required environment variables: Cognito pool ID, app client ID, and HTTPS API URL. |
| Credentials work but app says account is not linked | Verify `custom:teamUserId` exists and is readable by the app client, then check that the matching `TeamFollowUp-Users` row has the correct `cognitoSub` and `enabled=true`. No Cognito-subject GSI is expected. |
| API returns 401/403 | 401 indicates a missing/invalid token; 403 generally means no enabled mapping. Verify JWT issuer/audience, custom attribute, and Users-table row. |
| Browser reports CORS | Confirm `AllowedOrigin` exactly matches the browser's HTTPS origin and redeploy SAM. Do not use `*`. |
| DynamoDB permission or transaction error | Check all four table-name parameters, the Lambda execution role, and ACTIVE status of Items/Archive indexes. Activity/Users do not have GSIs. |
| Global activity history is slow | The current Activity table has no timeline GSI, so application-wide history scans the table. Do not run the legacy ActivityEvents migration on it. |
| A restore reports a conflict or partial restore | Refresh Archive, inspect restored IDs/current active items, then retry only the still-archived selection. |
