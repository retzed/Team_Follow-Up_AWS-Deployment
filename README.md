# Team Follow-Up Application

A small English/Arabic workspace for a team to track projects, temporary jobs, tasks, and follow-ups. The live version shares updates across users through AWS; the built-in demo stores data only in the current browser.

## Start here

- **[Deployment guide](docs/DEPLOYMENT.md)** — setup from a new AWS account through go-live and verification.
- **[Architecture guide](docs/ARCHITECTURE.md)** — services, request flow, data model, and security boundaries.
- **[Release notes](RELEASE_NOTES.md)** — notable implementation and validation changes.

## What runs on AWS?

- **Amplify Hosting** publishes the web app.
- **Cognito** signs in team members.
- **API Gateway and Python Lambda** validate and process requests.
- **DynamoDB** stores shared work items, activity history, team profiles, and archived items.
- **CloudWatch** collects logs and operational metrics.

The application infrastructure is defined in `backend/template.yaml` and deployed separately from the web frontend. A successful build or GitHub Actions run does **not** mean the backend has been deployed into an AWS account.

## Repository guide

`index.html` is the frontend. `scripts/build.mjs` safely injects deployment configuration and creates `dist/index.html`. The `backend/` directory contains the SAM template, Lambda handler, table model, tests, and trusted administrative scripts. `docs/` contains the detailed architecture and deployment instructions.

## Local checks

Requirements: Node.js 24 and Python 3.12. Install the Python validation dependencies, then run:

```bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
npm run build
```

To validate the AWS template locally, install AWS SAM CLI and run:

```bash
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
```

These checks do not require AWS resources. A real deployment and the smoke tests in the deployment guide are still required before team use.

## Important safety note

Never enable local demo authentication on an internet-facing site. For live shared data, use `TEAM_FOLLOW_UP_DATA_MODE=api`, configure the Cognito/API values listed in the deployment guide, and keep `TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED=false`. Hosted builds intentionally fail when required mode settings are missing or empty.
