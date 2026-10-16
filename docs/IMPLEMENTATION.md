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
- The six team accounts have not been created, and their `custom:teamUserId` values have not been assigned.
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
- **Users:** the primary key remains `userId`. Cognito `sub` values are stored in `cognitoSub`; because this table has no Cognito-subject GSI, Lambda scans this deliberately small six-user table and denies missing, duplicate, or disabled mappings.
- **Archive:** the existing `archiveId` key, `GSI_ArchiveIndex`, and `GSI_ArchiveRoot` remain unchanged. Archiving/restore uses the existing table and transaction logic.

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
3. Create the six administrator-managed Cognito accounts and assign unique `custom:teamUserId` values `u1`–`u6`. Seed the matching `cognitoSub` values to the Users table with the trusted seeding script after a dry run.
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

For the primary console deployment, publish the new frontend by running `npm run test:all` and `npm run build`, pushing the reviewed source to the Amplify-connected branch, and confirming the new Amplify build is successful. If automatic builds are disabled, start one in Amplify Console. The optional SAM template remains a separate from-scratch automation path and should not be run over the console-created resources merely to release frontend changes.

This note records the operational impact of a code release, **not** a new inspection of AWS resources. The account state and pending-resource checklist above remain the dated 15 October 2026 snapshot; update those entries only after the corresponding console resources are actually verified.

