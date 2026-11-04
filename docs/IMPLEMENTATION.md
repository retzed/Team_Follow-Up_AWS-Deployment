# AWS Console Implementation Record

**Last updated:** 15 October 2026  
**Status:** Account-specific implementation snapshot. The Cognito pool/client, four DynamoDB tables, and budget were created manually. The operator confirmed that `custom:teamUserId` was added to the pool, with Read enabled and Write disabled for the `Team_FollowUp` app client on 15 October 2026. Permission checks on other app clients, team accounts/profile mappings, Amplify Hosting, API Gateway/Lambda, and CloudWatch observability remained pending at the time of this snapshot.

This document records the configuration reported as actually created in the user's current AWS account; it is not the target architecture or a prerequisite for other environments. The primary deployment method is the AWS Management Console. `backend/template.yaml` is separately maintained as an optional full-stack automation template that creates all resources from scratch. This record includes the public Cognito User Pool and app-client identifiers needed for integration, but does not store the AWS account ID, email addresses, passwords, GitHub tokens, access keys, real per-user Cognito `sub` values, or other private credentials.

## 1. Account and Region

- **AWS account plan:** Free account plan, as reported during setup.
- **Region for application resources:** US East (N. Virginia), **us-east-1**.
- Keep Cognito, DynamoDB, and any future API/Lambda resources in this Region unless there is a deliberate architecture change.
- A budget notification is a warning, not a spending cap. Its cost metric does not tell whether a usage charge is covered by credits or would otherwise be payable. Check the account's credit balance separately.

## 2. Amazon Cognito

| Setting | Current value |
|---|---|
| User Pool display name | User pool - fnzspt |
| User Pool ID | **us-east-1_7dYZw2Is6** |
| App client / application name | Team_FollowUp |
| App client ID | **7id8c2g27fvbh365atqntqurir** |
| Feature plan | Essentials |
| Sign-in selection | Email |
| Self-service registration | Disabled |
| Multi-factor authentication | Off |

The JavaScript Quick setup guide was selected for reference. The app client ID is a public identifier; it is not a password or AWS access key. Before frontend integration, verify that the app client is configured as a browser/public client with **no client secret**.

### Cognito items still pending

- No Cognito managed-login domain, callback URL, or sign-out URL is configured. The current frontend uses direct SRP sign-in, so a hosted-login domain is not required.
- The six standard team accounts and the protected `root` account have not been created, and their `custom:teamUserId` values have not been assigned.
- The operator confirmed that the custom attribute was added, Read is enabled, and Write is disabled for the `Team_FollowUp` app client. Write permission must also be verified as disabled on **every other** app client in the pool. The repository has not queried the live AWS configuration to verify those settings.
- The Quick setup language selector reverting to Angular is only a guide display preference; it does not change the pool configuration.

### `custom:teamUserId` schema record

The attribute was added in the existing pool on **15 October 2026**, according to operator confirmation. The intended schema settings recorded from the console walkthrough are:

| Property | Value |
|---|---|
| Cognito schema name | `teamUserId` |
| Name used by the app and Cognito APIs | `custom:teamUserId` |
| Type | String |
| Minimum length | 1 |
| Maximum length | 32 |
| Mutable at the pool schema level | Yes |

Because the attribute is mutable at the pool level and the frontend uses it to resolve the signed-in team member, app-client **Read** must be enabled for `Team_FollowUp`. The operator confirmed that **Read is enabled and Write is disabled for `Team_FollowUp`**; verify that Write is also disabled for every other app client in the pool. Only a trusted administrator should assign or correct the values. The repository's `backend/scripts/seed_user_profiles_from_cognito.py` reads this attribute, resolves the Cognito `sub`, and prepares corresponding rows in `TeamFollowUp-Users`. These settings are based on operator confirmation and have not been independently queried through the AWS API.

## 3. Amazon DynamoDB

All four tables were created manually in **us-east-1**. Each uses the **Standard** table class, **Provisioned** capacity, **1 RCU and 1 WCU** on the base table, disabled auto scaling, disabled point-in-time recovery, disabled deletion protection, disabled DynamoDB Streams, and the default AWS-owned encryption key. Each configured global secondary index also uses **1 RCU and 1 WCU** with an **All** projection. No optional backups were enabled.

