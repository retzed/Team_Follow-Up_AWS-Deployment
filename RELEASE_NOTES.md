# Repository and deployment notes

## Current AWS console bootstrap (15 October 2026)

The Cognito pool, all four DynamoDB tables (Items, Activity, Users, and Archive), and the monthly cost budget have been created manually in us-east-1. Amplify Hosting, API Gateway, Lambda, and CloudWatch observability resources have not yet been deployed.

**Do not deploy the current SAM template yet.** The existing `TeamFollowUp-Archive` table has the same primary key and GSIs as the target Archive contract, but it uses provisioned billing and is not CloudFormation-managed; the default SAM prefix would collide with it. The template also creates a second Cognito pool and WorkItems/ActivityEvents/UserProfiles tables that do not match the other console tables. The handler's expected indexes, including **GSI_CognitoSub**, are not present on the current Users table. Reconcile resource ownership, billing, Cognito, and the remaining table schemas before live integration. The SAM template defaults point-in-time recovery to disabled.

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
