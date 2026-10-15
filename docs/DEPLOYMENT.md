# Deployment runbook

This runbook describes the intended path from the repository to a live shared application. The frontend and AWS backend are deployed separately: **Amplify hosts the website; AWS SAM is the current target mechanism for the API and monitoring resources.** The actual console bootstrap already created for this project is recorded in [IMPLEMENTATION.md](IMPLEMENTATION.md).

> **AWS-only:** this repository has no demo sign-in, local database, seeded workspace, or offline data mode. The frontend requires the deployed Cognito/API configuration and fails closed without it. Never commit credentials or real Cognito subject mappings, and do not delete a stack as a way to clear data. The target SAM template retains the resources it creates.
>
> **Important current-state warning:** the console-created resources are only partly aligned with the target SAM schema. The existing pool is **us-east-1_7dYZw2Is6**; the console tables are **TeamFollowUp-Items**, **TeamFollowUp-Activity**, **TeamFollowUp-Users**, and **TeamFollowUp-Archive**. The Archive table's `archiveId` key and both GSIs (**GSI_ArchiveIndex**, **GSI_ArchiveRoot**) match the handler's Archive contract, but its provisioned billing mode differs from the template's on-demand setting, and it is not managed by CloudFormation. The default `TeamFollowUp` prefix means the SAM `ArchiveTable` would collide with this existing physical table. The template also creates its own Cognito pool plus **WorkItems**, **ActivityEvents**, and **UserProfiles** tables whose names/keys/indexes do not match the other console tables. **Do not follow Step 4 or configure the app against these tables until resource ownership, billing, Cognito, and the data model are reconciled.** Keep this document's stack-deployment steps as a target runbook, not as permission to deploy the current template.

## Deployment plan

1. Prepare tools, credentials, Region, and source checks.
2. Create the Amplify Hosting app and record its assigned HTTPS origin.
3. Deploy the SAM backend stack using that exact origin.
4. Create the six Cognito accounts and seed their DynamoDB team profiles.
5. Configure Amplify with the real Cognito/API outputs and publish the AWS-connected website.
6. Run the acceptance checklist and verify monitoring.

## 1. Prerequisites and environment setup

Have the following ready:

- Access to the private GitHub repository and permission to connect it to Amplify Hosting.
- An AWS account and a deployment role allowed to create/update the resources in `backend/template.yaml` through CloudFormation/SAM, including IAM roles and policies.
- A selected AWS Region. Keep the SAM stack, Cognito user pool, DynamoDB tables, and API in that same Region.
- Node.js 24, Python 3.12, AWS CLI v2, and AWS SAM CLI on the workstation used for deployment.
- Six valid team email addresses that can receive Cognito invitations or password-reset messages.
- Access to the Amplify console and permission to add branch environment variables.

Use a named AWS CLI profile or short-lived IAM Identity Center credentials rather than long-lived access keys where possible. Confirm the active account and Region before changing resources:

```bash
aws sts get-caller-identity
aws configure get region
```

If you use a named IAM Identity Center profile, sign in first (replace the profile name with your configured profile):

```bash
aws sso login --profile team-followup-dev
aws sts get-caller-identity --profile team-followup-dev
```

Avoid using the AWS root user for routine deployment.

**Shell note:** command examples use Bash syntax and are intended to be run from the repository root. On Windows, use Git Bash, WSL, or another Bash-compatible shell; alternatively, convert line continuations to PowerShell syntax before running the commands. Use the same AWS profile and Region throughout a deployment.

Keep separate environment stacks and prefixes, for example:

| Environment | Stack name | `TableNamePrefix` |
|---|---|---|
| Development/lab | `team-follow-up-dev` | `TeamFollowUpDev` |
| Production | `team-follow-up-prod` | `TeamFollowUpProd` |

The prefix must start with a letter or number and contain 3–20 letters, digits, dots, underscores, or hyphens. The prefix controls DynamoDB table names and several log/dashboard names; it does not select an AWS Region.

### Amplify build image

The included `amplify.yml` selects Node.js 24 with `nvm use 24`. In the Amplify console, select the **Amazon Linux 2023** build image (or a custom image that includes Node.js 24 and NVM) before the first successful frontend build. Do not use an older Amazon Linux 2 image that cannot provide the configured Node version. See the [Amplify build image guidance](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-general.html) if the build image needs changing.

## 2. Run checks before deployment

From the repository root:

```bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
python -m compileall -q backend/src backend/scripts scripts/test-infrastructure.py
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
```

