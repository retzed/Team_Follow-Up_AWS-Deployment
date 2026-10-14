# Repository and deployment notes

## What is included

- A bilingual, responsive frontend with a build step that injects public runtime configuration into `dist/index.html`.
- An AWS SAM stack for Cognito, API Gateway HTTP API, Python 3.12 Lambda, four DynamoDB tables and their indexes, and CloudWatch logs/dashboard/alarms.
- A fail-closed hosted build: the deployment mode and local-auth setting must be explicit; API mode requires valid Cognito IDs and an HTTPS API base URL.
- Cognito subject-to-profile seeding tools, including dry-run modes, and an idempotent application-activity-index migration utility.
- Least-privilege Lambda data access: read-only policy templates for each table, explicitly scoped transactional write permission, and a limited activity-summary recovery write.
- Transaction-bounded archive/restore logic and unit tests for data-index helpers, profile mappings, deployment configuration, frontend behavior, and infrastructure contracts.
- A short project README plus dedicated architecture and deployment guides.

## Validation and deployment status

The GitHub Actions workflow in `.github/workflows/validate.yml` is the source of truth for automated validation. It runs frontend tests, builds the Amplify artifact, tests Python helpers, checks the SAM template and DynamoDB-index contract, compiles Python sources, runs `sam validate --lint`, and builds the Lambda deployment artifact.

These checks validate and package the project; they do **not** deploy the SAM stack into an AWS account. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for account setup, manual backend deployment, Cognito provisioning, Amplify configuration, acceptance tests, and recovery procedures. Do not treat a green CI run as proof that a live AWS environment has been configured or smoke-tested.
