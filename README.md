# Team Follow-Up Application

An English/Arabic workspace for a team to manage projects, temporary jobs, tasks, and follow-ups. **This repository is AWS-only:** users sign in with Amazon Cognito and authoritative application data is read from and written to DynamoDB through an authenticated API. There is no local authentication, demo database, or offline-first work-data store. The browser may retain a versioned cache of successful API responses for performance; the authenticated API and DynamoDB remain authoritative.

> **Current account checkpoint (15 October 2026):** The Cognito pool/client, four DynamoDB tables (Items, Activity, Users and Archive), and monthly cost budget were reported as created manually in `us-east-1`. Amplify Hosting, API Gateway/Lambda and CloudWatch operational resources remained pending in the dated implementation snapshot. See the [implementation record](docs/IMPLEMENTATION.md) for current-account details. This status is a snapshot, not a prerequisite assumed by the architecture or automation template.

## Deployment approach

**Primary method: AWS Management Console.** Create and configure project AWS resources manually in the console. Do not use SAM to deploy resources as part of the normal project workflow. The [console deployment runbook](docs/DEPLOYMENT.md) is the operational guide.

**Optional automation reference: full-stack CloudFormation/SAM.** [`backend/template.yaml`](backend/template.yaml) is kept as an alternative way to provision a new environment from scratch. Follow the [step-by-step automated deployment runbook](docs/AUTOMATED_DEPLOYMENT.md) to prepare credentials, validate/build, review the changeset, deploy, seed team profiles, test, update, and clean up the stack. It creates a Cognito pool/client, all four DynamoDB tables and five GSIs, API Gateway HTTP API, Lambda and scoped IAM, CloudWatch log groups/dashboard/alarms, Amplify Hosting app/branch, and the $1 monthly cost budget. It no longer expects pre-existing Cognito IDs, DynamoDB tables, or a pre-known Amplify origin. The default prefix matches the console table names, so do **not** deploy it into the current account/Region while those manually created resources still exist. Use a fresh environment or a different prefix for template experiments.

## Start here

- **[AWS Console deployment guide](docs/DEPLOYMENT.md)** — primary creation/configuration workflow, team mapping, API/Lambda configuration and acceptance tests.
- **[AWS Console implementation record](docs/IMPLEMENTATION.md)** — dated record of resources reported as actually configured in the current AWS account.
- **[Architecture reference](docs/ARCHITECTURE.md)** — whole-system architecture, trust boundaries, data model and monitoring.
- **[Complete project documentation](docs/DOCUMENTATION.md)** — system analysis/design, diagrams, schema, UI/UX, API, testing, security and operations.
- **[DynamoDB schema reference](backend/table-schema.json)** — target physical keys, index names, capacity settings and separate current-account snapshot.
- **[Console Lambda IAM policy](backend/console-lambda-policy.json)** — least-privilege policy template to adapt for manual Lambda setup.
- **[Automated deployment runbook](docs/AUTOMATED_DEPLOYMENT.md)** — optional end-to-end SAM/CloudFormation deployment for a separate from-scratch environment.
- **[Release notes](RELEASE_NOTES.md)** — implementation and validation notes.

## Target architecture

- **Amplify Hosting** builds and serves the frontend from the GitHub branch using `amplify.yml`.
- **Cognito** authenticates members; a public app client reads but cannot write `custom:teamUserId`.
- **API Gateway HTTP API** validates the Cognito JWT issuer/audience, enforces exact-origin CORS and forwards JSON requests to Lambda.
- **Python 3.12 Lambda** validates hierarchy and caller identity, maintains server-owned index keys, writes audit history and implements archive/restore.
- **DynamoDB** stores active items, activity, team profiles and archived snapshots across four deliberately small, provisioned tables.
- **CloudWatch** collects API/Lambda logs and exposes a dashboard and alarms; **AWS Budgets** sends monthly cost-threshold notifications without stopping spend.

The implementation is described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The schema/access contract shared by the console procedure and full-stack template is in [`backend/table-schema.json`](backend/table-schema.json). In the target schema, Activity uses `itemId + activityKey`; Users uses `userId`; the handler scans Activity for application-wide history and Users for the matching Cognito subject because neither table has a GSI.

## Repository guide