### TeamFollowUp-Items

| Property | Configured value |
|---|---|
| Partition key | **itemId** (String) |
| Sort key | None |
| Base table capacity | 1 RCU / 1 WCU |
| Table class | Standard |

| Global secondary index | Partition key (String) | Sort key (String) | Projection | Capacity |
|---|---|---|---|---|
| **ParentIdIndex** | **parentId** | **createdAt** | All | 1 RCU / 1 WCU |
| **AssignedToIndex** | **assignedTo** | **updatedAt** | All | 1 RCU / 1 WCU |
| **WorkspaceIndex** | **workspaceKey** | **createdAt** | All | 1 RCU / 1 WCU |

### TeamFollowUp-Activity

| Property | Configured value |
|---|---|
| Partition key | **itemId** (String) |
| Sort key | **activityKey** (String) |
| Base table capacity | 1 RCU / 1 WCU |
| Global secondary indexes | None |
| Table class | Standard |

### TeamFollowUp-Users

| Property | Configured value |
|---|---|
| Partition key | **userId** (String) |
| Sort key | None |
| Base table capacity | 1 RCU / 1 WCU |
| Global secondary indexes | None |
| Table class | Standard |

### TeamFollowUp-Archive

| Property | Configured value |
|---|---|
| Partition key | **archiveId** (String) |
| Sort key | None |
| Base table capacity | 1 RCU / 1 WCU |
| Table class | Standard |
| Billing mode | Provisioned |

| Global secondary index | Partition key (String) | Sort key (String) | Projection | Capacity |
|---|---|---|---|---|
| **GSI_ArchiveIndex** | **archivePK** | **archiveSort** | All | 1 RCU / 1 WCU |
| **GSI_ArchiveRoot** | **archiveRootPK** | **archiveRootSort** | All | 1 RCU / 1 WCU |

This table stores archived copies while retaining the original item IDs and hierarchy relationships. `GSI_ArchiveIndex` supports the archive listing; `GSI_ArchiveRoot` indexes rows by their root project/job. The table in this account snapshot was created manually through the AWS Console.

### Capacity summary

The configured capacity totals **9 RCUs and 9 WCUs** across four base tables and five global secondary indexes: Items (1 + three GSIs = 4), Activity (1), Users (1), and Archive (1 + two GSIs = 3). Provisioned capacity can throttle requests that exceed the configured limits; auto scaling is deliberately off.

## 4. AWS Budgets cost monitor

| Setting | Current value |
|---|---|
| Budget name | TeamFollowUp-Monthly-Cost |
| Amount | USD $1 |
| Period | Monthly, recurring |
| Budget type/method | Fixed cost budget |
| Cost metric | Unblended costs |
| Actual-cost alerts | 50%, 80%, and 100% |
| Forecast alert | 100% |
| Notifications | Email, configured in the console |

The budget provides notifications only. It does not stop resources, cap usage, or distinguish between charges covered by promotional/free credits and charges that could otherwise be payable. Credit inclusion depends on the budget configuration; the actual credit balance must be checked in Billing and Cost Management.

## 5. Resources not yet created

As of the date above, these parts of the planned architecture have **not** been created/configured:

- Amplify Hosting app, GitHub branch connection, and final HTTPS website URL.
- API Gateway HTTP API and the Lambda function.
- CloudWatch log groups, dashboard, and alarms.
- Team Cognito accounts and corresponding DynamoDB profile mappings.


No production or live shared-data deployment has been completed.

## 6. Backend integration contract

The handler and `backend/table-schema.json` use the physical table keys and indexes recorded above. That physical schema is the shared contract for the primary Console deployment and the optional from-scratch automation template. The template now creates its own Cognito pool/client and all four tables/indexes; it does **not** take the current pool/table IDs as parameters or adopt existing resources. This account snapshot remains factual, but it is not a deployment dependency.

### Table access contract

