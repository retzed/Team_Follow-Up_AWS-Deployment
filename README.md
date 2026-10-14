# Team Follow-Up Application

A bilingual (English/Arabic) team workspace for projects, jobs, tasks, and follow-ups. The repository includes the existing responsive single-file frontend, a Cognito-protected Python API, DynamoDB table/index definitions, AWS SAM infrastructure, deployment scripts, and automated regression checks.

> **Deployment status:** this is a deployment-ready project package, not a deployed AWS environment. You still need an AWS account, a GitHub-connected Amplify app, six provisioned Cognito accounts, and the environment-specific values described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Architecture

```text
Team member's browser
        |
        +---- HTTPS static site --------------------> AWS Amplify Hosting
        |
        +---- sign-in / token refresh -------------> Amazon Cognito User Pool
        |
        +---- HTTPS request + Cognito access token -> API Gateway HTTP API
                                                        | JWT authorizer
                                                        v
                                                   Python Lambda
                                                        |
                                 +----------------------+---------------------+
                                 |                      |                     |
                                 v                      v                     v
                           DynamoDB tables        CloudWatch Logs       CloudWatch metrics,
                           (4 logical tables)     and API access logs   dashboard and alarms
```

- **Amplify Hosting** builds `index.html` into `dist/index.html` using `amplify.yml`; its environment variables select local demo mode or the live API.
- **Cognito** provides username/password sign-in, password recovery, optional software-token MFA, and the administrator-managed team identity field `custom:teamUserId` (the browser client cannot write it).
- **API Gateway HTTP API** validates JWTs before any API route reaches Lambda and allows CORS only from the configured Amplify HTTPS origin.
- **Python Lambda** verifies the signed-in subject is linked to an enabled team profile. It derives creator/editor/actor identity on the server and writes item changes with their audit events transactionally.
- **DynamoDB** stores active work items, append-only activity events, user profiles, and archived items. Tables use on-demand capacity, server-side encryption, indexed query patterns, and configurable point-in-time recovery.
- **CloudWatch** retains Lambda and API access logs, surfaces API/Lambda metrics in a dashboard, and creates alarms for Lambda errors, throttling, and API Gateway 5xx responses.

## Repository structure

```text
.
├── index.html                         # Current complete frontend UI
├── amplify.yml                        # Amplify Hosting build/publish config
├── package.json                       # Frontend build and regression-test commands
├── scripts/
│   ├── build.mjs                      # Runtime config validation and dist build
│   ├── check-syntax.mjs               # Inline JS syntax check
│   ├── test-*.mjs                     # Frontend/data API regression tests
│   └── test-infrastructure.py         # SAM template contract checks
├── backend/
│   ├── template.yaml                  # Cognito, API, Lambda, DynamoDB, CloudWatch
│   ├── table-schema.json              # Human-readable DynamoDB model
│   ├── requirements.txt               # Trusted admin scripts' dependencies
│   ├── requirements-dev.txt           # Infrastructure/test dependencies
│   ├── team-users.example.json        # Placeholder profile mapping example
│   ├── src/
│   │   ├── handler.py                 # API routes and validation
│   │   └── requirements.txt           # Dependencies SAM packages with Lambda
│   ├── scripts/
│   │   ├── seed_user_profiles_from_cognito.py
│   │   ├── seed_user_profiles.py      # Alternative manual-sub seeder
│   │   └── migrate_activity_application_index.py
│   └── tests/test_handler.py          # Offline Python unit tests
├── docs/
│   ├── DEPLOYMENT.md                  # Step-by-step deployment/runbook
│   └── ARCHITECTURE.md                # Service diagram, flow, trust boundaries
└── .github/workflows/validate.yml     # CI: tests, template validation, SAM build
```

## Local development and validation

Recommended: Node.js 20+, Python 3.12, AWS SAM CLI for infrastructure validation. No AWS account is needed to run the UI tests or helper unit tests.

```bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
npm run build
python -m py_compile backend/src/handler.py backend/scripts/*.py
```

Serve `dist/` over HTTP for local UI testing:

```bash
npx serve dist
```

