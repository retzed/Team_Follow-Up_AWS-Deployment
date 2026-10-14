# Deployment runbook

This runbook deploys the application using the agreed services: **Amplify Hosting, Cognito, Python Lambda, API Gateway HTTP API, DynamoDB, and CloudWatch**. The backend is deployed through AWS SAM; Amplify builds and hosts the browser UI from GitHub.

## 1. Prerequisites

- AWS account and an administrator/deployer role with permissions to create SAM/CloudFormation, Cognito, API Gateway, Lambda, DynamoDB, CloudWatch, and IAM resources.
- GitHub repository containing this package; a private repository is preferred for internal team data.
- AWS CLI v2, AWS SAM CLI, Node.js 20+, and Python 3.12 on the admin workstation.
- Six team users with email addresses able to receive Cognito invitations/password-reset messages.

Choose the AWS Region first. Use a distinct `TableNamePrefix` per environment (for example, `TeamFollowUpDev` and `TeamFollowUpProd`) to avoid resource-name collisions. Protect the production branch in GitHub.

## 2. Run checks before deployment

From the repository root:

```bash
npm test
npm run build
python -m pip install -r backend/requirements-dev.txt
python -m unittest discover -s backend/tests -v
python scripts/test-infrastructure.py
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
```

Do not proceed if any check fails. SAM packages the Python dependency list at `backend/src/requirements.txt` because that folder is the Lambda `CodeUri`.

## 3. Create the Amplify Hosting app and identify the final origin

1. Push the project to GitHub.
2. In the AWS Amplify console, choose **New app → Host web app**, connect GitHub, choose this repository, and select the deployment branch.
3. Before deploying the backend, add these temporary Amplify environment variables:

   | Variable | Value |
   |---|---|
   | `TEAM_FOLLOW_UP_DATA_MODE` | `builtin` |
   | `TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED` | `false` |

   This keeps the hosted page fail-closed while Cognito/API resources are being configured. Sign-in should remain unavailable during this temporary stage. Do not turn on the local demo password fallback for an internet-facing site.
4. Let Amplify provision the app/branch domain and copy the exact origin, for example `https://main.abc123.amplifyapp.com`. Use the origin only: no trailing slash, path, or query string. If you use a custom domain, use that final domain instead.

## 4. Deploy Cognito, API, Lambda, DynamoDB, and CloudWatch

The template provisions a Cognito User Pool and public app client, so you do not need to create them separately. `AllowedOrigin` intentionally has no default; supply the exact Amplify origin found in Step 3.

```bash
sam build --template-file backend/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

During the guided prompts, use values similar to:

| Parameter | Suggested value |
|---|---|
| Stack name | `team-follow-up-dev` |
| AWS Region | Your chosen Region |
| `TableNamePrefix` | `TeamFollowUpDev` |
| `AllowedOrigin` | Exact HTTPS Amplify origin |
| `LogRetentionDays` | `30` |
| `EnablePointInTimeRecovery` | `true` for team/production data; use `false` only for a disposable lab if accepting the recovery trade-off |
| `Confirm changes before deploy` | `Y` |
| `Allow SAM CLI IAM role creation` / capabilities | Accept `CAPABILITY_IAM` when prompted |

Review the CloudFormation changeset before approving it. The stack creates:

- Cognito User Pool: self-service registration disabled; username sign-in, verified email recovery, optional software-token MFA, password policy, and `custom:teamUserId` attribute.
- Public Cognito browser app client: `GenerateSecret=false`; SRP sign-in and refresh-token flow.
- API Gateway HTTP API: Cognito JWT authorizer, exact-origin CORS, and JSON access logs.
- Python Lambda: runtime Python 3.12, table-specific DynamoDB policies, explicit `TransactWriteItems` permission, JSON CloudWatch logs.
- Four encrypted, on-demand DynamoDB tables with the secondary indexes required by the handler.
- CloudWatch log groups with retention, Lambda/API 5xx alarms, and an operations dashboard.

The four DynamoDB tables and Cognito user pool use `DeletionPolicy: Retain`; stack deletion does not erase application data or user accounts. Point-in-time recovery is enabled by default and may incur charges.

Retrieve the outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name team-follow-up-dev \
  --query 'Stacks[0].Outputs' \
  --output table
```

Record these outputs for the next steps: `CognitoUserPoolId`, `CognitoUserPoolClientId`, `ApiBaseUrl`, `UserProfilesTableName`, and `CloudWatchDashboardName`.

## 5. Create and map the six Cognito accounts

In the Cognito console, open the pool identified by `CognitoUserPoolId`. Create exactly one enabled account for each team member and supply a valid email address. Keep self-service sign-up disabled. Set each user's custom attribute **`custom:teamUserId`** as follows:

| Team ID | Display name | Role label |
|---|---|---|
| `u1` | Marwa | Team Leader |
| `u2` | Zyad | AWS Engineer |
| `u3` | Nadine | AWS Engineer |
| `u4` | Omar | AWS Engineer |
| `u5` | Haneen | AWS Engineer |
| `u6` | Dina | AWS Engineer |

Use lowercase or mixed-case usernames consistently; the pool is configured as case-insensitive. The role is display metadata, not an authorization privilege. The custom attribute should contain exactly the corresponding ID (`u1` … `u6`), not a display name. The browser client can read the attribute but cannot update it.