- **Items:** top-level project/job listing uses `WorkspaceIndex` (`workspaceKey` / `createdAt`); child listing and hierarchy traversal use `ParentIdIndex` (`parentId` / `createdAt`); assigned work uses `AssignedToIndex` (`assignedTo` / `updatedAt`). The API keeps `ownerId` as the UI field and materializes `assignedTo` for the existing index. Only top-level records receive `workspaceKey=WORKSPACE`.
- **Activity:** event rows use the actual `itemId` partition key and `activityKey` sort key, where `activityKey` is the UTC event timestamp plus `#` plus the event ID. `eventId` is a regular attribute, not the primary key. There are no Activity GSIs, so single-item history uses Query while application-wide history uses Scan.
- **Users:** the primary key remains `userId`. Cognito `sub` values are stored in `cognitoSub`; because this table has no Cognito-subject GSI, Lambda scans this deliberately small seven-profile table and denies missing, duplicate, or disabled mappings.
- **Archive:** the existing `archiveId` key, `GSI_ArchiveIndex`, and `GSI_ArchiveRoot` remain unchanged. Archiving/restore uses the existing table and transaction logic.

The Lambda IAM policy permits Users-table profile edits only through transactions: profile updates atomically update Users and Activity, while pin updates use `TransactWriteItems` without granting standalone `UpdateItem` on Users.

### Optional full-stack automation template

The console-first deployment does not use SAM to create AWS resources. The optional `backend/template.yaml` is a full-stack CloudFormation/SAM template for a separate fresh environment. It creates the Cognito pool/client, Items/Activity/Users/Archive tables and their five GSIs, API Gateway HTTP API, Lambda/IAM, CloudWatch logs/dashboard/alarms, Amplify app/branch and monthly cost budget. Its default `ResourceNamePrefix=TeamFollowUp` reproduces the physical table names used in this account, so **do not deploy it with that default prefix into this same account/Region** while the console-created tables and budget with those names remain. CloudFormation will not automatically adopt them. Use a clean environment or a deliberately unique prefix for automation experiments.

Use [`AUTOMATED_DEPLOYMENT.md`](AUTOMATED_DEPLOYMENT.md) for the full procedure to deploy, verify and clean up an automation stack. This implementation record remains a snapshot of the manually configured current account, not a runbook for adopting those resources into CloudFormation.

The template's deployment-time parameters are:

| Parameter | Purpose |
|---|---|
| `ResourceNamePrefix` | Resource-name prefix; defaults to `TeamFollowUp` to match the console runbook. |
| `RepositoryUrl` | GitHub URL connected to Amplify Hosting. |
| `GitHubAccessToken` | Private deployment-time token used to authorize Amplify's GitHub connection. Never commit it or store it in `samconfig.toml`. |
| `FrontendBranchName` | Branch Amplify should publish; defaults to `main`. |
| `BudgetNotificationEmail` | Private recipient for the $1 monthly budget's email alerts. |

The template calculates the exact branch origin from Amplify's generated app domain for API CORS and supplies the generated API URL and Cognito IDs to the Amplify branch. It does not need the current account's resource IDs as inputs. DynamoDB data resources have `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`, so stack deletion/replacement does not automatically erase table data.

### Required console-first checks

1. In the current account, verify the operator-confirmed `custom:teamUserId` schema settings (String, length 1–32, mutable), Read enabled / Write disabled for `Team_FollowUp`, and Write disabled for every other app client. Confirm this app client has no client secret and supports SRP sign-in.
2. Verify all four DynamoDB tables and their GSIs match the tables above and are `ACTIVE`. Do not recreate or replace tables which already contain application data.
3. Create the six standard administrator-managed Cognito accounts with `custom:teamUserId` values `u1`–`u6`, then create the protected `root` Cognito account with `custom:teamUserId=root`. Set `root@1234` as its initial/temporary password only if it satisfies the existing Cognito password policy; the currently documented pool uses email sign-in, so sign in using the root account's registered email where required. Keep the pool's existing authentication mode unchanged. Run the profile seed script in dry-run mode, then seed all seven profiles into Users.
4. Create Amplify Hosting, Lambda, API Gateway and CloudWatch resources manually using [`DEPLOYMENT.md`](DEPLOYMENT.md). Apply the exact branch HTTPS URL to API CORS and configure the four public Amplify environment variables.
5. If testing the optional template, use a separate clean environment or a different resource prefix and review the changeset before approval. A successful validation/build or CI run does not deploy resources or verify the live AWS account.

