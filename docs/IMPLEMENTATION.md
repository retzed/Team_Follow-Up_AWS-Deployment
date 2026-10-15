# AWS Console Implementation Record

**Last updated:** 15 October 2026  
**Status:** Initial Cognito, DynamoDB, and budget setup completed manually. The web application is not hosted yet, and the backend is not deployed.

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
- Team accounts have not been created.
- The application's planned **custom:teamUserId** attribute has not yet been verified in this pool. The backend integration must confirm the attribute exists and is readable before using the existing UserProfiles seeding routine.
- The Quick setup language selector reverting to Angular is only a guide display preference; it does not change the pool configuration.

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

## 6. Repository compatibility warning — do not deploy yet

The current repository's **backend/template.yaml** and **backend/src/handler.py** describe a more advanced target schema than the manually created tables:

- The SAM template creates its own Cognito User Pool and client instead of using the existing pool/client above.
- The SAM template's default prefix produces **WorkItems**, **ActivityEvents**, **UserProfiles**, and **Archive** tables, while the manually created application tables are **Items**, **Activity**, and **Users**, plus the already-created **Archive** table.
- The existing **TeamFollowUp-Archive** primary key and both GSIs match the Archive key/index contract in the SAM template and handler. However, the console table uses **Provisioned 1 RCU / 1 WCU** on the base table and each GSI, while the target template uses **on-demand** billing; the console table is also not currently managed by the SAM CloudFormation stack. The default SAM prefix would therefore collide with the existing physical table name.
- The handler expects indexes such as **GSI_ListUpdated**, **GSI_ItemTimeline**, and **GSI_CognitoSub** on the other target tables. Those differ from the manually created Items indexes; the current Activity and Users tables have no GSIs. The Activity table primary key is **itemId + activityKey**, whereas the target ActivityEvents table uses **eventId** as its partition key.

Therefore **do not run `sam deploy` or point the existing Lambda handler at the console-created tables yet**. The Archive table now exists and its key/index schema is verified from the repository's archive implementation, but resource ownership, billing mode, the other table names/keys/indexes, and Cognito integration still need to be reconciled. Deploying now would cause at least a physical-name collision for Archive or create duplicate parallel resources, and runtime query/write failures would remain possible.

## 7. Cost-conscious settings used

- Kept DynamoDB provisioned capacity low and auto scaling disabled.
- Left point-in-time recovery, optional backups, deletion protection, and Streams disabled.
- Used the Standard table class and default AWS-owned encryption.
- Configured a $1 monthly budget with actual and forecast email alerts.
- Left Amplify/API/backend deployment for a later step; new resources and their pricing must be checked before creation.

These settings reduce avoidable optional features but do not guarantee that all future AWS services or request usage will always cost $0. Review the Free account plan status, credit balance, budget notifications, and current service pricing as the implementation progresses.