The SAM commands require AWS SAM CLI, but do not create resources. Do not proceed if a command fails; fix the failure and rerun it. The GitHub Actions workflow runs the frontend regression tests, AWS-only build/config tests, backend unit tests, infrastructure contract tests, Python compilation, SAM validation, and SAM build. CI supplies non-production test values only to exercise the build; it does **not** deploy the SAM stack. A normal build of the release artifact requires the real Cognito/API values from the deployed stack, as shown in Step 6.

The built frontend is written to `dist/index.html`; Amplify publishes the `dist/` folder. The Lambda package is built from `backend/src/`, which contains both `handler.py` and its `requirements.txt`.

## 3. Create Amplify Hosting and record the website origin

Amplify must exist first because the backend CORS policy needs the final website origin. The frontend has no local/demo configuration, so its first build will intentionally fail until the real Cognito/API outputs are added in Step 6. Do not add placeholder AWS IDs or introduce a local mode to bypass this check.

1. Open **AWS Amplify → Create new app → Host web app** and connect the private GitHub repository.
2. Select the branch intended for this environment. Enable the Amazon Linux 2023 build image as described above.
3. Let Amplify register the branch and assign its default branch hostname. In the Amplify console, open the app’s **Domain management / branch domain** details and copy the exact HTTPS origin, for example `https://main.abc123.amplifyapp.com`. Keep only scheme and host—no path, query, or trailing slash. If a custom domain will be used, attach and validate it before deploying the backend, then use that final HTTPS origin.
4. The first Amplify build may fail with a message naming missing `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`, `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`, or `TEAM_FOLLOW_UP_API_BASE_URL`. This is expected before the backend exists; record the failed build, proceed with the origin, and return to Step 6 after deploying and seeding AWS resources.

## 4. Deploy Cognito, API Gateway, Lambda, DynamoDB, and CloudWatch

The SAM template provisions these resources; do not create duplicates manually. Use the exact Amplify origin from Step 3 for `AllowedOrigin`.

From the repository root:

```bash
sam build --template-file backend/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

In the guided prompts, use values like these:

| Prompt / parameter | Example or instruction |
|---|---|
| Stack name | `team-follow-up-dev` |
| AWS Region | The Region verified in Step 1 |
| `TableNamePrefix` | `TeamFollowUpDev` |
| `AllowedOrigin` | The exact HTTPS origin copied from Amplify |
| `LogRetentionDays` | `30` |
| `EnablePointInTimeRecovery` | `false` for this cost-controlled lab; enable only after an explicit cost/recovery decision |
| Confirm changes before deploy | `Y` |
| Allow SAM CLI to create IAM roles / capabilities | Accept the required IAM capability when prompted |

Review the CloudFormation change set before approving it. Use the same stack name, Region, and prefix when updating this environment. Do not deploy development parameters into a production stack.

The stack creates:

- A Cognito User Pool and a browser app client with no client secret.
- An API Gateway HTTP API with a Cognito JWT authorizer, exact-origin CORS, and access logs.
- A Python 3.12 Lambda with scoped DynamoDB permissions and JSON CloudWatch logs.
- Four on-demand, server-side-encrypted DynamoDB tables with the indexes used by the handler.
- CloudWatch log groups, a dashboard, and alarms for Lambda errors/throttles and API Gateway 5xx responses.

Point-in-time recovery is disabled by default in this repository's target template to match the current cost-controlled lab choice. Enabling it can incur charges. WorkItems, ActivityEvents, UserProfiles, Archive, and the SAM-managed Cognito User Pool use CloudFormation retain policies. Stack removal therefore does not remove those target-stack resources; see **Operations and recovery** before cleanup.

### Read the stack outputs

After SAM deployment, retrieve the output table:

```bash
aws cloudformation describe-stacks \
  --stack-name team-follow-up-dev \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table