The deliberate Scan operations work with the current no-GSI Activity and Users tables and avoid requiring new index capacity. Application-wide activity history reads the full Activity table, so its read cost and latency grow with history volume. Consider a purpose-built timeline GSI only if future scale justifies adding and maintaining it.

## 7. Cost-conscious settings used

- Kept DynamoDB provisioned capacity low and auto scaling disabled.
- Left point-in-time recovery, optional backups, deletion protection, and Streams disabled.
- Used the Standard table class and default AWS-owned encryption.
- Configured a $1 monthly budget with actual and forecast email alerts.
- Amplify/API/backend deployment remained pending in this dated account snapshot; those resources are to be created manually through the console in the primary workflow.

These settings reduce avoidable optional features but do not guarantee that all future AWS services or request usage will always cost $0. Review the Free account plan status, credit balance, budget notifications, and current service pricing as the implementation progresses.

## 8. Frontend release impact recorded on 16 October 2026

The frontend reliability work completed after this account snapshot is client-side only: modal click propagation, hierarchy traversal/type-validation work, and Activity-index lookups used by child-item sorting. It does **not** change the Cognito pool/client contract, the `custom:teamUserId` attribute, API routes or JSON payloads, Lambda handler interface, IAM permissions, the four DynamoDB tables/five GSIs, or Amplify environment-variable names. No migration, index creation, API Gateway change, or Lambda redeployment is required solely for those changes.

For the primary console deployment, publish the new frontend by running `npm run test:all` and building the artifact with `npm run build`, pushing the reviewed source to the Amplify-connected branch, and confirming the new Amplify build is successful. A local AWS build must be supplied the real public `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`, `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`, and `TEAM_FOLLOW_UP_API_BASE_URL` values from Step 9 of the deployment runbook; Amplify supplies its branch variables automatically. If automatic builds are disabled, start one in Amplify Console. The optional SAM template remains a separate from-scratch automation path and should not be run over the console-created resources merely to release frontend changes.

This note records the operational impact of a code release, **not** a new inspection of AWS resources. The account state and pending-resource checklist above remain the dated 15 October 2026 snapshot; update those entries only after the corresponding console resources are actually verified.



## Account page, root profile, and password handling (28 October 2026)

The frontend opens on **My Account → Assigned Items**. The Account page has Profile, Assigned Items, Pinned Items, and Search tabs; the Projects workspace keeps its own Search sidebar and provides a floating collapse/expand control, expanded by default. Display name is separate from Cognito username and is stored in `displayName`; optional Arabic display name and label use `displayNameArabic` and `roleArabic`. Profile edits save profile fields only; language/theme changes persist immediately as separate preference updates. The profile icon choices are stored as names, include `cowboy-hat` and other outline icons, and show a preview before saving.

**Do not replace or bypass Cognito authentication.** Passwords remain Cognito-managed; the app calls Cognito's authenticated password-update API. Do not put plaintext passwords or app-level password hashes in DynamoDB. Create the `root` Cognito identity as an administrator-managed account, set `custom:teamUserId=root` through the trusted console/admin workflow, and add its profile mapping to the Users table using the seeding script. The root profile must have `userId=root`, `displayName=root`, `role=Root`, `icon=crown`, `privilege=Administrator`, the Cognito `sub` in `cognitoSub`, and `enabled=true`. The application/backend prohibit editing the root profile and protect it from privilege changes; root password changes are handled by Cognito, not by editing the DynamoDB profile.

## Password-check release impact recorded on 29 October 2026

The new Profile password form keeps the current-password field in the same two-column grid as the new-password fields. A checkmark for the current password must be backed by verification, not by non-empty input; the new-password confirmation checkmark appears only when both values match and meet the existing eight-character minimum.

