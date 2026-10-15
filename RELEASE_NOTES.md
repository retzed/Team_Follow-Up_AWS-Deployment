# Repository and deployment notes

## Current AWS console bootstrap and backend integration (15 October 2026)

The existing Cognito pool/client, all four DynamoDB tables (Items, Activity, Users, and Archive), and the monthly cost budget have been created manually in `us-east-1`. Amplify Hosting, API Gateway, Lambda, and CloudWatch observability resources have not yet been deployed.

The Lambda handler now uses the actual table keys and indexes:

- **Items:** `WorkspaceIndex`, `ParentIdIndex`, and `AssignedToIndex`.
- **Activity:** `itemId + activityKey` composite primary key; `eventId` is a regular attribute. Per-item history uses Query; application-wide history scans because Activity has no GSIs.
- **Users:** `userId` primary key, with a small table scan matching Cognito `sub` to `cognitoSub`; no Cognito-subject GSI is assumed.
- **Archive:** `archiveId` plus `GSI_ArchiveIndex` and `GSI_ArchiveRoot`.

The SAM template parameterizes and reuses the existing Cognito pool/client and four table names. It provisions only API Gateway, Lambda, scoped IAM, and CloudWatch resources. It does not create duplicate pools/tables or manage existing data resources. The operator confirmed that `custom:teamUserId` was added to the existing pool and that the `Team_FollowUp` app client has Read enabled and Write disabled on 15 October 2026 (String, 1–32 characters, mutable per the console walkthrough). Before deployment, verify that Write is disabled for all other app clients too; also confirm the Items/Archive GSIs are ACTIVE, all six Cognito accounts have unique `u1`–`u6` values and Users-table profile mappings, and the final Amplify HTTPS origin is ready.

## AWS-only behavior

- Frontend sign-in is handled exclusively by Amazon Cognito. There is no local-auth fallback, seeded sample workspace, demo reset action, browser-side identity map, or local work-data database.
- Every application data read/write uses the Cognito-authenticated API backed by API Gateway, Python Lambda, and DynamoDB. The browser holds a transient view snapshot for rendering only; it does not persist a work-data cache or continue from offline demo data.
- The frontend build requires a real Cognito User Pool ID, public app-client ID, and HTTPS API base URL. The build emits only public browser configuration; secrets must never be supplied to frontend code.
- The AWS SAM stack reuses Cognito and the existing DynamoDB tables, provisioning only API Gateway, Python 3.12 Lambda, scoped IAM, and CloudWatch logs/dashboard/alarms.
- Lambda IAM scopes reads to the existing Items/Activity/Users/Archive tables and index ARNs, transactional writes to Items/Activity/Archive, and partial-restore batch writes to Activity only.
- Archive/restore handling is transaction-bounded. Trusted administration scripts validate Cognito-to-Users-table mappings and support dry-run profile seeding. The legacy ActivityEvents index migration is not used with the current Activity table.

## Validation and release boundary

GitHub Actions runs frontend regression tests, AWS-only build-configuration tests, backend unit tests, infrastructure contract checks, Python compilation, `sam validate --lint`, and `sam build`. It uses non-production test configuration only to verify the frontend build path.

CI validation does **not** deploy the SAM stack or prove any AWS account is configured. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for pre-deployment verification, Cognito account mapping, Amplify environment variables, acceptance testing, and cost/recovery cautions. Do not treat a green CI run as a live deployment or smoke test.