- `index.html`: frontend source.
- `scripts/build.mjs`: generates `dist/index.html` and rejects missing/placeholder Cognito/API settings.
- `backend/src/handler.py`: Lambda request handling, identity mapping and DynamoDB access.
- `backend/template.yaml`: optional full-stack CloudFormation/SAM automation reference; it is not the primary console deployment path.
- `backend/table-schema.json`: shared schema contract and separate record of the current account's reported console state.
- `backend/console-lambda-policy.json`: policy template for manually creating the Lambda execution role.
- `backend/scripts/`: trusted administration scripts for profile seeding and legacy migration diagnostics.
- `docs/`: architecture, deployment, implementation snapshot and complete documentation.

## System requirements and development setup

### Hardware recommendations

A normal modern development computer is sufficient. As a practical starting point, use at least 2 CPU cores, 4 GB RAM, and 1 GB of free disk space for the repository, Python environment, test outputs, and SAM build artifacts. These are recommendations, not enforced minimums. No GPU is required.

### Required and optional software

- **Git** — clone the repository and manage source changes.
- **Node.js 24.x and npm** — run JavaScript syntax, API, UI regression, and build scripts. The project currently declares no third-party npm dependencies, so `npm install` is not required.
- **Python 3.12** — run backend unit tests, infrastructure-contract checks, and trusted administration scripts.
- **Modern browser** — verify the responsive frontend and Cognito sign-in experience.
- **AWS account and suitable IAM permissions** — required for real AWS resources, with the project configured for `us-east-1`. The console-first deployment procedure itself is performed in the AWS Management Console.
- **AWS CLI v2** — useful for reading stack outputs and running trusted profile-seeding / administration scripts from a local terminal. The console-only resource-creation path does not require the CLI for every step.
- **AWS SAM CLI** — optional. Install it only to validate/build the optional full-stack CloudFormation/SAM template or to follow the automated deployment runbook. GitHub Actions validates and builds templates but does not deploy resources into your account.
- **Docker** — optional; only needed for workflows that choose a Docker-based SAM build.

