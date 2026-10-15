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

## System requirements and development setup

### Hardware recommendations

A normal modern development computer is sufficient. As a practical starting point, use at least 2 CPU cores, 4 GB RAM, and 1 GB of free disk space for the repository, Python environment, test outputs, and SAM build artifacts. These are recommendations, not enforced minimums. No GPU is required.

### Required and optional software

- **Git** — clone the repository and manage source changes.
- **Node.js 24.x and npm** — run JavaScript syntax, API, UI regression, and build scripts. The project currently declares no third-party npm dependencies, so `npm install` is not required.
- **Python 3.12** — run backend unit tests, infrastructure-contract checks, and trusted administration scripts.
- **Modern browser** — verify the responsive frontend and Cognito sign-in experience.
- **AWS account and suitable IAM permissions** — required for real AWS resources, with the project configured for `us-east-1`. The console-first deployment procedure itself is performed in the AWS Management Console.
- **AWS CLI v2** — useful for reading stack outputs and running trusted profile-seeding / administration scripts from a local terminal. The console-only resource-creation path does not require the CLI for every step.
- **AWS SAM CLI** — optional. Install it only to validate/build the optional full-stack CloudFormation/SAM template or to follow the automated deployment runbook. GitHub Actions validates and builds templates but does not deploy resources into your account.
- **Docker** — optional; only needed for workflows that choose a Docker-based SAM build.

Install the AWS CLI from the [official AWS CLI installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and the SAM CLI from the [official SAM CLI installation guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

### Clone and prepare the local development environment

```bash
git clone https://github.com/retzed/Team_Follow-Up_AWS-Deployment.git
cd Team_Follow-Up_AWS-Deployment
python -m venv .venv
```

Activate the virtual environment, then install the development/test dependencies.

**Windows PowerShell**
```powershell
.\\.venv\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend/requirements-dev.txt
```

**macOS / Linux**
```bash
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements-dev.txt
```

Run the repository's full local validation suite:

```bash
npm run test:all
```

This verifies the frontend, backend helper tests, infrastructure contract, Python compilation, and related checks. The AWS frontend build additionally requires the public Cognito/API runtime settings listed in the following section. Those browser-visible values are configuration, not credentials; never place AWS access keys, private tokens, client secrets, real Cognito subject mappings, or the budget-recipient email in frontend configuration or source control.

**Related project:** [Team Follow-Up browser-local demo](https://github.com/retzed/Team_Follow-Up) is a separate static demonstration. It does not use this repository's Cognito/API/DynamoDB runtime.


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

**These commands validate/build artifacts only; they do not create AWS resources.** GitHub Actions follows the same principle and never deploys to an AWS account. To use the optional full-stack template as an automation method, follow [the automated deployment runbook](docs/AUTOMATED_DEPLOYMENT.md), supply GitHub-token and budget-email parameters privately, and use a clean environment or a distinct resource prefix. Never save those sensitive parameter values in `samconfig.toml` or commit credentials.

## Amplify public environment variables

The console-first Amplify branch needs these values before a successful frontend build:

- `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`
- `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`
- `TEAM_FOLLOW_UP_API_BASE_URL`
- `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE=custom:teamUserId` (the default)

They are public browser configuration values, not secrets. Do not add AWS credentials, GitHub access tokens, Cognito client secrets, real Cognito `sub` values, or billing-recipient email addresses to source files or Amplify environment variables. A passing CI run is evidence of code/build-contract validation only, not proof of a live AWS deployment.
