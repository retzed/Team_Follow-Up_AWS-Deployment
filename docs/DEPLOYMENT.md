# Deployment runbook — AWS Console first

This is the primary deployment guide. **Create and configure AWS resources through the AWS Management Console. Do not use `sam deploy` for the project’s normal deployment workflow.** The repository retains `backend/template.yaml` as an optional full-stack CloudFormation/SAM automation reference for a fresh environment. The template now creates resources from scratch; it no longer accepts existing Cognito IDs or table names.

This runbook documents both the complete target configuration and the current account checkpoint. The current account record says a Cognito pool/client, four DynamoDB tables, and the monthly cost budget have already been created manually in `us-east-1`. For that account, **inspect and reuse matching resources—do not create duplicates**. When setting up another environment from zero, follow the creation steps below.

## Deployment order

1. Confirm the AWS account and Region.
2. Create or verify Cognito (pool, custom attribute and public app client).
3. Create or verify the four DynamoDB tables and five GSIs.
4. Create or verify the monthly cost budget.
5. Create administrator-managed team accounts and seed their DynamoDB profile mappings.
6. Create Amplify Hosting and record its exact branch HTTPS origin.
7. Create the Lambda execution role/policy, package and deploy the Lambda function.
8. Create the API Gateway HTTP API, JWT authorizer, integration/route, CORS and access logs.
9. Complete Amplify environment variables and publish a successful frontend build.
10. Configure CloudWatch dashboard/alarms and run the end-to-end acceptance checks.

The API CORS origin depends on the final Amplify branch URL, so the hosting app is created before the API. Its first build may fail because the API URL is not known yet; enter the final variables after the API is available and then rerun the build.

## 1. Account, Region and tools

Use **US East (N. Virginia), `us-east-1`** for all regional application resources. Verify the selected account in the AWS Console before making changes. Avoid routine use of the root user; use an administrator identity for provisioning and a separate application Lambda role for runtime access.

The source build uses Node.js 24; the backend runtime is Python 3.12. For local packaging and validation, use Node.js 24, Python 3.12, AWS CLI v2 and (optionally) the AWS SAM CLI. SAM is not needed to create resources in the console.

## 2. Amazon Cognito — create or verify

### User Pool

In **Amazon Cognito → User pools**, create a user pool with these target settings (for the current account, select the existing pool and verify instead of creating another):

