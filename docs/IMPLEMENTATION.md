# AWS Console Implementation Record

**Last updated:** 15 October 2026  
**Status:** Initial Cognito, DynamoDB, and budget setup completed manually. The operator confirmed that `custom:teamUserId` was added to the existing Cognito pool, with Read enabled and Write disabled for the `Team_FollowUp` app client on 15 October 2026. Permission checks on other app clients, team account setup, website hosting, and backend deployment remain pending.

This document records the AWS configuration actually created in the console. It intentionally does not store account IDs, email addresses, passwords, access keys, or other private credentials.

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

- Cognito managed-login domain, callback URL, and sign-out URL have not been configured because Amplify Hosting has not been created and no website origin exists yet.
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

This table stores archived copies while retaining the original item IDs and hierarchy relationships. `GSI_ArchiveIndex` supports the archive listing; `GSI_ArchiveRoot` indexes rows by their root project/job. The table was created manually, not by CloudFormation/SAM.

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
- Cognito hosted-login domain and callback/sign-out URLs.
- Team Cognito accounts and corresponding DynamoDB profile mappings.


No production or live shared-data deployment has been completed.

## 6. Backend integration contract

The repository has now been reconciled with the four manually created DynamoDB tables and the existing Cognito pool/client. The Lambda handler and table-schema reference use the current keys and indexes; the SAM template does **not** create new Cognito or DynamoDB data resources.

### Table access contract

- **Items:** top-level project/job listing uses `WorkspaceIndex` (`workspaceKey` / `createdAt`); child listing and hierarchy traversal use `ParentIdIndex` (`parentId` / `createdAt`); assigned work uses `AssignedToIndex` (`assignedTo` / `updatedAt`). The API keeps `ownerId` as the UI field and materializes `assignedTo` for the existing index. Only top-level records receive `workspaceKey=WORKSPACE`.
- **Activity:** event rows use the actual `itemId` partition key and `activityKey` sort key, where `activityKey` is the UTC event timestamp plus `#` plus the event ID. `eventId` is a regular attribute, not the primary key. There are no Activity GSIs, so single-item history uses Query while application-wide history uses Scan.
- **Users:** the primary key remains `userId`. Cognito `sub` values are stored in `cognitoSub`; because this table has no Cognito-subject GSI, Lambda scans this deliberately small six-user table and denies missing, duplicate, or disabled mappings.
- **Archive:** the existing `archiveId` key, `GSI_ArchiveIndex`, and `GSI_ArchiveRoot` remain unchanged. Archiving/restore uses the existing table and transaction logic.

### SAM ownership and parameters

The SAM stack provisions API Gateway HTTP API, Lambda, its scoped IAM policy, log groups, dashboard, and alarms only. It passes existing resources to the handler with these parameters, whose defaults match the current console bootstrap:

| Parameter | Default |
|---|---|
| `ExistingCognitoUserPoolId` | `us-east-1_7dYZw2Is6` |
| `ExistingCognitoAppClientId` | `7id8c2g27fvbh365atqntqurir` |
| `ExistingItemsTableName` | `TeamFollowUp-Items` |
| `ExistingActivityTableName` | `TeamFollowUp-Activity` |
| `ExistingUsersTableName` | `TeamFollowUp-Users` |
| `ExistingArchiveTableName` | `TeamFollowUp-Archive` |

`TableNamePrefix` now names only the API, Lambda, logs, dashboard, and alarms. It does not rename or provision the existing tables. The SAM stack does not import, replace, or manage those data resources; stack deletion will not delete them.

### Required pre-deployment verification

1. Verify that `custom:teamUserId` exists. The operator confirmed Read is enabled and Write is disabled for the `Team_FollowUp` browser app client; verify Write is disabled for every other app client too. Confirm the app client has **no client secret** and supports the frontend's sign-in flow.
2. Confirm that the four tables are `ACTIVE`, and that the three Items indexes plus the two Archive indexes are `ACTIVE`.
3. Confirm the six Cognito accounts exist, have unique `custom:teamUserId` values `u1`–`u6`, and that the matching `cognitoSub` profile records have been seeded into `TeamFollowUp-Users`.
4. Use the final Amplify HTTPS origin for `AllowedOrigin`, and review the CloudFormation change set. The stack must create only API/backend/monitoring resources, not a second user pool or DynamoDB tables.

The deliberate Scan operations work with the current no-GSI Activity and Users tables and avoid requiring new billable index capacity. Application-wide activity history will read the full Activity table, so its read cost/latency will grow with history volume. Consider a purpose-built timeline GSI only if future scale justifies adding and maintaining it.

## 7. Cost-conscious settings used

- Kept DynamoDB provisioned capacity low and auto scaling disabled.
- Left point-in-time recovery, optional backups, deletion protection, and Streams disabled.
- Used the Standard table class and default AWS-owned encryption.
- Configured a $1 monthly budget with actual and forecast email alerts.
- Left Amplify/API/backend deployment for a later step; new resources and their pricing must be checked before creation.

These settings reduce avoidable optional features but do not guarantee that all future AWS services or request usage will always cost $0. Review the Free account plan status, credit balance, budget notifications, and current service pricing as the implementation progresses.