Then seed the user profile table from the actual Cognito subjects, so there is no hand-copying of `sub` values. Use the stack outputs and the same Region:

```bash
python -m pip install -r backend/requirements.txt
python backend/scripts/seed_user_profiles_from_cognito.py \
  --user-pool-id <CognitoUserPoolId> \
  --table <UserProfilesTableName> \
  --region <AWS_REGION> \
  --dry-run
```

Confirm that the dry run reports the expected six users. Then run the exact same command without `--dry-run` to write `TeamFollowUp-UserProfiles`. The operator's AWS identity needs Cognito `ListUsers` and DynamoDB `BatchWriteItem` permissions. Wait for the `GSI_CognitoSub` index to become `ACTIVE` and for its writes to propagate before testing login.

The legacy `backend/scripts/seed_user_profiles.py` remains available if you prefer a private JSON mapping file with actual Cognito `sub` values. Never commit that private mapping file.

## 6. Configure Amplify for the live backend

In Amplify Hosting → App settings → Environment variables, configure:

| Variable | Value |
|---|---|
| `TEAM_FOLLOW_UP_DATA_MODE` | `api` |
| `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID` | `CognitoUserPoolId` stack output |
| `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID` | `CognitoUserPoolClientId` stack output |
| `TEAM_FOLLOW_UP_API_BASE_URL` | `ApiBaseUrl` stack output, HTTPS base URL only |
| `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE` | `custom:teamUserId` |
| `TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED` | `false` |

Leave `TEAM_FOLLOW_UP_COGNITO_IDENTITY_MAP` unset; the provisioned custom Cognito attribute provides the client-side team ID mapping. These values are public browser configuration, not secrets. Do **not** add AWS access keys or an app-client secret to Amplify environment variables. Save and redeploy the branch so `scripts/build.mjs` generates a live API config in `dist/index.html`.

If you change the Amplify branch domain or custom domain later, update the backend stack's `AllowedOrigin` and redeploy it. The API deliberately allows one exact origin; it is not configured with a wildcard.

## 7. Smoke-test the deployed app

Use two separate browsers or sessions and at least two team accounts.

1. Sign in as `u1`/Marwa. Confirm the app starts and the signed-in identity matches the seeded profile.
2. Create a project and a job. Refresh the page and open the app from a second session; the new records should appear there too (proves live shared DynamoDB mode rather than browser-local storage).
3. Create a task under the project and a follow-up under the task; confirm a job can only have follow-ups.
4. Change a task's assignee, status, priority, and name. Confirm the activity event is present and attributed to the authenticated user.
5. Delete/archive an item subtree, confirm archive metadata and activity history remain, then restore the parent/child selection and confirm the hierarchy is preserved.
6. Attempt API access without a Cognito token and confirm API Gateway rejects the request. Confirm disabled/unmapped profiles cannot access the app/API.
7. Open the CloudWatch dashboard from `CloudWatchDashboardName`. Inspect Lambda logs at `/aws/lambda/<TableNamePrefix>-Api` and API Gateway access logs at `/<TableNamePrefix>/apigateway/access`.

The included CloudWatch alarms enter `ALARM` based on metrics but intentionally have no notification action. Configure an SNS topic/subscription and attach it to the alarms if alerts must reach the team.

## 8. Operations and recovery

- **Frontend release:** merge a tested PR to the Amplify branch; the `amplify.yml` build publishes `dist/`.
- **Backend release:** review template/code diffs, run the checks in Step 2, then `sam build` and `sam deploy` with the existing stack name and environment-specific prefix. Do not deploy `dev` parameters to `prod`.
- **Logs:** Lambda application logs avoid request bodies, auth tokens, and exception details in browser responses. API Gateway access logs intentionally exclude authorization headers.
- **Data recovery:** point-in-time recovery defaults to enabled. Use DynamoDB restore procedures under a planned recovery window; do not run destructive stack deletion to clean an environment.
- **Costs:** DynamoDB on-demand charges depend on reads/writes; Lambda/API Gateway are request-based; Cognito may charge based on active users/features; CloudWatch log ingestion/storage and PITR can add charges. Review current regional prices and budgets before production.
- **Deletion:** app tables and user pool are retained if the SAM stack is removed. Back up and explicitly delete retained resources only if you intend to permanently remove work items, history, archives, profiles, and Cognito accounts.

## Troubleshooting

- **Build reports local auth is enabled in API mode:** set `TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED=false` and redeploy.
- **Cognito login works but application says account is not linked:** check that the account's `custom:teamUserId` is `u1`–`u6`, the client is allowed to read it, and the matching profile row has the same `cognitoSub` and `enabled=true`.
- **API returns 403 after login:** check the subject-to-profile row, enabled flag, User Pool/client outputs, and API Gateway JWT issuer/audience configuration. Wait for GSI updates to propagate.
- **Browser reports CORS:** make sure `AllowedOrigin` exactly equals the browser URL origin (https, host, and optional port, without path or trailing slash), and redeploy the SAM stack.
- **Create/update/archive returns a database error:** confirm Lambda's role includes `dynamodb:TransactWriteItems` on WorkItems, Archive, and ActivityEvents, and that all GSIs are `ACTIVE`.
- **Old application-wide activity is absent after upgrading an existing database:** run `backend/scripts/migrate_activity_application_index.py` once against the old ActivityEvents table after the `GSI_ApplicationTimeline` index is active. New writes populate that index automatically.