The repository default is `dataMode: builtin`; its browser storage is **not shared between users or devices**. The ZIP includes a fail-closed `dist/index.html` (`localAuth.enabled=false`) as a safe unconfigured artifact; a normal local `npm run build` without hosted environment variables is optimized for the private demo and can enable local demo sign-in. The local-auth fallback accepts any non-empty password for one of the six demo names and is only for private, non-production demonstrations. Set `TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED=false` on a hosted but not-yet-configured branch; use `TEAM_FOLLOW_UP_DATA_MODE=api` and the real Cognito/API settings before sharing live data. API mode refuses local authentication and the build fails for incomplete Cognito/API config or a non-HTTPS API URL.

## Deploy

Follow the ordered steps in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In brief:

1. Push this project to GitHub and create its Amplify Hosting app to obtain the final HTTPS site origin.
2. Run `sam validate --lint`, `sam build`, and `sam deploy --guided` against `backend/template.yaml`, passing that exact origin as `AllowedOrigin`.
3. Create the six Cognito users, set their `custom:teamUserId` values to `u1`–`u6`, and seed the DynamoDB UserProfiles table with `seed_user_profiles_from_cognito.py`.
4. Set Amplify build environment variables from the stack outputs, switch `TEAM_FOLLOW_UP_DATA_MODE` to `api`, keep `TEAM_FOLLOW_UP_LOCAL_AUTH_ENABLED=false`, and redeploy.
5. Run the acceptance checklist in the deployment runbook and inspect the CloudWatch dashboard/log groups.

The SAM stack creates its Cognito User Pool and public app client with **no client secret**, the HTTP API JWT authorizer, Python Lambda, all four DynamoDB tables and indexes, CloudWatch log groups/alarms/dashboard, and supporting IAM. Work-item data tables and the Cognito pool have `DeletionPolicy: Retain` to reduce accidental data loss. Removing the stack therefore does not delete those resources; clean them up deliberately only after a backup and explicit confirmation.

## API and data contract

| Route | Purpose |
|---|---|
| `GET /bootstrap` | Initial team profile, top-level item, descendant, and activity hydration |
| `GET /users` | Enabled team members for assignment controls |
| `GET /items?scope=top-level` | Projects and jobs, paginated |
| `GET /items/assigned-to-me` | Work assigned to the signed-in team profile |
| `GET /items/{id}/children` | Direct child items, paginated |
| `POST /items` | Create item + audit event in one DynamoDB transaction |
| `PATCH /items/{id}` | Version-checked update + audit events in one transaction |
| `DELETE /items/{id}` | Archive an item subtree and write a summary event |
| `GET /items/{id}/activity` | Item-specific or descendant history |
| `GET /activity?scope=application` | Application-wide indexed history |
| `GET /archive` | Paginated archived-item list/search |
| `POST /archive/restore` | Validate parent relationships and restore selected archived items |

`backend/src/handler.py` treats Cognito `sub` as the authenticated identity, resolves it through `TeamFollowUp-UserProfiles.GSI_CognitoSub`, validates parent/type rules server-side, and normalizes trusted audit metadata. Item changes and related events are transactionally committed; stale updates are rejected using the item version. Activity history is append-only. See the route handlers and tests for the detailed request and response contract.

## Operational and security notes

- Never commit AWS credentials, Cognito client secrets, real `cognitoSub` mappings, or `.env` files. The browser client is public by design and has no secret.
- Do not turn local authentication on in an internet-facing build. All production users must be provisioned in Cognito and linked to an enabled profile.
- Restrict IAM to the deployment operator and use short-lived credentials/roles. The Lambda's DynamoDB grants are scoped to the four application tables; transaction access is explicitly granted to the tables participating in item/archive/activity writes.
- The access-log format deliberately omits authorization headers and request bodies. Unexpected server errors return generic messages to browsers; diagnostic request IDs and error types are written to CloudWatch.
- `EnablePointInTimeRecovery=true` is the default for table recovery and can add backup charges. `LogRetentionDays` defaults to 30. The included CloudWatch alarms do not send notifications until an SNS action is configured.
- This package has not been deployed into your AWS account. After deployment, verify the generated Cognito IDs, API CORS origin, user profile mapping, GSI readiness, shared persistence, archive/restore, and activity history before team-wide use.