For the AWS implementation, the current-password check is a backend-dependent feature and must not be released as HTML-only. Before publishing it in the console-created environment, enable `ALLOW_ADMIN_USER_PASSWORD_AUTH` on the existing public `Team_FollowUp` app client (keep SRP and refresh-token flows), set Lambda `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`, and add the `VerifyCurrentCognitoPassword` statement from `backend/console-lambda-policy.json` with the real User Pool ARN. Publish the updated Lambda package before the frontend build. The handler verifies the requested Cognito username belongs to the same `sub` as the authenticated JWT, returns only a boolean, and never stores or logs the password. The existing authenticated catch-all API route is used; no DynamoDB schema/index migration, new Amplify variable, or new API Gateway route is required.

The account resource inventory near the top of this document remains a dated, operator-reported snapshot from 15 October 2026; it has not been re-queried from AWS as part of this repository review. Treat the preceding settings as required deployment steps until they are verified in the live console.


## Real-time item change delivery (source update: 2 November 2026)

The repositories now contain an authenticated, low-payload real-time notification path. This is a **source-code and target-architecture change only**; it is not confirmation that the new AWS resources have been created in the current account.

The target implementation adds:
- A fifth DynamoDB table, `TeamFollowUp-Realtime`, using partition key `partitionKey`, sort key `sortKey`, and TTL `expiresAt`. It stores a seven-day compact change outbox, short-lived one-use ticket hashes, and renewable WebSocket connection leases.
- A separate API Gateway WebSocket API with `$connect`, `$disconnect`, and `$default` routes, integrated with the existing `TeamFollowUp-Api` Lambda and a `prod` auto-deploy stage.
- Lambda environment variables `REALTIME_TABLE` and `WEBSOCKET_MANAGEMENT_ENDPOINT`, in addition to the existing table/Cognito values.
- The Amplify build variable `TEAM_FOLLOW_UP_REALTIME_WEBSOCKET_URL`, required by the AWS frontend build.

Before releasing this update to the console-created account, create/verify the Realtime table and TTL, create/verify the WebSocket API and routes, add its Lambda invoke permission, update the existing Lambda execution role using `backend/console-lambda-policy.json` with the real account ID, pool ID, and WebSocket API ID, set the two Lambda environment variables, package/publish the updated Lambda, set the Amplify WSS variable, and publish a successful frontend build. Follow the step-by-step instructions in `DEPLOYMENT.md` Sections 3.5, 7, 8.1 and 9. Do not update the live Lambda first: `REALTIME_TABLE` is a required import-time configuration value and the handler will not initialize until that table exists and is configured.

The original four-table `currentConsoleBootstrap` inventory above remains the operator-reported 15 October 2026 snapshot. The new Realtime transport table and WebSocket API are intentionally documented separately and remain **not yet independently verified in the live AWS account**. The four business-data table definitions in `backend/table-schema.json` are unchanged; the additional transport contract is held in its separate `realtimeTransport` section.

The change feed is metadata-only. Item create/update/delete/restore operations persist a compact outbox record alongside the item/audit transaction where supported, and Lambda immediately sends that compact event to every active WebSocket session. Browsers apply the pushed item delta directly so a changed assignment refreshes the affected user's Assigned Items without waiting for a full workspace reload. Each recipient also queries the Activity table by the changed item IDs and merges only those audit events into its local Activity index and application-wide history cache; this uses the Activity table's actual `itemId` partition key and does not depend on a potentially lagging parent/child GSI to discover the changed records. The selected project's Activity timeline and open history views are re-rendered when their root or item is affected. The first successful WebSocket connection revalidates Assigned Items to close the race between the initial data snapshot and ticket creation. In addition, every active application instance independently polls the authenticated cursor feed every five seconds using its own cursor, so a missed push or an unreachable WebSocket connection does not leave that instance permanently stale. Parent Project/Job updates include descendant assignee IDs in the compact event, and Task updates include assignees of their Follow-ups; this refreshes Assigned Items context for users assigned below an edited parent. The cursor feed uses microsecond timestamp precision and a one-minute lookback on each catch-up query to cover delayed transaction commits whose timestamps sort before a newer committed change; event-ID deduplication prevents duplicate refreshes during that overlap. There is no full-workspace broadcast or item content in a notification.

### Browser session continuity and Activity reconciliation (source update: 3 November 2026)