| Setting | Target |
|---|---|
| Pool name | `TeamFollowUp-Cognito` (must match the automation template's default name) |
| Sign-in identifier | Email |
| Self-registration | Disabled; only administrator-created users |
| Auto-verified attribute | Email (keep the console-created pool setting aligned with the template) |
| MFA | Off for the current low-cost lab configuration |
| Custom schema attribute | `teamUserId`, type String, minimum length 1, maximum length 32, Mutable enabled |

For a completely new manual environment, use `TeamFollowUp-Cognito` as the pool display name so it matches the optional template's default. The current-account snapshot records the already-created pool display name as `User pool - fnzspt`; keep and configure that pool by its actual pool ID rather than replacing it just to change its display name. Pool display names do not affect frontend integration. Cognito APIs and the application refer to the custom attribute as `custom:teamUserId`. Creating the schema attribute does **not** assign values to users. There is no requirement to configure Cognito managed login/hosted UI or hosted-login callback URLs for this app; the frontend uses direct SRP sign-in through the Cognito client SDK.

### Public app client

Create an app client named **`Team_FollowUp`** in the pool:

- Generate client secret: **off** (this is a browser/public client).
- Authentication flows: enable **SRP** (`ALLOW_USER_SRP_AUTH`) and refresh tokens (`ALLOW_REFRESH_TOKEN_AUTH`).
- Read attributes: include `email`, `email_verified`, and `custom:teamUserId`.
- Write attributes: do **not** include `custom:teamUserId`. The target template explicitly limits browser writes to `email`.
- Prevent user-existence errors: enabled.
- Keep self-registration disabled at the pool. User accounts are provisioned by a trusted administrator.

If more app clients exist in the pool, ensure none of them can write `custom:teamUserId`. The current operator confirmed Read enabled and Write disabled for the `Team_FollowUp` client on 15 October 2026; permission settings on other clients remained unverified in the implementation snapshot. Record the pool ID and app-client ID privately; they are public frontend configuration values, but must not be guessed or replaced by a client secret.

## 3. DynamoDB — target physical schema

Create each indexed table and wait for its table and indexes to reach **ACTIVE** before creating another indexed table. This avoids concurrent index-build limits and makes the deployment easier to troubleshoot. For the present account, inspect the four existing tables and retain them if they match this contract.

Common target settings for every table:

- Table class: **Standard**.
- Capacity mode: **Provisioned**, base table **1 RCU / 1 WCU**.
- Each GSI: **1 RCU / 1 WCU**, projection **All**.
- Auto scaling: off. Point-in-time recovery: off. Deletion protection: off. Streams: off.
- Encryption: AWS-owned default DynamoDB encryption key.
- Do not add extra indexes; both the handler and contract tests target this exact model.

### 3.1 `TeamFollowUp-Items`

Create a table with partition key **`itemId` (String)**, no sort key.

| GSI name | Partition key (String) | Sort key (String) | Projection | Capacity |
|---|---|---|---|---|
| `ParentIdIndex` | `parentId` | `createdAt` | All | 1 RCU / 1 WCU |
| `AssignedToIndex` | `assignedTo` | `updatedAt` | All | 1 RCU / 1 WCU |
| `WorkspaceIndex` | `workspaceKey` | `createdAt` | All | 1 RCU / 1 WCU |

The API stores project/job roots with `workspaceKey=WORKSPACE`, child items with `parentId`, and copies the business `ownerId` value into `assignedTo` to support the assignment index. Those helper attributes are maintained by Lambda, not trusted from browser input.

### 3.2 `TeamFollowUp-Activity`

- Partition key: **`itemId` (String)**.
- Sort key: **`activityKey` (String)**.
- No GSIs.

The sort key is an ISO timestamp plus `#` plus unique event ID. `eventId` is an ordinary attribute, not the primary key. Per-item history uses Query. Application-wide history scans this table because there is intentionally no Activity GSI.

### 3.3 `TeamFollowUp-Users`

- Partition key: **`userId` (String)**.
- No sort key or GSIs.

This table stores the team profile, enabled state, descriptive role, and Cognito `sub` in `cognitoSub`. Lambda scans this deliberately small team table for identity resolution, and denies missing, duplicate or disabled mappings. Do not add a GSI unless the schema, costs, handler, template and tests are changed together.

### 3.4 `TeamFollowUp-Archive`

Create the table with partition key **`archiveId` (String)**, no sort key.

| GSI name | Partition key (String) | Sort key (String) | Projection | Capacity |
|---|---|---|---|---|
| `GSI_ArchiveIndex` | `archivePK` | `archiveSort` | All | 1 RCU / 1 WCU |
| `GSI_ArchiveRoot` | `archiveRootPK` | `archiveRootSort` | All | 1 RCU / 1 WCU |

The target total is four base tables and five GSIs: **9 RCUs and 9 WCUs**. This is a provisioned capacity configuration, not a guarantee of free usage or immunity from throttling.

## 4. AWS Budgets cost monitor — create or verify

In **Billing and Cost Management → Budgets**, create a **monthly cost budget**:

| Setting | Value |
|---|---|
| Name | `TeamFollowUp-Monthly-Cost` |
| Amount | USD $1 |
| Period | Monthly recurring |
| Cost metric | Unblended cost (use the equivalent option shown by the console) |
| Alert thresholds | Actual 50%, 80%, and 100%; forecast 100% |
| Notification | Email to an address supplied privately in the console |

The notification budget warns about spend; it is not a spending cap, does not stop resources, and does not guarantee that all costs are covered by free-tier benefits or credits. Do not record the recipient's email address in GitHub or this document. The current account record says this budget already exists; verify it instead of creating a duplicate.

## 5. Create administrator-managed team accounts and profiles

Create one Cognito account for each team member through Cognito's administrator user-management interface. Assign exactly one unique custom team ID to each account:

| `custom:teamUserId` | Display name | Role label |
|---|---|---|
| `u1` | Marwa | Team Leader |
| `u2` | Zyad | AWS Engineer |
| `u3` | Nadine | AWS Engineer |
| `u4` | Omar | AWS Engineer |
| `u5` | Haneen | AWS Engineer |
| `u6` | Dina | AWS Engineer |

Role labels are descriptive only; they do not grant extra privileges. The assigned `custom:teamUserId` value must match the profile table's `userId`. The sign-in screen's username field accepts the account's email sign-in identifier.

After creating users, seed the `TeamFollowUp-Users` rows. Preferred method is the repository's trusted administration script: it resolves each user's Cognito `sub` without printing those values, supports dry-run first, and writes profiles only after validation. From the repository root, install the Python dependency:

    python -m pip install -r backend/requirements.txt

Dry-run:

    python backend/scripts/seed_user_profiles_from_cognito.py --user-pool-id <POOL_ID> --table TeamFollowUp-Users --region us-east-1 --dry-run

Review the six expected IDs/names and mapping results. Only then repeat without `--dry-run`. This script is an administrative data-seeding tool, not an infrastructure deployment method. Use credentials with Cognito ListUsers and DynamoDB BatchWriteItem access to the Users table; do not grant those privileges to Lambda. Never commit the real Cognito subject values or account details.

## 6. Amplify Hosting — create through the console

1. Open **AWS Amplify → Create new app → Host web app**, name the app `TeamFollowUp-frontend`, and connect the private GitHub repository `retzed/Team_Follow-Up_AWS-Deployment`.
2. Select the intended branch (normally `main`). Use the Amazon Linux 2023 build image or a compatible image with Node.js 24; the repository's `amplify.yml` invokes `nvm use 24`.
3. Keep the repository build settings from `amplify.yml`: run `node scripts/build.mjs`, publish `dist/`.
4. Record the exact branch HTTPS URL, for example `https://main.<generated-app-domain>`. The CORS origin must be only the origin (scheme + host), with no path or trailing slash.
5. A first build may fail until `TEAM_FOLLOW_UP_API_BASE_URL` is available. Continue with backend creation, then configure all environment variables in Step 9 and trigger a fresh build.

## 7. Create and configure the Lambda function through the console

### 7.1 Create the execution role

Create an IAM role named **`TeamFollowUp-Api-ExecutionRole`** for the **Lambda** service. This is the same default role name created by the optional full-stack template. Attach the AWS managed policy **`AWSLambdaBasicExecutionRole`** for CloudWatch logging. Add an inline policy based on [`backend/console-lambda-policy.json`](../backend/console-lambda-policy.json). Replace its account-ID placeholder and, if you deliberately use another table prefix, update all four table names consistently before saving. The custom policy is intentionally scoped to the four tables and indexes used by the handler; it does not grant Cognito administration or broad DynamoDB CRUD access. The template creates the same named role with an equivalent trust policy, managed logging policy and table-scoped DynamoDB permissions.

### 7.2 Package the handler ZIP

From the repository root on a Windows machine with Python 3.12 and PowerShell:

```powershell
$package = Join-Path $PWD ".lambda-package"
if (Test-Path $package) { Remove-Item $package -Recurse -Force }
New-Item -ItemType Directory -Path $package | Out-Null
python -m pip install -r backend/src/requirements.txt -t $package
Copy-Item backend/src/handler.py $package
if (Test-Path backend/TeamFollowUp-Lambda.zip) { Remove-Item backend/TeamFollowUp-Lambda.zip -Force }
Compress-Archive -Path "$package\*" -DestinationPath backend/TeamFollowUp-Lambda.zip -Force
```

The ZIP root must contain `handler.py` and the installed dependencies directly, not a parent source folder. Keep the generated ZIP and package directory out of commits; they are deployment artifacts.

### 7.3 Create the function

In **AWS Lambda → Create function → Author from scratch**, use:

| Setting | Value |
|---|---|
| Function name | `TeamFollowUp-Api` |
| Runtime | Python 3.12 |
| Execution role | The role created above |
| Memory | 256 MB |
| Timeout | 20 seconds |
| Handler | `handler.lambda_handler` |

Upload `backend/TeamFollowUp-Lambda.zip` as the function code. Set these environment variables:

| Key | Value |
|---|---|
| `ITEMS_TABLE` | `TeamFollowUp-Items` |
| `ACTIVITY_TABLE` | `TeamFollowUp-Activity` |
| `USERS_TABLE` | `TeamFollowUp-Users` |
| `ARCHIVE_TABLE` | `TeamFollowUp-Archive` |
| `LOG_LEVEL` | `INFO` (optional; this is the handler default) |

Create the CloudWatch log group `/aws/lambda/TeamFollowUp-Api` and set retention to **30 days**. If the function created its log group automatically, open it and change the retention. The execution role needs its standard logging actions.

## 8. API Gateway HTTP API — create through the console

Create an **HTTP API** named `TeamFollowUp API`, add the Lambda function as its integration, and configure the following target:

| Setting | Value |
|---|---|
| API protocol | HTTP API |
| Route | `ANY /{proxy+}` (all application endpoints share the Lambda handler) |
| Stage | `$default`, auto-deploy enabled |
| JWT authorizer name | `CognitoJwt` |
| Identity source | `$request.header.Authorization` |
| Issuer URL | `https://cognito-idp.us-east-1.amazonaws.com/<POOL_ID>` |
| Audience | The `Team_FollowUp` app-client ID |
| Route authorization | Attach `CognitoJwt` to the application route(s); no application data route should be anonymous |

For the API's CORS settings, specify the exact Amplify branch origin copied in Step 6, not `*`:

- Allowed origin: `https://<branch>.<generated-amplify-domain>` (scheme and host only).
- Allowed headers: `authorization`, `content-type`.
- Allowed methods: `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS`.
- Max age: 600 seconds. Do not enable credentialed cookie CORS.

Enable access logging on the `$default` stage to a log group such as `/TeamFollowUp/apigateway/access`, with 30-day retention. A compact JSON access-log format can include request ID, source IP, request time, HTTP method, route key, status, protocol, response length, and integration error message. Do not log authorization headers or tokens.

After saving, copy the API's HTTPS invoke URL without a route path. This is the value for `TEAM_FOLLOW_UP_API_BASE_URL`.

## 9. Configure Amplify build variables and publish

In **Amplify → App settings → Environment variables**, set these values for the deployed branch:

| Variable | Value |
|---|---|
| `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID` | The actual User Pool ID from Step 2 |
| `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID` | The `Team_FollowUp` public app-client ID |
| `TEAM_FOLLOW_UP_API_BASE_URL` | API Gateway HTTPS invoke URL from Step 8, origin only |
| `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE` | `custom:teamUserId` |

Save and trigger a new build. A successful build should publish `dist/index.html`. These frontend values are public browser configuration, not secrets. Do not place AWS access keys, GitHub tokens, Cognito client secrets or real Cognito subject mappings in Amplify variables.

If the Amplify branch hostname changes, update the API CORS origin before relying on cross-origin browser requests.

## 10. CloudWatch dashboard and alarms

Create these alarms in **CloudWatch → Alarms → Create alarm**. Use statistic **Sum**, period **5 minutes (300 seconds)**, evaluation periods **1**, threshold **greater than or equal to 1**, and missing data **not breaching** for all three.

| Alarm | Namespace / metric | Dimensions | Threshold |
|---|---|---|---|
| `TeamFollowUp-Lambda-Errors` | `AWS/Lambda` / `Errors` | FunctionName = `TeamFollowUp-Api` | At least 1 error |
| `TeamFollowUp-Lambda-Throttles` | `AWS/Lambda` / `Throttles` | FunctionName = `TeamFollowUp-Api` | At least 1 throttle |
| `TeamFollowUp-ApiGateway-5xx` | `AWS/ApiGateway` / `5xx` | ApiId = created API ID; Stage = `$default` | At least 1 server error |

The dashboard `TeamFollowUp-Operations` should include three time-series widgets: (1) Lambda Invocations, Errors and Throttles; (2) API Gateway Count and 5xx; and (3) Lambda Duration using p95. Alarm actions are not configured for email by default; the cost budget's email notifications are separate. Confirm log groups retain logs for 30 days.

## 11. Acceptance checklist

Use two independent team accounts in separate browsers or sessions:

1. A mapped, enabled user can sign in. Unknown, duplicate or disabled profile mappings are denied.
2. Create a Project and Job, then verify both appear after a refresh and in the second session.
3. Add Tasks and Follow-ups only under allowed parent types; attempt invalid parent-child combinations through the API and confirm the backend rejects them.
4. Edit title, description, priority, status, due date and assignee; verify activity events identify the authenticated actor.
5. Archive an item with descendants, confirm active items disappear and archive rows remain, then restore and verify relationships.
6. Verify selected-item and all-activity history, search/filter behavior, English/Arabic mode, dark/light mode, and mobile layout.
7. Send an unauthenticated API request and confirm the JWT authorizer denies it. Check CORS from the exact Amplify origin.
8. Inspect Lambda/API logs, the dashboard and alarm state. Confirm the budget notifications are configured but do not treat the budget as a spending limit.

## 12. Optional full-stack automation reference (not the primary method)

`backend/template.yaml` is a **complete from-scratch stack**, not a backend-only deploy. It creates the Cognito pool/client, four DynamoDB tables and five GSIs, Lambda/API/IAM, CloudWatch logs/dashboard/alarms, Amplify app/branch, and the $1 monthly budget. Its default `ResourceNamePrefix=TeamFollowUp` produces the same DynamoDB names used above.

**Do not deploy it with the default prefix into the current account/Region while the manually created resources of the same names exist.** CloudFormation will not automatically adopt them. To experiment with automation without colliding with the current account, use a clean environment or select a unique prefix; the generated Cognito IDs and API/Amplify hostnames will be new.

Optional validation/build only (these commands do not create AWS resources):

    python -m pip install -r backend/requirements-dev.txt
    npm run test:all
    python -m compileall -q backend/src backend/scripts scripts/test-infrastructure.py
    sam validate --lint --template-file backend/template.yaml
    sam build --template-file backend/template.yaml

For the alternative full-stack deployment, `sam deploy --guided --template-file backend/template.yaml` prompts for `ResourceNamePrefix`, `RepositoryUrl`, `GitHubAccessToken`, `FrontendBranchName`, and `BudgetNotificationEmail`. The token needs access to the private GitHub repository for Amplify. Both the token and budget email are deployment-time values; **do not commit them or save their values in `samconfig.toml`**. When the guided deploy asks to save parameters to configuration, answer no if sensitive values would be persisted. The template marks both parameters `NoEcho`, but the budget recipient is necessarily configured on the AWS Budget resource itself.

Review the CloudFormation changeset before approval. The template uses `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` for the four DynamoDB tables so deleting/replacing the stack will not automatically delete table data; retained tables must be handled deliberately before recreating resources with the same names. A successful `sam validate`, `sam build`, or GitHub Actions run validates syntax/package contracts only and is not proof that AWS resources were deployed successfully.

## 13. Troubleshooting and maintenance

| Symptom | What to check |
|---|---|
| Frontend build fails on missing configuration | Verify all four Amplify environment variables are set for the correct branch, then start a fresh build. |
| Browser CORS error | Check the HTTPS origin exactly (scheme and host only), allowed methods/headers and API stage settings. Do not use `*` as a routine fix. |
| API responds 401/403 | Verify JWT issuer uses the pool ID, audience is the app-client ID, Authorization header is a bearer access token, and the correct authorizer is attached to all data routes. |
| Authenticated requests are denied | Confirm the Cognito `custom:teamUserId` is unique and agrees with the enabled Users-table profile; inspect Lambda logs without exposing tokens or PII. |
| Lambda cannot access DynamoDB | Check function environment variables, table names, execution role policy ARNs and GSI status. Do not attach broad DynamoDB CRUD policies as a shortcut. |
| Activity history is slower as data grows | Global activity intentionally uses Scan; review data volume and capacity before considering any schema/index migration. |
| CloudWatch logs not retained | Confirm each log group's retention is explicitly set to 30 days. |
| Cost alert arrives | Treat it as a warning, inspect Billing/Cost Explorer and credits, and stop/delete unneeded billable resources through the console. A $1 budget does not enforce a cap. |

For production use, reevaluate DynamoDB capacity, point-in-time recovery, alarms/action notifications, identity governance and backup/recovery objectives before increasing data volume or exposing the application to a larger team.
