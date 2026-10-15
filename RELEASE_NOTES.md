# Repository and deployment notes

## Current AWS console bootstrap (15 October 2026)

The Cognito and DynamoDB resources in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) have been created manually in us-east-1. The monthly cost budget has also been created. Amplify Hosting, API Gateway, Lambda, and CloudWatch observability resources have not yet been deployed.

**Do not deploy the current SAM template yet.** Its resource ownership and table/index contract differ from the console bootstrap: it creates a second Cognito pool and four differently shaped tables. The app's Lambda handler currently requires those target indexes, including **GSI_CognitoSub**, which are not present on the console-created tables. Reconcile the schema and template before live integration. The SAM template now defaults point-in-time recovery to disabled to match the current lab's cost preference.

## AWS-only behavior

- Frontend sign-in is handled exclusively by Amazon Cognito. There is no local-auth fallback, seeded sample workspace, demo reset action, browser-side identity map, or local work-data database.
- Every application data read/write uses the Cognito-authenticated API backed by API Gateway, Python Lambda, and DynamoDB. The browser holds a transient view snapshot for rendering only; it does not persist a work-data cache or continue from offline demo data.
- The frontend build requires a real Cognito User Pool ID, public app-client ID, and HTTPS API base URL. The build emits only public browser configuration; secrets must never be supplied to frontend code.
- The AWS SAM stack provisions Cognito, API Gateway, Python 3.12 Lambda, four DynamoDB tables and required indexes, and CloudWatch logs/dashboard/alarms.
- Lambda IAM is constrained to read-only table policies, transactional write operations on WorkItems/ActivityEvents/Archive, and the narrow ActivityEvents batch-write recovery path.
- Archive/restore handling is transaction-bounded. Trusted administration scripts validate Cognito-to-profile mappings and support dry runs for profile seeding and activity-index migration.

## Validation and release boundary

The GitHub Actions workflow in `.github/workflows/validate.yml` runs frontend regression tests, AWS-only build-configuration tests, backend/admin-script tests, infrastructure contract checks, Python compilation, `sam validate --lint`, and `sam build`. It uses non-production test configuration only to verify the frontend build path.

CI validation does **not** deploy the SAM stack or prove that any AWS account is configured. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for first deployment, Cognito provisioning, Amplify environment variables, acceptance testing, migrations, and recovery. Do not treat a green CI run as a live deployment or smoke test.
