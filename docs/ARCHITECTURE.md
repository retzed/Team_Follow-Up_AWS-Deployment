# Team Follow-Up — Deployment Architecture

## Component diagram

```mermaid
flowchart LR
    B[Team member browser]
    A[Amplify Hosting\nStatic HTML build]
    C[Cognito User Pool\nSign-in and token refresh]
    G[API Gateway HTTP API\nJWT authorizer + CORS]
    L[Python Lambda\nValidation + audit rules]
    W[(DynamoDB WorkItems)]
    H[(DynamoDB ActivityEvents)]
    U[(DynamoDB UserProfiles)]
    R[(DynamoDB Archive)]
    CW[CloudWatch\nLogs, metrics, alarms, dashboard]

    B -->|HTTPS page| A
    B -->|Credentials| C
    C -->|JWT access token| B
    B -->|HTTPS API + Bearer token| G
    G -->|Validated requests| L
    L <--> W
    L <--> H
    L <--> U
    L <--> R
    L --> CW
    G --> CW
```

## Authentication and request sequence

```mermaid
sequenceDiagram
    participant User as Team member
    participant UI as Amplify-hosted UI
    participant Auth as Cognito
    participant API as API Gateway
    participant Lambda as Python Lambda
    participant Profile as DynamoDB UserProfiles
    participant Data as DynamoDB work/activity/archive tables

    User->>UI: Enter team credentials
    UI->>Auth: SRP sign-in
    Auth-->>UI: Access token / refresh token
    UI->>API: HTTPS request + Bearer access token
    API->>API: Verify JWT issuer, audience, expiry
    API->>Lambda: Invoke authenticated route
    Lambda->>Profile: Resolve token sub via GSI_CognitoSub
    Profile-->>Lambda: Enabled team profile
    Lambda->>Lambda: Validate type, parent, status, assignee
    Lambda->>Data: Query/update indexed records
    Lambda->>Data: Transactionally write item/archive + audit event
    Lambda-->>UI: JSON response with public fields only
```

## Responsibilities and trust boundaries

- **Amplify Hosting** is a static frontend deployment. Build-time environment variables are public browser configuration, not a place for AWS access keys or application secrets.
- **Cognito** authenticates people but does not define application permissions beyond sign-in. `custom:teamUserId` links a user to one of the configured team IDs; the browser client is not allowed to write this attribute.
- **API Gateway** verifies Cognito JWTs before the Lambda invocation and enforces the configured single-origin CORS policy.
- **Lambda** is the authorization boundary for application data. It maps the verified Cognito `sub` to an enabled profile, derives creator/editor/activity identity from that profile, validates hierarchy rules, strips DynamoDB index attributes from public responses, and returns generic messages for unexpected errors.
- **DynamoDB** is the shared source of truth. Item writes and their corresponding audit events are transactional. Activity history is append-only; archive records preserve hierarchy metadata needed for safe restoration.
- **CloudWatch** stores structured Lambda logs and API access logs, and provides request/error/throttle monitoring. Alarms are created without notification actions; add SNS actions after deployment if the team needs email or paging alerts.

## Data access patterns

| Table | Primary key | Index/query responsibility |
|---|---|---|
| WorkItems | `itemId` | `GSI_ListUpdated`, `GSI_ListCreated`, `GSI_RootUpdated`, `GSI_AssignedUpdated`, `GSI_AssignedCreated` |
| ActivityEvents | `eventId` | `GSI_ItemTimeline`, `GSI_ApplicationTimeline`, `GSI_RootTimeline`, `GSI_ParentTimeline` |
| UserProfiles | `userId` | `GSI_CognitoSub` resolves the authenticated identity |
| Archive | `archiveId` | `GSI_ArchiveIndex`, `GSI_ArchiveRoot` |

All tables use on-demand billing and server-side encryption; point-in-time recovery is enabled by default. WorkItems, ActivityEvents, UserProfiles, Archive, and the Cognito User Pool have retention protection so removing the SAM stack does not automatically erase team data/accounts.

## Deployment boundary

This repository provisions resources through the SAM/CloudFormation template and publishes the UI with Amplify Hosting. No live resources are created just by running `npm run build` or the test suite. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for stack parameters, account seeding, Amplify environment variables, post-deployment verification, and recovery precautions.