Cognito tokens use Amplify's documented `utils.defaultStorage`, which maps to browser `localStorage` in web browsers. The frontend verifies that the configured Amplify storage provider writes a probe visible in `window.localStorage` before attempting session restoration. The SDK's own storage implementation is retained so all methods required by its `KeyValueStorage` contract are available. Migration from older tab-scoped Cognito entries is verified before the old entries are removed; a migration exception never changes the active provider to `sessionStorage`.

The Cognito token namespace for this app client is the browser-profile session. It is shared by tabs on the same Amplify origin and remains available after refresh, tab closure, and browser restart while Cognito's refresh token remains valid and unrevoked. The frontend listens for `storage` events only for the configured app-client namespace, coalesces token writes/removals, then revalidates using `fetchAuthSession`, `getCurrentUser`, and Cognito attributes. A changed team identity is passed to the existing app auth-change callback, which rehydrates the correct profile and restarts its realtime subscription. A missing/invalid session returns the affected tab to sign-in and stops its WebSocket/polling lifecycle. The storage event never trusts the event payload as an identity; the tab re-reads and verifies the Cognito session through Amplify.

Application sign-out calls Cognito's local `signOut()`, not `signOut({ global: true })`. This clears the current browser app-client session and synchronizes the sign-out to same-origin tabs without revoking the account's sessions on other devices. If the SDK sign-out call fails, the frontend fallback removes only localStorage keys under this Cognito app client's `CognitoIdentityServiceProvider.<clientId>.` namespace. It does not clear other app-client tokens or application cache/preferences. On a protected API response of HTTP 401, the client forces one Cognito token refresh and retries that request once. A transient refresh/API error does not invoke sign-out or clear the saved workspace view. A session is considered invalid only when Cognito cannot restore it or the authenticated team-profile mapping is definitively absent.

Workspace GETs continue to use the version-aware cache contract: the client sends the cached version, the Lambda returns `notModified` when the database snapshot is unchanged, and the client reuses its cached payload. When the version differs, the new database result replaces the cache and is merged into the existing workspace state without treating data reconciliation as a new login. Child items and Activity remain lazily hydrated for the active root.

The authenticated `GET /activity?itemIds=<comma-separated IDs>` query accepts 1–100 changed item IDs and reads their Activity partitions directly with strongly consistent primary-table queries. The WebSocket/cursor event contains IDs and metadata only; the browser fetches the corresponding audit rows after receiving the event. This includes item events for recently created or archived items without requiring a separate item lookup or an eventually-consistent root-index scan. The endpoint uses the existing Activity table and existing authenticated catch-all API route; it does not require a new DynamoDB table, GSI, API Gateway route, or deployment environment variable.

### Global item-name uniqueness (source update: 2 November 2026)

Projects, Jobs, Tasks, and Follow-ups share one global item-name namespace. Names are compared after Unicode NFKC normalization, trimming, repeated-whitespace collapse, and case folding via lowercase comparison. The original entered text remains the display value. Archived items continue to reserve their names; archive and restore do not release or bypass a reservation.

The Lambda validates against active and archived records while the registry is not yet backfilled, then uses permanent `ITEM_NAME#<normalized-name>` / `NAME` reservation rows in `TeamFollowUp-Realtime`. Reservation creation, item writes, audit events, and the compact realtime outbox row are part of the same DynamoDB transaction. A conditional reservation write prevents concurrent creates or renames from claiming the same normalized name. Renaming an item atomically claims its new name and releases its previous reservation. These registry rows intentionally omit `expiresAt`, so the Realtime table TTL cannot expire them.

Before deploying the updated Lambda to an existing environment, pause application writes and run `backend/scripts/backfill_item_name_registry.py` first in dry-run mode, then with `--apply` after resolving any duplicate names it reports. The script scans both Items and Archive, refuses to write the completion marker while duplicates or conflicting reservations remain, and is safe to rerun after partial progress. Once it writes the `ITEM_NAME_REGISTRY` / `VERSION` marker, normal item writes use the reservation key rather than repeatedly scanning the full business tables. The existing Lambda policy already includes the required table-scoped reads and transactional writes on Items, Archive, and Realtime; no new DynamoDB table or GSI is required.
