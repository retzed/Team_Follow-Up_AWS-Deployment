# Team Follow-Up Application

An English/Arabic workspace for a team to manage projects, temporary jobs, tasks, and follow-ups. **This repository is AWS-only:** users sign in with Amazon Cognito and all application data is read from and written to DynamoDB through an authenticated API. There is no local authentication, demo database, offline data store, or browser-side work-data persistence.

> **Current account checkpoint (15 October 2026):** The Cognito pool/client, four DynamoDB tables (Items, Activity, Users and Archive), and monthly cost budget were reported as created manually in `us-east-1`. Amplify Hosting, API Gateway/Lambda and CloudWatch operational resources remained pending in the dated implementation snapshot. See the [implementation record](docs/IMPLEMENTATION.md) for current-account details. This status is a snapshot, not a prerequisite assumed by the architecture or automation template.

## Deployment approach

**Primary method: AWS Management Console.** Create and configure project AWS resources manually in the console. Do not use SAM to deploy resources as part of the normal project workflow. The [console deployment runbook](docs/DEPLOYMENT.md) is the operational guide.

**Optional automation reference: full-stack CloudFormation/SAM.** [`backend/template.yaml`](backend/template.yaml) is kept as an alternative way to provision a new environment from scratch. Follow the [step-by-step automated deployment runbook](docs/AUTOMATED_DEPLOYMENT.md) to prepare credentials, validate/build, review the changeset, deploy, seed team profiles, test, update, and clean up the stack. It creates a Cognito pool/client, all four DynamoDB tables and five GSIs, API Gateway HTTP API, Lambda and scoped IAM, CloudWatch log groups/dashboard/alarms, Amplify Hosting app/branch, and the $1 monthly cost budget. It no longer expects pre-existing Cognito IDs, DynamoDB tables, or a pre-known Amplify origin. The default prefix matches the console table names, so do **not** deploy it into the current account/Region while those manually created resources still exist. Use a fresh environment or a different prefix for template experiments.

## Start here

- **[AWS Console deployment guide](docs/DEPLOYMENT.md)** — primary creation/configuration workflow, team mapping, API/Lambda configuration and acceptance tests.
- **[AWS Console implementation record](docs/IMPLEMENTATION.md)** — dated record of resources reported as actually configured in the current AWS account.
- **[Architecture reference](docs/ARCHITECTURE.md)** — whole-system architecture, trust boundaries, data model and monitoring.
- **[Complete project documentation](docs/DOCUMENTATION.md)** — system analysis/design, diagrams, schema, UI/UX, API, testing, security and operations.
- **[DynamoDB schema reference](backend/table-schema.json)** — target physical keys, index names, capacity settings and separate current-account snapshot.
- **[Console Lambda IAM policy](backend/console-lambda-policy.json)** — least-privilege policy template to adapt for manual Lambda setup.
- **[Automated deployment runbook](docs/AUTOMATED_DEPLOYMENT.md)** — optional end-to-end SAM/CloudFormation deployment for a separate from-scratch environment.
- **[Release notes](RELEASE_NOTES.md)** — implementation and validation notes.

## Target architecture

- **Amplify Hosting** builds and serves the frontend from the GitHub branch using `amplify.yml`.
- **Cognito** authenticates members; a public app client reads but cannot write `custom:teamUserId`.
- **API Gateway HTTP API** validates the Cognito JWT issuer/audience, enforces exact-origin CORS and forwards JSON requests to Lambda.
- **Python 3.12 Lambda** validates hierarchy and caller identity, maintains server-owned index keys, writes audit history and implements archive/restore.
- **DynamoDB** stores active items, activity, team profiles and archived snapshots across four deliberately small, provisioned tables.
- **CloudWatch** collects API/Lambda logs and exposes a dashboard and alarms; **AWS Budgets** sends monthly cost-threshold notifications without stopping spend.

The implementation is described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The schema/access contract shared by the console procedure and full-stack template is in [`backend/table-schema.json`](backend/table-schema.json). In the target schema, Activity uses `itemId + activityKey`; Users uses `userId`; the handler scans Activity for application-wide history and Users for the matching Cognito subject because neither table has a GSI.

## Repository guide

- `index.html`: frontend source.
- `scripts/build.mjs`: generates `dist/index.html` and rejects missing/placeholder Cognito/API settings.
- `backend/src/handler.py`: Lambda request handling, identity mapping and DynamoDB access.
- `backend/template.yaml`: optional full-stack CloudFormation/SAM automation reference; it is not the primary console deployment path.
- `backend/table-schema.json`: shared schema contract and separate record of the current account's reported console state.
- `backend/console-lambda-policy.json`: policy template for manually creating the Lambda execution role.
- `backend/scripts/`: trusted administration scripts for profile seeding and legacy migration diagnostics.
- `docs/`: architecture, deployment, implementation snapshot and complete documentation.

## Local validation

Requirements: Node.js 24 and Python 3.12. Install backend test dependencies, then run the regression and infrastructure-contract checks:

```bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
npm run build
```

The frontend build requires public runtime settings. On Windows PowerShell:

```powershell
$env:TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID = "<actual-pool-id>"
$env:TEAM_FOLLOW_UP_COGNITO_CLIENT_ID = "<actual-public-client-id>"
$env:TEAM_FOLLOW_UP_API_BASE_URL = "https://<actual-api-id>.execute-api.us-east-1.amazonaws.com"
$env:TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE = "custom:teamUserId"
npm run build
```

For optional template validation only, install the AWS SAM CLI and run:

```bash
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
```

**These commands validate/build artifacts only; they do not create AWS resources.** GitHub Actions follows the same principle and never deploys to an AWS account. To use the optional full-stack template as an automation method, follow its section in [the runbook](docs/DEPLOYMENT.md), supply GitHub-token and budget-email parameters privately, and use a clean environment or a distinct resource prefix. Never save those sensitive parameter values in `samconfig.toml` or commit credentials.

## Amplify public environment variables

The console-first Amplify branch needs these values before a successful frontend build:

- `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`
- `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`
- `TEAM_FOLLOW_UP_API_BASE_URL`
- `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE=custom:teamUserId` (the default)

They are public browser configuration values, not secrets. Do not add AWS credentials, GitHub access tokens, Cognito client secrets, real Cognito `sub` values, or billing-recipient email addresses to source files or Amplify environment variables. A passing CI run is evidence of code/build-contract validation only, not proof of a live AWS deployment.
