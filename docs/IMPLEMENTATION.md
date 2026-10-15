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

All three tables were created in **us-east-1**. Each uses the **Standard** table class, **Provisioned** capacity, **1 RCU and 1 WCU** on the base table, disabled auto scaling, disabled point-in-time recovery, disabled deletion protection, disabled DynamoDB Streams, and the default AWS-owned encryption key. No optional backups were enabled.

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

### Capacity summary

The configured capacity totals **6 RCUs and 6 WCUs** across the three base tables and the three indexes on TeamFollowUp-Items: four read/write units for the Items table plus its indexes, one for Activity, and one for Users. Provisioned capacity can throttle requests that exceed the configured limits; auto scaling is deliberately off.

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
- An Archive table.

No production or live shared-data deployment has been completed.

## 6. Repository compatibility warning — do not deploy yet

The current repository's **backend/template.yaml** and **backend/src/handler.py** describe a more advanced target schema than the manually created tables:

- The SAM template creates its own Cognito User Pool and client instead of using the existing pool/client above.
- The SAM template defines four tables with the physical suffixes **WorkItems**, **ActivityEvents**, **UserProfiles**, and **Archive**, rather than the current console names **Items**, **Activity**, and **Users**.
- The handler expects indexes such as **GSI_ListUpdated**, **GSI_ItemTimeline**, **GSI_CognitoSub**, and **GSI_ArchiveIndex**. Those indexes are not the same as the three current Items indexes; the current Activity and Users tables have no GSIs.
- The Activity table primary key is currently **itemId + activityKey**, whereas the current handler's target ActivityEvents table uses **eventId** as its partition key.

Therefore **do not run sam deploy or point the existing Lambda handler at the console-created tables yet**. Doing so would create duplicate resources or runtime query/write failures. The next implementation step must deliberately reconcile the SAM resource ownership, Lambda data model, and actual table/index schema before the app is connected. This record distinguishes what exists today from what the repository intends to provision.

## 7. Cost-conscious settings used

- Kept DynamoDB provisioned capacity low and auto scaling disabled.
- Left point-in-time recovery, optional backups, deletion protection, and Streams disabled.
- Used the Standard table class and default AWS-owned encryption.
- Configured a $1 monthly budget with actual and forecast email alerts.
- Left Amplify/API/backend deployment for a later step; new resources and their pricing must be checked before creation.

These settings reduce avoidable optional features but do not guarantee that all future AWS services or request usage will always cost $0. Review the Free account plan status, credit balance, budget notifications, and current service pricing as the implementation progresses.
