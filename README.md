# Team Follow-Up Application

An English/Arabic workspace for a team to manage projects, temporary jobs, tasks, and follow-ups. **This repository is AWS-only:** users sign in with Amazon Cognito and all application data is read from and written to DynamoDB through the authenticated API. There is no local authentication, demo database, or offline data store.

> **Current AWS status (15 October 2026):** the Cognito pool and four DynamoDB tables—**Items**, **Activity**, **Users**, and **Archive**—have been created manually in **us-east-1**. Amplify Hosting and the API/Lambda backend have not yet been deployed. See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for the exact console settings.
>
> **Deployment status:** the handler, schema reference, and SAM template now target the four manually created DynamoDB tables and the existing Cognito pool/app client. SAM creates only the API, Lambda, IAM, and CloudWatch resources; it does not create duplicate tables or a new user pool. The operator confirmed that `custom:teamUserId` was added to the existing pool on 15 October 2026. Before deploying, verify that the `Team_FollowUp` app client can read the attribute and cannot write it, that no other app client can write it, assign unique `u1`–`u6` values to the team accounts, and supply the final Amplify HTTPS origin.

## Start here

- **[AWS console implementation record](docs/IMPLEMENTATION.md)** — actual resources and settings currently configured in AWS.
- **[Deployment guide](docs/DEPLOYMENT.md)** — target deployment workflow, Cognito team mapping, and pre-deployment verification.
- **[Architecture guide](docs/ARCHITECTURE.md)** — request flow, security boundaries, data model, and operational design.
- **[Release notes](RELEASE_NOTES.md)** — implementation and validation notes.

## Target architecture (not yet fully deployed)

- **Amplify Hosting** builds and serves the frontend.
- **Cognito** authenticates team members and issues tokens.
- **API Gateway and Python Lambda** authorize and process application requests.
- **DynamoDB** is the shared source of truth for work items, activity history, team profiles, and archived items.
- **CloudWatch** collects logs, metrics, alarms, and dashboard data.

The backend is defined in `backend/template.yaml` and deployed with AWS SAM; Amplify deploys the frontend separately. The template accepts the existing Cognito pool/client and table names as parameters and does not own the existing data resources. `backend/src/handler.py` uses the indexes and primary keys already configured in the console. A successful build or GitHub Actions run validates the package; it does **not** deploy the backend or verify the live Cognito/table settings.

## Repository guide

`index.html` contains the frontend. `scripts/build.mjs` generates `dist/index.html` and refuses to build unless real Cognito IDs and an HTTPS API base URL are configured. The `backend/` directory contains the SAM template, Lambda handler, DynamoDB schema reference, administrative seeding/migration scripts, and tests. The `docs/` directory contains the detailed architecture and deployment runbooks.

## Local validation (not local application runtime)

Requirements: Node.js 24, Python 3.12, and AWS SAM CLI for infrastructure validation. These commands test/build the package only; they do not run an alternative local database or local sign-in mode.

```bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
npm run build
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
```

A build requires AWS configuration values even when it is run from a workstation. Use the non-secret Cognito User Pool ID, public app-client ID, and HTTPS API Gateway base URL from the deployed stack. Never invent placeholder values for a release build or commit credentials.

## Deployment configuration

Amplify must have these environment variables populated before its frontend build can succeed:

- `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`
- `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`
- `TEAM_FOLLOW_UP_API_BASE_URL`
- `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE=custom:teamUserId` (optional; this is the default)

These are public browser configuration values, not secrets. Do not add AWS access keys, Cognito client secrets, or real Cognito-subject mappings to the frontend or Amplify configuration. The complete setup and first-deployment order are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