```

Record these values securely in your deployment notes (not in Git):

- `CognitoUserPoolId`
- `CognitoUserPoolClientId`
- `ApiBaseUrl`
- `WorkItemsTableName`
- `ActivityEventsTableName`
- `UserProfilesTableName`
- `ArchiveTableName`
- `CloudWatchDashboardName`

Use the actual outputs for the chosen stack. Do not assume the default table prefix when another prefix was deployed.

## 5. Create and map the six Cognito users

1. Open **Amazon Cognito → User pools** and select the pool whose ID matches `CognitoUserPoolId`.
2. Create one account per team member, using a valid email address. Keep self-service sign-up disabled. Set each account’s administrator-managed custom attribute **`custom:teamUserId`** to exactly the ID shown below.
3. The role labels are display metadata only. They do not grant extra API permissions.

| Team ID | Display name | Role label |
|---|---|---|
| `u1` | Marwa | Team Leader |
| `u2` | Zyad | AWS Engineer |
| `u3` | Nadine | AWS Engineer |
| `u4` | Omar | AWS Engineer |
| `u5` | Haneen | AWS Engineer |
| `u6` | Dina | AWS Engineer |

Each team ID must map to exactly one Cognito account. The Lambda resolves the signed-in Cognito `sub` through the UserProfiles table; sign-in alone is not enough until that profile row exists.

### Seed UserProfiles from Cognito (recommended)

Use the script that reads real Cognito subjects directly, so you do not need to copy a subject by hand. Install the Python package if you have not already:

```bash
python -m pip install -r backend/requirements.txt
```

First run the dry-run command. Replace the sample values with stack outputs and the selected Region:

```bash
python backend/scripts/seed_user_profiles_from_cognito.py \
  --user-pool-id YOUR_COGNITO_USER_POOL_ID \
  --table YOUR_USER_PROFILES_TABLE_NAME \
  --region YOUR_AWS_REGION \
  --dry-run
```

Check that the output lists the six expected IDs and names with the correct enabled/disabled status. The script intentionally does not print Cognito `sub` values. Only after the mapping is correct, repeat the same command without `--dry-run` to write the six profile records.

The deployment operator needs `cognito-idp:ListUsers` on the selected pool and `dynamodb:BatchWriteItem` on the selected UserProfiles table. Do not grant these admin permissions to the application Lambda.

### Alternative: manually maintained mapping file

Prefer the Cognito-based script above. If an audited private mapping file is necessary, copy `backend/team-users.example.json` to a local ignored file such as `backend/team-users.private.json`, replace all placeholder subject values with real subjects, and keep that file out of Git. Validate before writing:

```bash
python backend/scripts/seed_user_profiles.py \
  --file backend/team-users.private.json \
  --table YOUR_USER_PROFILES_TABLE_NAME \
  --region YOUR_AWS_REGION \
  --dry-run
```

Remove `--dry-run` only after the six IDs, names, roles, and subjects are correct. The manual script overwrites the corresponding profile rows.

After seeding, wait until `GSI_CognitoSub` is `ACTIVE` and has propagated the writes before testing sign-in.

## 6. Switch Amplify to live shared-data mode

In **Amplify → App settings → Environment variables**, add the following variables to the exact branch you are deploying:

| Variable | Value |
|---|---|
| `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID` | Stack output `CognitoUserPoolId` |
| `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID` | Stack output `CognitoUserPoolClientId` |
| `TEAM_FOLLOW_UP_API_BASE_URL` | Stack output `ApiBaseUrl` |
| `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE` | `custom:teamUserId` (optional; this is the default) |

There is no data-mode flag, browser-side identity map, local sign-in flag, or local database switch. Cognito’s administrator-managed custom attribute is the source of the team ID mapping. These values are public browser configuration, not secrets. **Never add AWS access keys or an app-client secret to Amplify.**

Save the settings and trigger a new build/redeploy. The build fails unless the Cognito IDs and valid HTTPS API base URL are all present and valid. If you later change the Amplify branch URL or custom domain, update `AllowedOrigin` in the SAM stack and redeploy it before testing browser API calls.

## 7. Verify the deployed environment

Before inviting the team, use two separate browsers or sessions and at least two team accounts.

1. Sign in with a provisioned account and confirm the application loads instead of staying on the startup screen. An unmapped or disabled profile should be denied by the API.
2. Create a project and a job. Refresh and open the site in the second session; both items should appear there. If the data does not appear in the second session, verify the deployed Amplify environment variables, the API URL, and API/DynamoDB permissions; there is no browser database to fall back to.
3. Add a task and a follow-up under a project. Add follow-ups under a job and task. Confirm the API refuses invalid hierarchy combinations.
4. Edit a task’s name, assignee, status, priority, or due date. Confirm the action appears in Activity History and is attributed to the signed-in user.
5. Archive an item subtree. Verify the items appear in Archive and their existing activity history remains. Restore a valid parent/child selection and verify the hierarchy. If restore reports a conflict or partial result, refresh Archive and review which IDs were restored before retrying.
6. Request an API route without a valid Cognito access token. API Gateway should reject it. Also verify an authenticated but unmapped/disabled account cannot read team data.
7. Open the CloudWatch dashboard from `CloudWatchDashboardName`. Inspect Lambda logs at `/aws/lambda/<TableNamePrefix>-Api` and API access logs at `/<TableNamePrefix>/apigateway/access`.

For index status, use the exact table name from stack outputs:

```bash
aws dynamodb describe-table \
  --table-name YOUR_USER_PROFILES_TABLE_NAME \
  --query 'Table.GlobalSecondaryIndexes[*].[IndexName,IndexStatus]' \
  --output table
