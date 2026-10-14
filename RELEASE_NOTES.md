# AWS Deployment Preparation — Release Notes

## Included in this release

- Structured Amplify build with fail-closed hosted configuration checks; production/API mode requires explicit Cognito IDs, HTTPS API base URL, and disabled local authentication.
- AWS SAM template provisions Cognito User Pool/public client, API Gateway HTTP API with JWT authorizer and exact-origin CORS, Python 3.12 Lambda, four DynamoDB tables/indexes, retained data resources, and CloudWatch logs/dashboard/alarms.
- Explicit `dynamodb:TransactWriteItems` access for atomic work-item/archive/activity writes.
- Cognito-subject profile seeder and activity index migration script.
- Safer API error responses and structured request/error logs without returning internal exception details.
- Expanded Python/API helper tests, infrastructure contract checks, frontend regression tests, and CI steps for SAM validation/build.
- Deployment runbook and architecture/data-flow diagrams.

## Validation completed in this workspace

- `npm test`
- `npm run build`
- `python -m unittest discover -s backend/tests -v`
- `python scripts/test-infrastructure.py`
- `python -m py_compile backend/src/handler.py backend/scripts/*.py scripts/test-infrastructure.py`
- CloudFormation/SAM YAML parsed and resource/index contracts checked.

The AWS SAM CLI is not installed in this workspace, so `sam validate --lint` and `sam build` are configured in GitHub Actions but were not run locally. This release has not been deployed to an AWS account; run the deployment and smoke-test steps in `docs/DEPLOYMENT.md` before sharing with the team.
