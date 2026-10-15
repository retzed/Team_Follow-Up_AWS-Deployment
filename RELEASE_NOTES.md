# Release notes

## Console-first deployment model and complete automation template

The project's primary AWS resource-creation method is the AWS Management Console. The full-stack CloudFormation/SAM template is retained as an optional automation/reference method, not as the normal deployment workflow.

### Infrastructure contract

- **Current account snapshot:** as recorded on 15 October 2026, the Cognito pool/client, Items/Activity/Users/Archive DynamoDB tables and monthly cost budget had been created manually in `us-east-1`. Amplify Hosting, API Gateway/Lambda and CloudWatch operational resources were still pending in that dated snapshot.
- **Target schema:** both console-created and template-created environments use the same four DynamoDB tables and five GSIs. Items uses `ParentIdIndex`, `AssignedToIndex`, and `WorkspaceIndex`; Activity uses `itemId + activityKey` with no GSIs; Users uses `userId` with no GSIs; Archive uses `archiveId` plus `GSI_ArchiveIndex` and `GSI_ArchiveRoot`.
- **Full-stack template:** `backend/template.yaml` now creates the Cognito pool and public app client, all four DynamoDB tables/indexes, API Gateway HTTP API, Python 3.12 Lambda and scoped IAM, 30-day CloudWatch log groups/dashboard/alarms, Amplify Hosting app/branch, and a $1 monthly cost budget with actual 50/80/100% and forecast 100% email alerts.
- **No existing-resource assumptions:** the template no longer takes an existing Cognito pool/client ID, table names, or a pre-created Amplify origin as parameters. It derives exact-origin CORS from the generated Amplify branch domain and injects the generated runtime configuration into the branch.
- **Collision safety:** default names match the manual setup, so do not deploy the template with its default prefix into the current account/Region while the same physical resources exist. Use a clean environment or intentionally choose a different prefix; CloudFormation does not auto-adopt console-created resources. DynamoDB tables use Retain lifecycle policies so stack deletion/replacement does not automatically erase table data.
- **Identity contract:** the Cognito schema attribute is `custom:teamUserId` (String, length 1–32, mutable). The public app client supports SRP sign-in and refresh, reads the custom attribute, and excludes it from client-write permissions. Trusted administration must assign unique `u1`–`u6` values and seed each Cognito `sub` into the matching enabled Users profile.
- **Data behavior:** every read/write remains on the Cognito-authenticated API backed by API Gateway, Lambda and DynamoDB. The browser has no local/demo database fallback. User/Activity Scan operations intentionally support the current no-GSI table design.
- **Manual Lambda policy:** added `backend/console-lambda-policy.json` as an adaptation-ready least-privilege policy for creating the Lambda execution role through the AWS Console.

### Automated deployment documentation

- Added root-level [`AUTOMATED_DEPLOYMENT.md`](AUTOMATED_DEPLOYMENT.md), a full step-by-step runbook for the optional SAM/CloudFormation path. It covers tool/credential prerequisites, Amplify GitHub App/token setup, name-collision safeguards, validation/build, guided deployment and changeset review, outputs, creation/seeding of the six team profiles, acceptance tests, updates, troubleshooting and stack cleanup.
- Linked the runbook from the README, console deployment guide, architecture reference, complete project documentation and current-account implementation record.

### Validation

GitHub Actions runs frontend regression tests/build checks, backend unit tests, the infrastructure-contract checks, Python compilation, `sam validate --lint`, and `sam build`. These steps validate repository artifacts but never deploy resources or verify the live AWS account. Manual resource creation/configuration is documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); the complete target architecture is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Sensitive values such as the GitHub access token used by an automation experiment and the budget email recipient are deployment-time inputs only and must not be committed or saved in `samconfig.toml`.