Install the AWS CLI from the [official AWS CLI installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and the SAM CLI from the [official SAM CLI installation guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

### Clone and prepare the local development environment

```bash
git clone https://github.com/retzed/Team_Follow-Up_AWS-Deployment.git
cd Team_Follow-Up_AWS-Deployment
python -m venv .venv
```

Activate the virtual environment, then install the development/test dependencies.

**Windows PowerShell**
```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend/requirements-dev.txt
```

**macOS / Linux**
```bash
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements-dev.txt
```

Run the repository's full local validation suite:

```bash
npm run test:all
```

This verifies the frontend, backend helper tests, infrastructure contract, Python compilation, and related checks. The AWS frontend build additionally requires the public Cognito/API runtime settings listed in the following section. Those browser-visible values are configuration, not credentials; never place AWS access keys, private tokens, client secrets, real Cognito subject mappings, or the budget-recipient email in frontend configuration or source control.

**Related project:** [Team Follow-Up browser-local demo](https://github.com/retzed/Team_Follow-Up) is a separate static demonstration. It does not use this repository's Cognito/API/DynamoDB runtime.

## Local validation

Requirements: Node.js 24 and Python 3.12. Install backend test dependencies, then run the regression and infrastructure-contract checks:

```bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
npm run build
```

The frontend build requires public runtime settings. On Windows PowerShell:

```powershell
$env:TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID = "<actual-pool-id>"
$env:TEAM_FOLLOW_UP_COGNITO_CLIENT_ID = "<actual-public-client-id>"
$env:TEAM_FOLLOW_UP_API_BASE_URL = "https://<actual-api-id>.execute-api.us-east-1.amazonaws.com"
$env:TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE = "custom:teamUserId"
npm run build
```

For optional template validation only, install the AWS SAM CLI and run:

```bash
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
```

**These commands validate/build artifacts only; they do not create AWS resources.** GitHub Actions follows the same principle and never deploys to an AWS account. To use the optional full-stack template as an automation method, follow [the automated deployment runbook](docs/AUTOMATED_DEPLOYMENT.md), supply GitHub-token and budget-email parameters privately, and use a clean environment or a distinct resource prefix. Never save those sensitive parameter values in `samconfig.toml` or commit credentials.

## Configuration

### Amplify public environment variables

The console-first Amplify branch needs these values before a successful frontend build:

- `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`
- `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`
- `TEAM_FOLLOW_UP_API_BASE_URL`
- `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE=custom:teamUserId` (the default)

They are public browser configuration values, not secrets. Do not add AWS credentials, GitHub access tokens, Cognito client secrets, real Cognito `sub` values, or billing-recipient email addresses to source files or Amplify environment variables. A passing CI run is evidence of code/build-contract validation only, not proof of a live AWS deployment.

### Configuration rules

1. Deploy/configure the Cognito User Pool and public app client, API Gateway HTTP API with its Cognito JWT authorizer, Lambda function, DynamoDB tables, and API CORS policy using the [console deployment runbook](docs/DEPLOYMENT.md). The application cannot perform real sign-in or read/write shared data until those resources are deployed and correctly connected.
2. In **Amplify Console → App settings → Environment variables**, configure the four variables listed above for the branch that builds the app. Set `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE` to exactly `custom:teamUserId`.
3. Use the actual User Pool ID, public app-client ID, and **HTTPS API Gateway base URL at its root**. `TEAM_FOLLOW_UP_API_BASE_URL` must not include a path, stage prefix, query string, or fragment; the template uses the `$default` HTTP API stage.
4. Configure API Gateway CORS to allow the exact Amplify branch origin. For local testing at http://localhost:8000, add that exact origin to the API CORS allow-list as well, then redeploy/save the API settings.
5. Create the administrator-managed Cognito team accounts, assign their unique custom:teamUserId values, and seed the matching Users-table profiles using the trusted script described in the deployment runbook.

The Cognito IDs and API URL are public browser configuration, not credentials. Never put AWS access keys, secret access keys, GitHub tokens, a Cognito app-client secret, real cognitoSub values, or the budget notification email into frontend settings or source control. The build script validates the values and embeds them into dist/index.html, so a successful build alone does not prove the live services are configured correctly.

## Run the AWS-backed frontend locally

This starts the **frontend only** and requires a correctly deployed backend plus a valid Cognito team account. From the repository root, first set the environment variables from the configuration section above.

**Windows PowerShell**
```powershell
$env:TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID = "<actual-pool-id>"
$env:TEAM_FOLLOW_UP_COGNITO_CLIENT_ID = "<actual-public-client-id>"
$env:TEAM_FOLLOW_UP_API_BASE_URL = "https://<actual-api-id>.execute-api.us-east-1.amazonaws.com"
$env:TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE = "custom:teamUserId"
npm run build
python -m http.server 8000 --directory dist
```

**macOS / Linux**
```bash
export TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID="<actual-pool-id>"
export TEAM_FOLLOW_UP_COGNITO_CLIENT_ID="<actual-public-client-id>"
export TEAM_FOLLOW_UP_API_BASE_URL="https://<actual-api-id>.execute-api.us-east-1.amazonaws.com"
export TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE="custom:teamUserId"
npm run build
python -m http.server 8000 --directory dist
```

Open [http://localhost:8000](http://localhost:8000). Keep the terminal running while testing. The frontend signs in directly with Cognito and sends API requests with a Cognito access token. Authentication, CORS, API Gateway, Lambda, team-user mappings, and DynamoDB must be configured first; starting the static server does not start the backend.

## Client-side data cache and progressive loading

The frontend intentionally separates the authoritative AWS data from a versioned browser cache. Successfully fetched API responses may be stored in browser storage under the `team-follow-up-api-cache-v2:` namespace. This is a response cache, not a local database or offline-write queue.

On a subsequent read the client sends a conditional request with the cache version. If the backend confirms the version is unchanged, the saved response is reused; otherwise, the latest server response replaces the cached value. Storage errors do not make the browser cache authoritative, and a cold browser profile still requires the authenticated API.

### Loading lifecycle

- Startup loads enabled team profiles and the top-level Project/Job list, then hydrates the selected root's child records and scoped Activity timeline. It does not download every descendant or the entire application-wide Activity table as one startup snapshot.
- Selecting another Project/Job triggers loading for that root's children and its root-scoped Activity timeline. When a descendant's Activity popup opens, it reuses the cached root timeline when it is available; otherwise, the client queries the relevant root/item scope.
- Application-wide Activity is loaded when its popup opens and retrieved in pages. Scrolling near the end requests the next page; a search that needs older records can trigger additional page loading. The view renders already-loaded records while requests continue and offers a visible retry/error state when a request fails. A stalled application-wide Activity request transitions to an error after 25 seconds.
- Item-list filtering, creation/edit dialogs, and date sorting use the in-memory hierarchy/Activity indexes rather than rebuilding or scanning unrelated data for every UI action.

### Modal and hierarchy safety

Modal clicks are stopped by the modal's own delegated handler before the action is processed; the workspace delegate ignores modal clicks as a second defensive guard. This avoids duplicate action dispatch when a dialog closes or its DOM is replaced. The shared `allDescendants()` helper used for subtree validation/deletion uses iterative, cycle-safe traversal; separate hierarchy renderers retain their own visited-ID guards. Dialogs use direct-child checks for type validation where that is sufficient, and child timestamp comparisons read that child's indexed Activity events instead of scanning the entire root timeline.

These front-end safeguards (modal dispatch, hierarchy traversal and lazy Activity/index behavior) do not change the AWS infrastructure. The separate current-password check added on 29 October 2026 is not frontend-only: it adds an authenticated verifier endpoint, two Lambda Cognito environment variables and narrowly scoped Cognito IAM permissions, and requires enabling the server-side `ALLOW_ADMIN_USER_PASSWORD_AUTH` flow on the existing public app client. No DynamoDB schema migration or new Amplify environment variable is needed. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#account-password-verification).

## Account Search and responsive navigation

The application opens on **My Account → Assigned Items**. Profile fields are Display name, optional Arabic display name, phone, e-mail, Label, Label (Arabic), and Profile icon. The privilege indicator remains beside the name; privilege management is a separate authorized operation, and root remains protected. Cognito is still the only authentication provider.

Assigned Items has its own query, type, status, date-mode and inclusive From/To filters. `Not completed` is the final status option, and `root` is omitted from assignee selectors. Account Search filters top-level Projects/Jobs by type, status, associated users, sort date, and inclusive From/To dates. It includes canonical AWS user-ID fields such as `createdByUserId`, `updatedByUserId`, `ownerId`, and `assignedTo`. Each result has separate Open in workspace, Activity history, and pin controls. Assigned/Pinned rows have workspace and history actions. Child navigation recalculates Task ancestors after root hydration and restores the selected child into view. At widths up to 820 CSS pixels the account filters use two shrink-safe columns, with From/To controls side by side and no horizontal overflow; action controls wrap on narrow screens. These UI changes need no data migration. See [the complete behavior and testing notes](docs/DOCUMENTATION.md#14-account-page-search-navigation-and-mobile-reliability-28-october-2026).

Workspace Search also starts collapsed when the workspace is opened, including from Account. The floating toggle synchronizes visibility and accessibility state without a full translation refresh. On close, queued/in-flight sidebar search refreshes are invalidated so stale responses cannot repaint the hidden list. Reopening preserves the selected workspace item and existing lazy-loading behavior; resize events do not force the sidebar open. The collapsed grid removes the sidebar and leaves a single flexible column for the workspace content, preventing the main panel from auto-placing into a zero-width track. These sidebar and filter improvements are frontend-only. The current-password check described above is different: it needs the updated Lambda/Cognito/IAM configuration in [the deployment guide](docs/DEPLOYMENT.md#account-password-verification).

## API documentation

The AWS-backed application uses a JSON HTTP API. The frontend sends authenticated requests to the configured `TEAM_FOLLOW_UP_API_BASE_URL`; API Gateway validates the Cognito JWT, and Lambda resolves the verified Cognito `sub` to one enabled team profile. All routes below require a valid mapped team identity. Send `Accept: application/json`; JSON request bodies use `Content-Type: application/json`.

### Endpoints

| Method | Route | Purpose and key parameters |
|---|---|---|
| `GET` | `/bootstrap` | Returns only top-level Projects/Jobs and enabled team profiles for a lightweight startup snapshot; descendants and Activity history are loaded on demand. |
| `GET` | `/users` | Lists enabled team profiles for assignee selectors. |
| `POST` | `/users/me/verify-password` | Verifies the submitted current password only after confirming the requested Cognito username belongs to the already-authenticated JWT subject; returns `{ "valid": boolean }` only and never returns Cognito tokens. Requires the Lambda Cognito pool/client environment variables and two pool-scoped Cognito IAM actions. |
| `GET` | `/items` | Lists work items. Query parameters include scope=top-level, parentId, rootParentId, assigneeUserId, type, status, priority, q, dateMode, from, to, direction, limit, and offset. |
| `GET` | `/items/assigned-to-me` | Lists items assigned to the authenticated mapped team member. Accepts the normal item filters and paging options. |
| `GET` | `/items/{itemId}/children` | Lists direct children of an item; accepts type/status/priority/search/date/order and paging filters. |
| `GET` | `/items/{itemId}/activity` | Reads activity for one item. scope=all includes descendants for a Project/Job and a Task plus its direct Follow-ups. Optional q searches the returned activity. |
| `GET` | `/activity` | Reads broader activity. Provide scope=application (or global), rootParentId, itemId, or parentId; optional q searches events. |
| `GET` | `/archive` | Lists archived snapshots. Optional filters: type, rootParentId, q, limit, and offset. |
| `POST` | `/items` | Creates an item. Supply name, type, and the applicable fields; Tasks and Follow-ups require parentId. |
| `PATCH` | `/items/{itemId}` | Updates an existing item's editable fields. The server retains trusted creator/identity/timestamp/index values, validates hierarchy and assignment, and returns 409 if a concurrent update wins. |
| `DELETE` | `/items/{itemId}` | Archives the requested item and its descendant subtree where applicable, and records the delete activity event. |
| `POST` | `/archive/restore` | Restores selected archived records. JSON body: {"itemIds":["archive-item-id"]}. Required parent records must be active or included in a valid restore selection. |

Item query filters use the stored values, such as type=project, status=in-progress, priority=high, dateMode=created or updated, direction=asc or desc, ISO date strings (from=YYYY-MM-DD / to=YYYY-MM-DD), and a bounded page limit with offset. List responses include items, count, and nextOffset. Activity responses include events and count. Public responses omit DynamoDB-only index attributes.

Activity is append-oriented: POST /activity is rejected because events are written atomically with item mutations; PATCH and DELETE on /activity/{eventId} return 405 Method Not Allowed. Do not send requests with AWS credentials from the browser; Cognito access tokens, not AWS IAM keys, authorize application calls.

### Common response codes

- 200 OK — successful query or update/restore operation.
- 201 Created — item created.
- 400 Bad Request — invalid JSON, unsupported fields/values, hierarchy violation, or invalid restore selection.
- 401 Unauthorized — no valid authenticated identity was supplied.
- 403 Forbidden — the Cognito subject is not mapped to exactly one enabled team profile.
- 404 Not Found — item/route does not exist.
- 405 Method Not Allowed — attempt to write/delete standalone activity events.
- 409 Conflict — stale concurrent update or an archive/restore conflict; refresh the workspace before retrying.
- 500 Internal Server Error — backend/database failure. Internal exception details are intentionally not returned to the browser.

The authoritative route implementation is [`backend/src/handler.py`](backend/src/handler.py). This repository does not currently publish a separate OpenAPI/Swagger document; keep this endpoint summary synchronized with the handler and its unit tests.

## Executable artifact and deployed application

This is a browser-hosted web application, so a native `.exe`, `.jar`, or `.apk` installer is not applicable. The build generates `dist/index.html`; AWS Amplify Hosting publishes that static artifact after running `amplify.yml`. The artifact requires the configured Cognito and HTTPS API settings to work against a live backend.

- **Console-first deployment procedure:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Optional automated deployment procedure:** [docs/AUTOMATED_DEPLOYMENT.md](docs/AUTOMATED_DEPLOYMENT.md).
- **Current public demonstration:** [https://retzed.github.io/Team_Follow-Up/](https://retzed.github.io/Team_Follow-Up/) — this is the local-storage demo and is **not** the AWS-backed shared-data application.
- **AWS-backed live URL:** use the branch URL displayed by Amplify Console after that environment has been deployed. When using the optional SAM template, the FrontendUrl CloudFormation stack output provides the URL. GitHub Actions validates and builds the code but does not deploy AWS resources, so it cannot supply a live AWS URL.