```

All required GSIs should be `ACTIVE`. Repeat for the other tables if a query or write fails during initial setup.

## 8. Releases, migration, and operations

### Frontend and backend releases

- **Frontend:** merge the reviewed change to the Amplify-connected branch. Amplify runs `amplify.yml` and publishes `dist/`; verify the Amplify build log after the commit.
- **Backend:** run the checks from Step 2, review the SAM/template changes, and redeploy with `sam build` and `sam deploy` using the existing stack name and environment-specific parameters. A passing GitHub Actions run validates/builds the template but does not apply a CloudFormation change set.
- Keep deployment environment values separate. Never run a dev stack command using production’s stack name/table prefix or vice versa.

### Backfill old application activity (only when upgrading an existing table)

New events automatically receive the application-wide timeline keys. An old table that was created before `GSI_ApplicationTimeline` existed may need a one-time backfill after the updated index is `ACTIVE`. Do not run this on a new empty table.

```bash
python backend/scripts/migrate_activity_application_index.py \
  --table YOUR_ACTIVITY_EVENTS_TABLE_NAME \
  --region YOUR_AWS_REGION \
  --dry-run
```

Check the projected number of rows. Then repeat without `--dry-run` to write the missing keys. The script is safe to rerun: it skips correctly indexed rows and fails clearly if a row is missing its required event ID or timestamp. The operator needs Scan and UpdateItem on that exact ActivityEvents table.

### Monitoring, backup, and cost

- Configure an SNS topic/subscription and add notification actions to the alarms if the team needs emails or paging. Alarms are created without notification actions by default.
- For this Free account plan lab, keep point-in-time recovery and optional backups disabled as currently configured. They are recovery features, not required for the demo, and can add charges. Revisit them only if the project's recovery requirements and budget change.
- Review regional pricing and enable AWS Budgets before production. DynamoDB on-demand reads/writes, point-in-time recovery, Cognito usage, Lambda/API requests, and CloudWatch ingestion/storage can all add costs.
- Access logs omit authorization headers and request bodies. Do not add secrets or sensitive work-item contents to logs.

### Removal and recovery caution

`DeletionPolicy: Retain` protects WorkItems, ActivityEvents, UserProfiles, Archive, and the Cognito User Pool from automatic deletion when the CloudFormation stack is removed or resources are replaced. Stack deletion is **not** a cleanup method and retention is not a backup. Before intentionally removing an environment, export/backup data, identify retained resources, and confirm which tables and user pool should be permanently deleted.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Amplify build fails before publishing | Confirm Amazon Linux 2023/Node 24 and all three required AWS settings: `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`, `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`, and `TEAM_FOLLOW_UP_API_BASE_URL`. Read the exact failed build step. |
| Site is not available after the first failed Amplify build | This is expected until Step 6. Confirm the three real AWS variables were saved to the correct branch, then trigger a new build. The application has no local/demo mode. |
| Cognito accepts credentials but the app says the account is not linked | Check the user’s `custom:teamUserId`, matching UserProfiles row, correct `cognitoSub`, `enabled=true`, and `GSI_CognitoSub` status. |
| API returns 401 or 403 | A 401 indicates missing/invalid access token; a 403 generally indicates no enabled profile mapping. Verify the deployed pool/client IDs and JWT issuer/audience. |
| Browser reports CORS | Confirm `AllowedOrigin` exactly matches the browser’s HTTPS origin, then redeploy SAM. Do not use `*`. |
| DynamoDB permission or transaction error | Check the Lambda execution role policies, all table names injected into the function, and GSI readiness. The Lambda has transactional write access on WorkItems/ActivityEvents/Archive and only a batch-write recovery permission on ActivityEvents. |
| Application-wide history is missing old entries | If this is an upgraded table, wait for `GSI_ApplicationTimeline` to become active and run the migration dry-run from Step 8. |
| A restore reports a conflict or partial restore | Refresh Archive, inspect the response’s restored IDs and current active items, then retry only the still-archived selection. Do not blindly repeat the entire selection. |
