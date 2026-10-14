# Repository and deployment notes

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
