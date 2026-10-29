# Team Follow-Up Application — Complete Project Documentation

**Document purpose:** consolidated system analysis, design, data modeling, behavior, UI/UX, API, security, testing, operations, and deployment reference.

**Documentation reviewed:** 16 October 2026. The account-specific resource status remains the dated 15 October 2026 snapshot recorded in the implementation record; frontend changes later than that date do not imply that AWS resources were created or modified. This document describes the complete target architecture and repository implementation, while keeping the current AWS-account snapshot distinct from target-state assumptions. The primary deployment method is manual creation/configuration through the AWS Management Console. `backend/template.yaml` is maintained as an optional full-stack CloudFormation/SAM automation template for a fresh environment. A passing CI workflow is not proof of a live AWS deployment.

## Contents

1. [Executive summary](#1-executive-summary)
2. [System analysis and design](#2-system-analysis-and-design)
3. [Architecture and components](#3-architecture-and-components)
4. [Database design and data modeling](#4-database-design-and-data-modeling)
5. [Data flow and system behavior](#5-data-flow-and-system-behavior)
6. [UI/UX design and wireframes](#6-uiux-design-and-wireframes)
7. [Technology stack and integrations](#7-technology-stack-and-integrations)
8. [API documentation](#8-api-documentation)
9. [Security and privacy](#9-security-and-privacy)
10. [Testing and validation](#10-testing-and-validation)
11. [Deployment and operations](#11-deployment-and-operations)
12. [Known limitations, risks, and next steps](#12-known-limitations-risks-and-next-steps)
13. [Glossary](#13-glossary)

---

## 1. Executive summary

Team Follow-Up is a shared, bilingual (English/Arabic) workspace for tracking projects, temporary jobs, tasks, and follow-ups. Team members sign in through Amazon Cognito. Work items, assignments, archive records, and activity history are persisted through an authenticated API backed by Amazon DynamoDB.

The application is designed as a serverless web system. The browser contains the HTML, CSS, and JavaScript user interface; Amazon Cognito manages authentication; Amazon API Gateway validates JWTs; a Python AWS Lambda function applies application rules; DynamoDB stores the persistent records; and CloudWatch provides logs and monitoring. AWS Amplify Hosting is intended to publish the web frontend.

### 1.1 Current implementation and deployment boundary

The repository includes the frontend, Cognito integration, API client, Python Lambda handler, target DynamoDB schema contract, administrative scripts, test suites, deployment runbooks, and an optional full-stack CloudFormation/SAM template.

**Primary deployment method:** the project team creates and configures its resources manually through the AWS Management Console. The current implementation record is a dated snapshot of what has been configured in the user's current account; it is not a set of prerequisites that the design or automation method assumes.

As reported in the account-specific snapshot dated **15 October 2026**, the following were created manually in `us-east-1`:

- A Cognito User Pool and browser app client.
- Four DynamoDB tables—Items, Activity, Users, and Archive—with five GSIs.
- A monthly AWS Budgets notification configuration.

The operator confirmed that `custom:teamUserId` was added and that the `Team_FollowUp` app client has Read enabled and Write disabled. Write permissions for other app clients still require verification. In that snapshot, the six team user accounts and their profile mappings, Amplify Hosting, API Gateway/Lambda, and CloudWatch operational resources remained pending. The frontend uses direct Cognito SRP sign-in; a Cognito managed-login domain and OAuth callback/sign-out URLs are not required.

**Optional automation method:** `backend/template.yaml` creates the full architecture from scratch: Cognito pool/client, all four DynamoDB tables and indexes, API Gateway, Lambda and scoped IAM, CloudWatch logs/dashboard/alarms, Amplify Hosting app/branch, and the monthly budget. It does not accept existing pool IDs, table names, or a pre-created Amplify origin. Its default resource prefix matches the console naming contract, so do not deploy it with default names over the account's manually created resources; CloudFormation does not automatically adopt them. Use a clean environment or unique prefix for automation tests.
## 2. System analysis and design

### 2.1 Problem statement

Team work can be split across separate conversations, spreadsheets, or informal updates. This makes it harder to identify ownership, understand progress, preserve decisions, and see recent changes in one place. A shared team workspace needs a consistent record of each item, its parent, assignee, status, priority, timestamps, and change history.

The project addresses this problem by providing one authenticated workspace where authorized team members share the same persisted data and activity record. It is not designed as a local-only demo or an offline database application.

### 2.2 Objectives

1. Centralize team projects, temporary jobs, tasks, and follow-ups in one shared workspace.
2. Make ownership, status, priority, due dates, and recent updates visible to the team.
3. Preserve an append-only activity history of meaningful work-item changes.
4. Enforce valid parent/child relationships and validate business fields on the server.
5. Allow archived items and their hierarchies to be restored after dependency checks.
6. Support English and Arabic, light and dark themes, and responsive desktop/mobile layouts.
7. Use managed AWS services with scoped access, automated tests, operational visibility, and cost-aware configuration.

### 2.3 Scope

**In scope**

- Cognito sign-in, sign-out, supported account challenges, password recovery, and signed-in password changes through Amplify Auth `updatePassword`.
- Team identity mapping from the Cognito custom attribute to an application team profile.
- Creation, viewing, searching, filtering, assignment, and editing of work items.
- Overview metrics, item-level history, hierarchy-level history, application-wide history, Archive listing, and restore.
- Responsive bilingual UI, theme selection, server-side validation, optimistic-concurrency conflict detection, and API-backed persistence.
- Automated unit/regression/infrastructure checks and documented AWS deployment workflow.

**Out of scope or not yet delivered**

- A live public deployment: Amplify Hosting and the backend stack are not yet recorded as deployed.
- A local/mock database, offline persistence, or a local authentication fallback.
- Fine-grained authorization by display-role label. Team role labels are descriptive; they do not grant additional permissions.
- A promise of zero AWS cost. Provisioned resources, traffic, logs, hosting, and other usage can generate charges.
- Backup/recovery guarantees for existing DynamoDB tables: point-in-time recovery is currently disabled in the documented bootstrap.

### 2.4 System actors

| Actor | Purpose and interactions |
|---|---|
| Team member | Signs in, views shared work, creates or updates items, changes assignment/status/priority, searches, reviews activity, and archives/restores items. |
| Cognito administrator / team administrator | Creates and manages team accounts, assigns each account a unique team ID, and maintains the Cognito-subject-to-profile mapping in the Users table. |
| Deployment maintainer | Creates/configures AWS resources through the console, records generated IDs privately, maintains team mappings, configures Amplify/API/Lambda/CloudWatch, and maintains CI. May use the optional full-stack SAM template in a separate fresh environment. |
| AWS managed services | Cognito authenticates; API Gateway validates tokens; Lambda enforces rules; DynamoDB stores data; CloudWatch records operational telemetry. These are system components, not human application users. |

The current application does not grant different application privileges based on labels such as Team Leader or AWS Engineer. Every enabled team member mapped to a valid profile operates within the shared application rules.

### 2.5 Use case diagram

~~~mermaid
flowchart LR
    Member[Team member]
    Admin[Team / Cognito administrator]
    Maintainer[Deployment maintainer]

    subgraph App[Team Follow-Up application]
        UC1([Sign in / recover password])
        UC2([View projects and jobs])
        UC3([Search and filter work])
        UC4([Create or update items])
        UC5([Assign work and update status])
        UC6([Review item and application activity])
        UC7([Archive a hierarchy])
        UC8([Restore archived items])
        UC9([Sign out])
        UC10([Manage team-account mapping])
        UC11([Deploy and monitor system])
    end

    Member --> UC1
    Member --> UC2
    Member --> UC3
    Member --> UC4
    Member --> UC5
    Member --> UC6
    Member --> UC7
    Member --> UC8
    Member --> UC9
    Admin --> UC10
    Maintainer --> UC11
    UC1 -. authenticated session .-> UC2
    UC1 -. authenticated session .-> UC4
~~~

#### Use case descriptions

| Use case | Preconditions | Main flow | Important alternative/error flow |
|---|---|---|---|
| Sign in | Cognito and public app-client configuration is available; account exists. | User submits username/password; Cognito returns success or a supported challenge; frontend resolves the team ID and starts the authenticated workspace. | Invalid credentials, unsupported challenge, missing team ID, or absent/disabled profile blocks workspace access. |
| Browse workspace | Authenticated account resolves to one enabled profile. | Frontend loads users, top-level items, children, and activity via API calls. | Network/API errors show a load failure and allow retry; missing mappings are denied by the API. |
| Create/update item | User is authenticated; parent and assignee are valid if applicable. | Frontend sends a request; Lambda derives actor and timestamps, validates type/hierarchy/fields, and writes the item and audit events transactionally. | Invalid values return a client error; stale versions return a conflict requiring refresh. |
| Search/assign | Work-item data is available. | User searches names/descriptions and filters by item type, status, priority, date range, or current-user assignment. | Results may be paginated; global data scans have scaling limits noted below. |
| Review activity | Events exist for the item or requested scope. | Frontend requests item, hierarchy, or application activity and displays events newest first. | Direct activity creation/edit/deletion endpoints are rejected to preserve audit integrity. |
| Archive | The selected live item exists. | API gathers the requested item's descendants, stores archive snapshots, removes active records, and appends audit events. | Transaction conflicts may cause a conflict response; refresh the workspace and Archive before retrying. |
| Restore | Requested archive records exist and required parents are active or included in the restore selection. | Lambda validates each parent/child relation and restores the selection in bounded transactions. | Invalid/missing parents are rejected; if a later chunk fails, some records may already be restored and must be reconciled by refreshing Archive. |
| Administer team mapping | Operator has privileged AWS access. | Administrator-managed Cognito accounts get unique team IDs; the seeding script maps Cognito subjects into Users records. | Missing, duplicate, unsupported, or incomplete mappings fail validation before profile writes. |

### 2.6 Functional requirements

| ID | Requirement | Design/verification |
|---|---|---|
| FR-01 | Authenticate users through Amazon Cognito; no anonymous access to work data. | Implemented in frontend auth and API JWT-authorizer design; live deployment pending. |
| FR-02 | Map an authenticated Cognito identity to exactly one enabled team profile. | Lambda resolves verified JWT subject to Users.cognitoSub; missing/duplicate/disabled mapping is denied. |
| FR-03 | List top-level projects and jobs. | WorkspaceIndex query on Items. |
| FR-04 | Enforce valid hierarchy: Project → Tasks and Follow-ups; Job → Follow-ups; Task → Follow-ups; Follow-up → no children. | Lambda validation and restore validation. |
| FR-05 | Create and edit items with validated name, description, type, status, priority, assignee, and due date. | Server-side validation is implemented; status and priority enumerations are documented below. |
| FR-06 | Record actor identity, timestamps, and version from trusted server-side data. | Lambda overwrites client-supplied identity/timestamp/version fields. |
| FR-07 | Show work assigned to the signed-in member and allow search/filtering. | AssignedToIndex and API filter parameters. |
| FR-08 | Record and retrieve item, hierarchy, and application-wide activity. | Activity writes are coupled to mutations; direct event mutation is prohibited. |
| FR-09 | Archive an item with its descendants and preserve enough metadata for listing and restore. | Archive table and root/item indexes. |
| FR-10 | Restore selected archived items only when the hierarchy is valid. | Parent existence/type checks and chunked transactional restores. |
| FR-11 | Support English/Arabic, light/dark presentation, and responsive layouts. | Frontend includes bilingual labels and responsive styling. |
| FR-12 | Provide operational logs, dashboard metrics, and alarms for key backend failures. | Create logs/dashboard/alarms through the console in the primary workflow; the optional full-stack template defines the same target observability resources. Alarm notification actions require separate configuration. |

### 2.7 Non-functional requirements

| ID | Requirement | Current approach / caveat |
|---|---|---|
| NFR-01 Security | Authenticate API requests and derive user identity from verified claims. | Cognito JWT authorizer + Lambda profile resolution; do not trust actor IDs from the browser. |
| NFR-02 Integrity | Avoid partial item/audit writes and reject invalid hierarchies. | DynamoDB transactions, conditional writes, hierarchy validation; restore uses bounded chunks and can report partial progress. |
| NFR-03 Concurrency | Detect edits made from stale client snapshots. | Version condition; conflict response asks client to refresh. |
| NFR-04 Maintainability | Keep deployment contract and table schema documented and regression-tested. | SAM, JSON table contract, Python/Node tests, GitHub Actions. |
| NFR-05 Usability | Provide bilingual labels and responsive forms, cards, and navigation. | English/Arabic and light/dark support exist in the frontend; usability/accessibility still requires human testing. |
| NFR-06 Performance | Avoid unbounded result payloads and use current indexes for core list patterns. | Query page size is bounded; application-wide history and Users lookup scan their small tables and will become more expensive as data grows. |
| NFR-07 Cost awareness | Keep initial provisioned capacity low and avoid unnecessary indexes. | Four tables and five GSIs are documented at 1 RCU/1 WCU each. This is not a zero-cost guarantee. |
| NFR-08 Recoverability | Preserve archive records and provide operational visibility. | Application-level archive is available; DynamoDB point-in-time recovery is disabled and should be reconsidered before production use. |
| NFR-09 Compatibility | Keep the console deployment and from-scratch automation template aligned without accidental resource collisions. | Both methods use the same DynamoDB keys/indexes and service configuration; the full-stack template creates its own Cognito/DynamoDB resources and must run in a clean environment or with a distinct prefix. |
| NFR-10 Privacy | Never place AWS credentials or private identity mappings in the frontend repository. | Public Cognito IDs are frontend configuration; AWS credentials and actual Cognito subject mappings stay in administrator-controlled environments. |

### 2.8 Business validation rules

- A work-item name is required and may not exceed 200 characters.
- Description must be text and may not exceed 5,000 characters.
- Supported item types are **project**, **job**, **task**, and **followup**.
- Supported statuses are **not-started**, **in-progress**, **on-hold**, and **completed**. The UI's “Not Completed” filter means any status except completed; it is a filter, not a stored status.
- Child-item priorities are **low**, **medium**, **high**, and **urgent**.
- A due date, when supplied, must use **YYYY-MM-DD**.
- Projects and jobs cannot have a parent.
- Child items require a valid parent. A Project may contain Tasks and Follow-ups; a Job or Task may contain Follow-ups only; Follow-ups cannot contain children.
- Parent changes must not introduce a hierarchy cycle.
- An assignee, when supplied, must refer to an enabled team member. A missing assignee is stored as unassigned.
- Creator, editor, update/create timestamps, root IDs, index keys, deletion markers, and version are server-controlled rather than trusted from the client.

## 3. Architecture and components

### 3.1 Architecture style

The application uses a **serverless, managed-services architecture** with separate presentation, identity, API/validation, persistence, and observability responsibilities. The backend is a single Lambda request handler with route dispatch and shared validation helpers; it is not a set of independently deployed microservices. The frontend is implemented in the repository's HTML/CSS/JavaScript page and build script.

### 3.2 High-level component diagram

~~~mermaid
flowchart TB
    Browser[Browser UI<br/>HTML + CSS + JavaScript]
    AuthSDK[Amplify Auth modules]
    Cognito[Amazon Cognito<br/>User Pool + App Client]
    API[API Gateway HTTP API<br/>JWT Authorizer + CORS]
    Lambda[Python 3.12 Lambda<br/>route dispatch, validation, transactions]
    Items[(DynamoDB Items)]
    Activity[(DynamoDB Activity)]
    Users[(DynamoDB Users)]
    Archive[(DynamoDB Archive)]
    CW[CloudWatch Logs, Dashboard, Alarms]
    Amplify[Amplify Hosting<br/>frontend publication]
    GitHub[GitHub Repository + Actions]

    Browser --> AuthSDK
    AuthSDK <--> Cognito
    Browser -->|Bearer JWT| API
    API --> Lambda
    Lambda <--> Items
    Lambda <--> Activity
    Lambda <--> Users
    Lambda <--> Archive
    API --> CW
    Lambda --> CW
    GitHub -->|build artifact| Amplify
    Amplify -->|serves frontend| Browser
~~~

### 3.3 Component responsibilities

| Component | Responsibility | Boundary |
|---|---|---|
| Frontend | Sign-in UX, workspace rendering, filtering, forms, activity/archive views, bilingual/theme behavior. | Holds transient view state; does not persist work data locally. |
| Cognito | Verifies credentials and issues tokens; exposes the custom team ID attribute to the configured client. | Does not store the application's work items. |
| API Gateway HTTP API | Validates signed JWT issuer/audience, applies CORS, forwards requests, and records access logs. | All application routes are intended to use the Cognito JWT authorizer. |
| Lambda | Resolves team identity, validates user input and hierarchy, prepares index keys, writes audit events, archives/restores records, and maps errors to API responses. | IAM is scoped to the four target tables and required operations. |
| Items table | Active work items and fields needed by the hierarchy, workspace, and assignment queries. | Active records only; archived copies live separately. |
| Activity table | Append-only audit rows for work-item changes. | The target schema has no GSI; global activity uses Scan. |
| Users table | Team display names, descriptive roles, enabled flag, and Cognito subject mapping. | The target schema has no Cognito-subject GSI; the small table is scanned. |
| Archive table | Archived item snapshots and index attributes for archive/root listings. | Restoration validates dependencies before reinserting active records. |
| CloudWatch | API access logs, Lambda logs, performance dashboard, and alarms. | Alarm actions do not notify anyone unless configured separately. |
| Amplify Hosting | Builds and serves the static frontend from the repository. | In the 15 October 2026 current-account snapshot, Hosting deployment was pending. |

### 3.4 Authentication and request-flow summary

1. The user signs in through Cognito using the browser authentication integration.
2. The frontend reads the configured custom attribute **custom:teamUserId** and expects one of the configured team IDs **u1–u6** or **root**. If the account has no valid team ID, the frontend blocks entry to the workspace.
3. The frontend obtains a token and sends it in the **Authorization: Bearer** header.
4. API Gateway validates the JWT against the configured Cognito user-pool issuer and public app-client audience.
5. Lambda maps the verified token's **sub** to exactly one enabled Users-table row using **cognitoSub**. Missing, duplicate, or disabled mappings are denied.
6. Lambda queries or modifies the four configured DynamoDB tables and returns JSON to the frontend.

**Both mappings must agree:** the Cognito user's custom team ID identifies the frontend team member, while the token's Cognito subject must map to the matching enabled row in the Users table.

### 3.5 Complete deployment diagram

~~~mermaid
flowchart TB
    subgraph UserDevice[Team member device]
        Browser[Modern web browser]
    end

    subgraph AWSRegion[US East N. Virginia - us-east-1]
        subgraph PublicEntry[Public managed endpoints]
            Hosting[Amplify Hosting<br/>HTTPS website]
            Pool[Cognito User Pool<br/>public browser app client]
            HttpApi[API Gateway HTTP API<br/>$default stage]
        end
        subgraph Compute[Serverless backend]
            Function[Python 3.12 Lambda<br/>256 MB / 20 second timeout]
        end
        subgraph Storage[Target DynamoDB tables]
            T1[(Items)]
            T2[(Activity)]
            T3[(Users)]
            T4[(Archive)]
        end
        subgraph Observability[Operations]
            Logs[CloudWatch log groups]
            Dashboard[CloudWatch dashboard]
            Alarms[CloudWatch alarms]
        end
    end
    Budget[AWS Budgets<br/>account-level monthly cost alerts]
    GitHub[GitHub repository]

    GitHub -->|branch build| Hosting
    Browser -->|HTTPS| Hosting
    Browser <-->|SRP sign-in / tokens| Pool
    Browser -->|Authenticated HTTPS API call| HttpApi
    HttpApi --> Function
    Function <--> T1
    Function <--> T2
    Function <--> T3
    Function <--> T4
    HttpApi --> Logs
    Function --> Logs
    Logs --> Dashboard
    Function --> Alarms
    HttpApi --> Alarms
    Budget -.->|email cost warnings| Operator[Budget recipient]
~~~

This is the **complete target architecture**, not a claim that all resources currently exist in the user's account. The separate [implementation record](IMPLEMENTATION.md) documents the 15 October 2026 current-account snapshot. The normal workflow is to create resources through the console. The alternate template creates these components from scratch and is not intended to adopt the resources in that snapshot.

### 3.6 Backend component interfaces

- Frontend-to-backend interface: JSON over HTTPS, authenticated with the Cognito access token.
- API Gateway-to-Lambda interface: HTTP API proxy event.
- Lambda-to-DynamoDB interface: AWS SDK for Python (**boto3**) with table/index names supplied through environment variables.
- Operator tooling: AWS CLI plus Python administrative scripts for Cognito-to-Users mappings.
- Source/deployment interface: GitHub repository and Actions provide source control/validation; Amplify builds the frontend. The primary workflow creates/configures all AWS resources through the console; the optional SAM template provisions the full stack from scratch.

## 4. Database design and data modeling

### 4.1 Data model overview (ERD)

The following logical data-model diagram describes the entities and relationships. DynamoDB does **not** enforce relational foreign keys; the links are represented by item attributes and validated by Lambda.

~~~mermaid
flowchart LR
    COGNITO["Cognito Account<br/>sub<br/>custom:teamUserId<br/>username<br/>enabled"]
    TEAM["Team Profile<br/>userId (PK)<br/>displayName<br/>role<br/>cognitoSub<br/>enabled"]
    ITEM["Work Item<br/>itemId (PK)<br/>type, name<br/>parentId, rootParentId<br/>ownerId, status, priority<br/>createdAt, updatedAt, version"]
    ACTIVITY["Activity Event<br/>itemId (PK)<br/>activityKey (SK)<br/>eventId, actorUserId<br/>action, kind, at"]
    ARCHIVE["Archive Snapshot<br/>archiveId (PK)<br/>itemId, archiveRootId<br/>archiveParentId<br/>archivedAt, archivedByUserId"]

    COGNITO -->|1:1 subject mapping| TEAM
    TEAM -->|1:N creates or updates| ITEM
    TEAM -->|optional assignee, many items| ITEM
    ITEM -->|parent-child 1:N| ITEM
    ITEM -->|1:N activity history| ACTIVITY
    ITEM -->|zero or one archive snapshot| ARCHIVE
~~~

This diagram focuses on entity relationships; the activity event timestamp's physical DynamoDB attribute name is `at`, as documented in the Activity events attribute table below. The **Team Profile** table and the Cognito identity are separate records joined by identity values. WorkItem attribution fields also reference team IDs. Activity rows point to an item ID and preserve snapshots of item/root names and types so history remains understandable when active items are renamed or archived. Archive rows retain item IDs and hierarchy metadata to support restore.

### 4.2 Target physical DynamoDB schema

All tables use the DynamoDB Standard table class, provisioned capacity, and the default AWS-owned encryption key in the documented setup. Each base table and each GSI is recorded at **1 RCU / 1 WCU**. Across four base tables and five GSIs, the initial configuration totals **9 RCUs and 9 WCUs**.

| Table | Primary key | GSIs | Primary purpose |
|---|---|---|---|
| **TeamFollowUp-Items** | Partition: **itemId** (String); no sort key | **ParentIdIndex**: parentId / createdAt. **AssignedToIndex**: assignedTo / updatedAt. **WorkspaceIndex**: workspaceKey / createdAt. | Active projects, jobs, tasks, and follow-ups. |
| **TeamFollowUp-Activity** | Partition: **itemId** (String); sort: **activityKey** (String) | None | Append-only change history. |
| **TeamFollowUp-Users** | Partition: **userId** (String); no sort key | None | Team profile, enabled flag, descriptive role, Cognito subject mapping. |
| **TeamFollowUp-Archive** | Partition: **archiveId** (String); no sort key | **GSI_ArchiveIndex**: archivePK / archiveSort. **GSI_ArchiveRoot**: archiveRootPK / archiveRootSort. | Archived copies and archive/root listings. |

The target schema contract is maintained in [table-schema.json](../backend/table-schema.json). The console deployment and the optional full-stack template must create these same table names, primary keys, GSIs, projections, and provisioned capacities. The template creates the tables itself; it does not take existing table names as parameters.

### 4.3 Logical attributes and interpretation

#### Work items (Items)

| Attribute | Meaning |
|---|---|
| itemId | Stable unique identifier for the active item. Exposed to frontend as id. |
| type | project, job, task, or followup. |
| name / description | User-facing content; name is required and capped at 200 characters, description is optional and capped at 5,000. |
| parentId | Immediate parent for a task/follow-up. Absent for projects/jobs. |
| rootParentId | Top-level project/job ID for descendants; the root item points to itself. |
| ownerId | Business-facing team ID assigned to the item; nullable when unassigned. |
| assignedTo | Materialized copy of ownerId for AssignedToIndex. Not exposed as the primary business field. |
| workspaceKey | Set to WORKSPACE on top-level records so WorkspaceIndex can find projects/jobs. |
| status | not-started, in-progress, on-hold, or completed. |
| priority | low, medium, high, or urgent for task/follow-up priority. |
| createdByUserId / updatedByUserId | Server-derived IDs of the team members who created or last updated the item. |
| createdAt / updatedAt | Server-generated ISO timestamp strings. |
| dueDate | Optional calendar date in YYYY-MM-DD form. |
| version | Incremented on updates and used in conditional writes to reject stale edits. |

#### Activity events

| Attribute | Meaning |
|---|---|
| itemId | Partition key tying the event to the item. |
| activityKey | Sort key constructed as event timestamp + # + unique event ID. |
| eventId | Stable event identifier stored as a normal attribute, not the table key. |
| actorUserId | Server-resolved team user who performed the action. |
| itemNameSnapshot / itemTypeSnapshot | Item name/type at the time of the event. |
| rootParentId / rootParentName / rootParentType | Context for the project/job timeline. |
| parentId / ancestorIds | Hierarchy context where applicable. |
| action / summary / kind / at | Human-readable action, action category, and event time. |
| bulkOperation / affectedCount / affectedDescendantCount | Additional metadata for subtree archive/restore summaries when present. |

#### Team profiles (Users)

| Attribute | Meaning |
|---|---|
| userId | Stable team ID: expected values u1 through u6. |
| displayName | Display label used by the UI. |
| role | Descriptive title only; it does not grant authorization. |
| enabled | If false, the account-to-profile mapping is denied by the backend. |
| cognitoSub | Cognito token subject mapped to this profile. Must be unique across team rows. |

#### Archive records

Archive records preserve the original item data and ID while adding archive fields such as **archiveId**, **archiveRootId**, **archiveRootName**, **archiveRootType**, **archiveParentId**, **archiveParentName**, **archivedAt**, and **archivedByUserId**. Materialized **archivePK/archiveSort** and **archiveRootPK/archiveRootSort** fields support the two archive indexes. Archived records are removed from the active Items table; activity history remains in the Activity table.

### 4.4 Access patterns and indexing

| Access pattern | Table/index | Notes |
|---|---|---|
| List projects and jobs | Items / WorkspaceIndex | Query partition where workspaceKey = WORKSPACE. |
| List children under a parent | Items / ParentIdIndex | Query parentId; sort key is createdAt. |
| Find assigned items | Items / AssignedToIndex | Query assignedTo; sort key is updatedAt. |
| Read one item's history | Activity primary key | Query itemId, sorted by activityKey. |
| Read history across an item's hierarchy | Items hierarchy + Activity queries | Resolves relevant item IDs, then retrieves their events. |
| Read application-wide history | Activity Scan | Current table has no timeline GSI; cost and latency grow with retained history. |
| Resolve Cognito subject | Users Scan | Current Users table has no cognitoSub GSI; acceptable only while the team table remains small. |
| List archive / filter by root | Archive / GSI_ArchiveIndex and GSI_ArchiveRoot | Server also applies type, text, root, and pagination filters. |

### 4.5 Normalization and denormalization

DynamoDB is a key-value/document database rather than a relational database, so SQL-style normalization is not directly applied. This design intentionally duplicates a limited number of values to support known access patterns:

- ownerId is copied to assignedTo for the assignment index.
- workspaceKey is stored on top-level items for workspace listing.
- rootParentId is stored on descendants for root/hierarchy operations.
- Activity snapshots preserve names/types at event time.
- Archive records retain hierarchy snapshots and additional indexed key attributes.

These duplicated fields must be maintained by the API. The backend strips or rebuilds server-owned index attributes rather than trusting them from a browser request. The target primary keys and indexes are the shared physical contract for console-created and template-created environments; adding a new GSI is an AWS resource/cost decision and requires an explicit migration and documentation update.

### 4.6 Integrity and transaction model

- Create/update operations write the item and its normalized audit events in a DynamoDB transaction.
- Updates condition on the previous version. A stale version returns HTTP 409 instead of silently overwriting another member's changes.
- Archive uses bounded transactions to preserve archived records, remove active records, and record audit summaries. The handler includes a compensating reconciliation path for archive transaction failures.
- Restore checks that required parents exist and that the selected child type is valid for the parent. It processes records in chunks to stay under DynamoDB transaction item limits. A later-chunk failure can mean earlier chunks have already restored; the API returns the restored IDs and instructs the client to refresh.
- Event rows are append-only through the supported API. Activity cannot be independently created, edited, or deleted through ordinary REST endpoints.

## 5. Data flow and system behavior

### 5.1 Context-level Data Flow Diagram (DFD Level 0)

~~~mermaid
flowchart LR
    Person[Team member]
    Operator[Administrator / operator]
    System((Team Follow-Up system))
    Cognito[(Amazon Cognito)]
    Database[(DynamoDB data store)]
    Monitor[(CloudWatch)]

    Person -->|Credentials, searches, edits, archive actions| System
    System -->|Workspace, results, validation/errors, history| Person
    System <-->|Sign-in, tokens and team attribute| Cognito
    System <-->|Work items, activity, profiles, archive| Database
    System -->|Logs, metrics and alarms| Monitor
    Operator -->|Account/profile setup and deployment configuration| Cognito
    Operator -->|Seed team-profile mappings| Database
~~~

### 5.2 Detailed DFD (DFD Level 1)

~~~mermaid
flowchart TB
    Browser[Browser / frontend]
    Identity[1.0 Authenticate and resolve team]
    Api[2.0 Validate and route request]
    Rules[3.0 Apply work-item and hierarchy rules]
    Query[4.0 Query workspace / history]
    ArchiveLogic[5.0 Archive or restore hierarchy]
    D1[(D1 Items)]
    D2[(D2 Activity)]
    D3[(D3 Users)]
    D4[(D4 Archive)]
    Cognito[(Cognito User Pool)]
    Logs[(CloudWatch)]

    Browser -->|Username/password| Cognito
    Cognito -->|JWT and custom team attribute| Browser
    Browser -->|HTTPS + Bearer token + JSON| Api
    Api -->|JWT issuer/audience verification| Cognito
    Api --> Identity
    Identity <-->|Resolve sub to enabled profile| D3
    Identity -->|Verified actor context| Rules
    Rules -->|Read/write active items| D1
    Rules -->|Write audit events atomically| D2
    Api --> Query
    Query --> D1
    Query --> D2
    Query --> D3
    Api --> ArchiveLogic
    ArchiveLogic <-->|Read/create/remove snapshots| D1
    ArchiveLogic <-->|Store/list archived rows| D4
    ArchiveLogic -->|Audit summaries| D2
    Api -->|Response status and access logs| Browser
    Api --> Logs
    Rules --> Logs
    Query --> Logs
    ArchiveLogic --> Logs
~~~

### 5.3 Sequence diagram — sign-in and workspace bootstrap

~~~mermaid
sequenceDiagram
    actor User as Team member
    participant UI as Browser UI
    participant Cognito as Cognito
    participant API as API Gateway
    participant Lambda as Lambda handler
    participant Users as Users table
    participant Items as Items table
    participant Activity as Activity table
    participant Users as Users table

    User->>UI: Submit sign-in form
    UI->>Cognito: Sign in with configured auth flow
    Cognito-->>UI: Auth session and user attributes
    UI->>UI: Validate team-user mapping attributes
    UI->>API: GET /users + Bearer token
    API->>Cognito: Validate JWT issuer and audience
    API->>Lambda: Forward authenticated request
    Lambda->>Users: Resolve caller and list enabled profiles
    Users-->>Lambda: Enabled team profiles
    Lambda-->>API: Users JSON
    UI->>API: GET /items?scope=top-level
    API->>Lambda: Forward authenticated request
    Lambda->>Items: Query top-level Projects/Jobs only
    Items-->>Lambda: Top-level items
    Lambda-->>API: Items JSON
    API-->>UI: Return each response without waiting for history
    UI-->>User: Render dashboard and sidebar
    UI->>API: GET /items?rootParentId=selected-id
    API->>Lambda: Load selected hierarchy on demand
    Lambda->>Items: Query selected Project/Job descendants
    Items-->>Lambda: Descendant items
    Lambda-->>UI: Selected hierarchy data
    opt User opens an item Activity History popup
        UI->>API: GET /items/{itemId}/activity?scope=all
        API->>Lambda: Request item-scoped Activity
        Lambda->>Activity: Query only the requested item hierarchy
        Activity-->>Lambda: Matching events
        Lambda-->>UI: Item history events
    end
    opt User opens Application-wide Activity History
        UI->>API: GET /activity?scope=application
        API->>Lambda: Request application Activity
        Lambda->>Activity: Scan Activity history
        Activity-->>Lambda: Application-wide events
        Lambda-->>UI: Activity history
    end
~~~

If the frontend attribute is missing or invalid, or the backend cannot map the authenticated subject to one enabled profile, the application denies entry/data access instead of falling back to a local identity.

### 5.4 Sequence diagram — create or update work item

~~~mermaid
sequenceDiagram
    actor User as Team member
    participant UI as Browser
    participant API as API Gateway
    participant L as Lambda
    participant U as Users table
    participant I as Items table
    participant A as Activity table

    User->>UI: Submit create/edit form
    UI->>API: POST /items or PATCH /items/{id}
    API->>L: Forward after JWT validation
    L->>U: Resolve verified Cognito sub
    U-->>L: Enabled team profile
    L->>I: Read parent / previous item
    L->>L: Validate fields, hierarchy, assignee, and version
    L->>I: Transactional item put/update
    L->>A: Same transaction writes audit event(s)
    alt Write succeeds
        L-->>API: 201 created / 200 updated
        API-->>UI: Canonical item and event payload
        UI-->>User: Refresh shared view and activity
    else Stale version or write conflict
        L-->>API: 409 conflict
        API-->>UI: Refresh-before-saving message
        UI-->>User: Refresh data and retry if appropriate
    end
~~~

### 5.5 Sequence diagram — archive and restore

~~~mermaid
sequenceDiagram
    actor User as Team member
    participant UI as Browser
    participant API as API Gateway
    participant L as Lambda
    participant I as Items table
    participant R as Archive table
    participant A as Activity table

    User->>UI: Archive selected active item
    UI->>API: DELETE /items/{id}
    API->>L: Authenticated request
    L->>I: Resolve item and descendants
    L->>R: Store archive snapshots in transaction chunks
    L->>I: Remove active records in same chunks
    L->>A: Write archive audit event(s)
    L-->>UI: Archive result and events
    User->>UI: Select archived records to restore
    UI->>API: POST /archive/restore with itemIds
    API->>L: Authenticated request
    L->>R: Read selected archived records
    L->>I: Check parent existence and child-type rules
    L->>I: Restore records in bounded transactions
    L->>R: Delete successfully restored archive rows
    L->>A: Write restore summary event(s)
    L-->>UI: Restored IDs / items, or partial-conflict details
    UI-->>User: Refresh workspace and Archive
~~~

The sequence above is conceptual; restore is chunked, and the implementation can return HTTP 409 with partial progress if a later chunk fails. Refresh Archive to reconcile actual state before retrying.

### 5.6 Activity diagram — common work-item workflow

~~~mermaid
flowchart TD
    Start([Start]) --> SignIn[Sign in with Cognito]
    SignIn --> AuthOK{Identity valid and mapped?}
    AuthOK -- No --> Denied[Show sign-in / mapping error]
    Denied --> SignIn
    AuthOK -- Yes --> Load[Load shared workspace from API]
    Load --> Choose{Choose action}
    Choose --> Browse[Search, filter, and open item]
    Choose --> Create[Create project/job or child item]
    Choose --> Edit[Edit item / status / priority / assignment]
    Choose --> History[Review item or application history]
    Choose --> Archive[Archive item or hierarchy]
    Choose --> Restore["Select archived items for restore"]
    Create --> Validate[Server validates fields and relationships]
    Edit --> Validate
    Validate --> Valid{Valid and current version?}
    Valid -- No --> Error[Show validation or conflict message]
    Error --> Load
    Valid -- Yes --> Write[Transactional item and activity write]
    Write --> Refresh[Refresh affected UI data]
    Archive --> ArchiveCheck[Archive snapshots and remove active rows]
    ArchiveCheck --> Refresh
    Restore --> RestoreCheck[Validate parents and restore selected rows]
    RestoreCheck --> Refresh
    Browse --> Load
    History --> Load
    Refresh --> Choose
~~~

### 5.7 State diagram — item status and archive lifecycle

~~~mermaid
stateDiagram-v2
    state "Active item" as Active {
        [*] --> NotStarted
        state "Not started" as NotStarted
        state "In progress" as InProgress
        state "On hold" as OnHold
        state "Completed" as Completed
        NotStarted --> InProgress: Authorized status update
        NotStarted --> OnHold: Authorized status update
        NotStarted --> Completed: Authorized status update
        InProgress --> OnHold: Authorized status update
        InProgress --> Completed: Authorized status update
        InProgress --> NotStarted: Authorized status update
        OnHold --> InProgress: Resume
        OnHold --> Completed: Authorized status update
        Completed --> InProgress: Reopen
        Completed --> OnHold: Authorized status update
    }
    Active --> Archived: Archive/delete request succeeds
    Archived --> Active: Restore succeeds after hierarchy validation
~~~

The stored status values are independent of the archive lifecycle. Archiving copies the item to the Archive table and removes the active record; restoring returns the item (with its retained business status) to Items after validation.

### 5.8 Class diagram — logical domain model

~~~mermaid
classDiagram
    class TeamProfile {
        +String userId
        +String displayName
        +String role
        +String cognitoSub
        +Boolean enabled
    }
    class WorkItem {
        +String itemId
        +String type
        +String name
        +String description
        +String parentId
        +String rootParentId
        +String ownerId
        +String status
        +String priority
        +String dueDate
        +String createdAt
        +String updatedAt
        +Integer version
        +validate()
        +assign()
        +updateStatus()
        +archive()
    }
    class Project {
        +containsTasks()
        +containsFollowups()
    }
    class Job {
        +containsFollowups()
    }
    class Task {
        +containsFollowups()
    }
    class FollowUp {
        +isLeaf()
    }
    class ActivityEvent {
        +String eventId
        +String itemId
        +String activityKey
        +String actorUserId
        +String action
        +String kind
        +String at
    }
    class ArchiveSnapshot {
        +String archiveId
        +String itemId
        +String archiveRootId
        +String archivedAt
        +String archivedByUserId
        +restore()
    }
    class ApiHandler {
        +authenticate()
        +resolveProfile()
        +validateItem()
        +queryItems()
        +writeAuditEvents()
        +restoreArchive()
    }

    WorkItem <|-- Project
    WorkItem <|-- Job
    WorkItem <|-- Task
    WorkItem <|-- FollowUp
    WorkItem "1" --> "0..*" WorkItem : parent / children
    TeamProfile "1" --> "0..*" WorkItem : creator/editor
    TeamProfile "0..1" --> "0..*" WorkItem : assignee
    WorkItem "1" --> "0..*" ActivityEvent : audit history
    WorkItem "1" --> "0..1" ArchiveSnapshot : archive copy
    ApiHandler ..> WorkItem : validates and persists
~~~

The class diagram is a **logical design view**, not a statement that the Python implementation uses a separate object-oriented class for each item type. The application stores these records as DynamoDB documents and implements the rules in Lambda helper functions.

## 6. UI/UX design and wireframes

### 6.1 Design goals

- Keep the selected project/job and its child items easy to scan.
- Make task/follow-up ownership and status visible without opening every record.
- Make activity history searchable and understandable, including changes made by other members.
- Keep search, assignment, edit, archive, and restore actions discoverable on small screens.
- Maintain consistent English/Arabic labels, text direction, theme behavior, forms, and status/priority visual cues.
- Avoid conflating descriptive role labels with access control.

### 6.2 Main screens and low-fidelity wireframes

These are structural wireframes rather than pixel-perfect screenshots. The current UI is implemented in **index.html**; exact appearance can change as responsive styling evolves.

#### Desktop workspace

~~~text
+----------------------------------------------------------------------------------+
| Team Follow-Up | Projects & Jobs              Language | Theme | User | Sign out |
+-------------------------------+--------------------------------------------------+
| [Search] [Assigned to me]     | Selected Project / Job                           |
| Search projects/jobs          | Type · name · created by · description          |
| [query..............]         |                                                  |
| Type / Status / Date filters  | [Overview] [Activity History] [Application ...] |
|                               |                                                  |
| Projects & jobs               | Summary metrics: Tasks | Follow-ups | Incomplete|
| - Project Alpha               |                                                  |
| - Job Beta                    | Child-item search and filters                   |
| - Project Gamma               | [New Child Item]                                |
|                               | Task / Follow-up cards                          |
|                               | Name, type, status, priority, assignee          |
|                               | Last updated                                     |
+-------------------------------+--------------------------------------------------+
~~~

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/80065fa4-f379-41c7-858b-34267e5c0957" />


#### Mobile workspace

~~~text
+-----------------------------------+
| Team Follow-Up          Language  |
| Theme / User / Sign out           |
+-----------------------------------+
| [Search / Projects & Jobs toggle] |
| [Assigned to me]                  |
| [Selected Project / Job]           |
| [Overview] [History]               |
| Metrics / Filters                  |
| Child item card                    |
| Name · Type                       |
| Status              [Edit]         |
| Assignee / Priority                |
| Last updated                       |
| [New Child Item]                  |
+-----------------------------------+
~~~

<img width="449" height="828" alt="image" src="https://github.com/user-attachments/assets/996db1e6-1ef7-441c-916e-ab61ea4c2259" />


#### Item editor

~~~text
+-------------------------------------------+
| New Project/Job or Edit item         [X]  |
| Type: Project / Job / Task / Follow-up    |
| Name                                      |
| [_______________________________________] |
| Description                               |
| [_______________________________________] |
| Parent (child items only)                 |
| [Select project/job/task_______________]  |
| Assigned to                               |
| [Select team member____________________]  |
| Status          Priority     Due date     |
| [__________]    [________]   [_________]  |
|                             [Cancel] [Save]|
| Edit mode: [Delete / Archive action]      |
+-------------------------------------------+
~~~

<img width="928" height="776" alt="image" src="https://github.com/user-attachments/assets/b3c34d26-4e02-4989-8e8d-141a134906fd" />


Editor fields and available controls depend on item type. Projects/jobs are top-level; tasks and follow-ups require parents. Parent type controls which child types are allowed. Delete in the application is implemented as archive, preserving the ability to restore.

#### Activity-history view

~~~text
+-----------------------------------------------------------+
| Activity History                                          |
| Scope: [This item only / All activity]                    |
| Search by date, user, item, or action                     |
| [From date] [To date] [Search] [Clear]                    |
|                                                           |
| 15 Oct 10:35  Zyad   Updated status: In progress          |
| 15 Oct 09:50  Marwa  Assigned task to Nadine              |
| 14 Oct 16:15  Omar   Created follow-up                    |
+-----------------------------------------------------------+
~~~

<img width="1452" height="842" alt="image" src="https://github.com/user-attachments/assets/fc2accf5-f71e-4979-9196-5af6a68dc46d" />


The exact available scope depends on the screen: item history can be limited to the selected item or expanded to relevant descendants; application history spans the application. The implementation sorts events newest first. Activity records are append-only through the API.

### 6.3 Navigation and interaction model

- **Projects & Jobs list:** browse/search top-level workspaces; opening an item loads its overview and child list.
- **Search:** filter projects/jobs and child items by supported type, status, priority, search text, and date range.
- **Assigned to me:** show work assigned to the signed-in member, with search and filters.
- **Overview:** show selected parent details and summary counts, then direct child items.
- **Child items:** create, open, and edit Tasks/Follow-ups subject to hierarchy rules.
- **Activity History:** inspect a selected item's events and relevant hierarchy events; search results are ordered newest first.
- **Application History:** review events across the application. This currently triggers backend scans of the Activity table.
- **Archive:** browse archived items, filter by text/type/root, select item(s), and restore when parent dependencies are satisfied.
- **Authentication controls:** sign in, complete supported Cognito challenges, recover password, and sign out.

### 6.4 Visual and accessibility guidelines

The frontend supports English and Arabic and light/dark themes. It detects the browser's language and color-scheme preferences where supported; fallback preferences are English and dark mode when settings are indeterminate or unsupported.

Design guidance for continued UI work:

- Preserve semantic headings, programmatically associated form labels, visible keyboard focus, keyboard-operable controls, and meaningful button labels.
- Keep text contrast sufficient in both themes and do not rely on color alone to communicate status or priority.
- Respect right-to-left layout in Arabic, including timeline direction, icons, inline metadata, and date/filter controls.
- On mobile, prevent date inputs, dialogs, and cards from exceeding available width; keep critical actions reachable and avoid needless horizontal scrolling outside deliberately wide timelines/tables.
- Use consistent spacing, type hierarchy, control heights, error messages, and touch target sizes.
- Announce actionable sign-in/load errors using accessible alert/live-region patterns.
- Test zoom, keyboard-only navigation, screen-reader labels, Arabic mixed-direction content, and narrow screen sizes manually in addition to automated DOM/script tests.

### 6.5 Status and priority language

- Stored statuses are **Not Started**, **In Progress**, **On Hold**, and **Completed** (localized in the UI).
- The **Not Completed** filter selects every item whose stored status is not Completed.
- Task/follow-up priority values are **Low**, **Medium**, **High**, and **Urgent**. Priority is a work-ordering signal, not an authorization level.

## 7. Technology stack and integrations

| Layer | Technology | Role |
|---|---|---|
| Frontend | HTML, CSS, JavaScript in **index.html** | UI and responsive presentation. |
| Browser authentication | AWS Amplify Auth modules loaded by the frontend build/runtime | Cognito sign-in, session/token handling, supported challenges and reset flow. |
| Static hosting | AWS Amplify Hosting | Builds and serves generated **dist/** website assets; deployment status for the current account is recorded separately. |
| Identity | Amazon Cognito User Pools | Authentication, public app client, and **custom:teamUserId** mapping attribute. |
| API | Amazon API Gateway HTTP API | HTTPS routes, Cognito JWT authorizer, CORS, access logging. |
| Backend | AWS Lambda, Python 3.12, boto3 | Business validation, authorization profile resolution, DynamoDB transactions and audit logic. |
| Database | Amazon DynamoDB | Items, Activity, Users, Archive. |
| Monitoring | Amazon CloudWatch Logs, metrics, alarms, dashboard | Troubleshooting and operational monitoring. |
| Infrastructure automation | AWS CloudFormation / SAM | Optional full-stack template for a fresh environment; creates Cognito, DynamoDB, API/Lambda/IAM, Amplify, CloudWatch and budget resources. The primary deployment workflow is manual through the console. |
| Repository / CI | GitHub and GitHub Actions | Version control and automated validation. |
| Administrative tooling | AWS CLI and Python scripts | Cognito profile mapping and controlled seeding of Users records. |

### 7.1 Runtime configuration

The frontend build expects these public, non-secret configuration values:

| Variable | Purpose |
|---|---|
| **TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID** | The actual pool ID created in the console or returned by the optional full-stack template. |
| **TEAM_FOLLOW_UP_COGNITO_CLIENT_ID** | The actual public app-client ID created in the console or returned by the optional full-stack template. |
| **TEAM_FOLLOW_UP_API_BASE_URL** | HTTPS API Gateway invoke URL created through the console, or output by the optional full-stack template. |
| **TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE** | Uses **custom:teamUserId**; this is the default and the build validates the expected attribute name. |

These values do not grant AWS account access. Never put AWS access keys, Cognito client secrets, or real Cognito subject mappings in frontend configuration, Amplify environment variables, or committed files.

### 7.2 Component dependencies

- Frontend build needs the configured public Cognito IDs and a real HTTPS API base URL.
- Authenticated frontend requests need a valid Cognito session and a token with the expected issuer/audience.
- Lambda requires the four DynamoDB tables, their documented names, primary keys, and expected indexes to be created through the console or the optional template.
- The Cognito team attribute must be readable by the configured public frontend app client.
- The backend also requires each authenticated Cognito subject to map to exactly one enabled Users-table profile. Each account's **custom:teamUserId** and Users-table **userId** mapping must agree.
- The operator seeding tool needs administrative Cognito ListUsers access and DynamoDB BatchWriteItem permission on the Users table. Do not grant those administrative permissions to the runtime Lambda.

## 8. API documentation

### 8.1 Common request rules

- Base URL: the API Gateway HTTPS invoke URL captured during the console workflow, or the **ApiBaseUrl** output when using the optional full-stack template.
- Transport: HTTPS.
- Authentication: **Authorization: Bearer <Cognito access token>**.
- Request/response format: JSON.
- CORS: the deployed HTTP API is configured for one exact HTTPS Amplify origin, plus Authorization and Content-Type headers. The optional template derives the same origin from the generated Amplify branch.
- The backend validates the token mapping and derives the actor identity server-side. A caller cannot use an arbitrary request-body user ID to impersonate another teammate.

The Lambda receives the proxy path and dispatches based on HTTP method and route. Routes below describe the current handler.

### 8.2 Endpoint reference

| Method and route | Purpose | Body / query | Success response |
|---|---|---|---|
| **GET /bootstrap** | Lightweight startup snapshot for compatible clients. | None. | Top-level Projects/Jobs and enabled team users only; descendants and Activity history are loaded on demand. |
| **GET /users** | List enabled team profiles. | None. | users array with id, name, role. |
| **GET /users/me** | Read the signed-in user's private profile fields, preferences, and pinned item IDs. | None. | user object; identity credentials are omitted. |
| **PATCH /users/me** | Update permitted profile fields for the signed-in user. Root remains read-only; privilege changes require manager permission. | JSON profile fields accepted by `normalize_profile_updates`. | updated user and any profile Activity events. |
| **PATCH /users/me/pins** | Replace the signed-in user's pinned item IDs. Root is protected and every pinned item must exist. | JSON object with `itemIds` array (up to 500 IDs). | updated user object. Users writes use `TransactWriteItems`. |
| **PATCH /users/{userId}** | Manager-only privilege change for another non-root user. | JSON object with `privilege` equal to Administrator, Editor, or User. | updated user and Activity events. |
| **POST /users/me/verify-password** | Verify the current password of the authenticated Cognito account for the Profile checkmark. | JSON `username` and `password`; no additional fields are accepted. | `{ "valid": true|false }` only; Cognito tokens and credentials are never returned. Requires pool-scoped Cognito IAM permissions and Lambda pool/client environment variables. |
| **GET /items** | Query top-level items, children under a parent, root hierarchy, or items assigned to a user. | Supply one supported selector and optional filters/pagination. | items, count, nextOffset. |
| **GET /items/assigned-to-me** | Query items assigned to the authenticated profile. | Optional filters/pagination. | items, count, nextOffset. |
| **GET /items/{itemId}/children** | Query direct children of an item. | Optional filters/pagination. | items, count, nextOffset. |
| **GET /items/{itemId}/activity** | Read item history. | Optional **scope=item|all** and **q** search. | events, count. |
| **POST /items** | Create a project, job, task, or follow-up. | JSON work-item fields; a child needs parentId. | HTTP 201; canonical item and associated activity events. |
| **PATCH /items/{itemId}** | Update a live work item. | JSON fields to update, with current item data as used by the frontend. | HTTP 200; canonical item and activity events. |
| **DELETE /items/{itemId}** | Archive the item and its descendants; this is not a hard-delete API. | Optional event details supplied by the client; server normalizes audit data. | HTTP 200; archived IDs and activity events. |
| **GET /activity** | Query application or item-related history. | One of scope=application/global, itemId, rootParentId, or parentId; optional q. | events, count. |
| **GET /archive** | List/filter archived records. | Optional type, rootParentId, q, offset, limit. | items, count, nextOffset. |
| **POST /archive/restore** | Restore selected archived items. | JSON object with **itemIds** array; at most 500 selected IDs per request. | restoredIds, restoredItems, activityEvents. |
| **POST /activity** | Direct event creation is not supported. | — | HTTP 405. Activity writes must be part of work-item transactions. |
| **PATCH/DELETE /activity/{eventId}** | Direct activity editing/deletion is not supported. | — | HTTP 405. History is append-only. |

Unknown routes return 404. API Gateway's default authorizer applies to application routes; CORS preflight handling is managed by the HTTP API configuration.

### 8.3 Work-item query parameters

For **GET /items**, use one supported query selector:

- **scope=top-level** — query top-level Project/Job records through WorkspaceIndex.
- **parentId=<id>** — query children of that immediate parent.
- **rootParentId=<id>** — retrieve a root hierarchy, including the root.
- **assigneeUserId=<team-id>** — query items for that assignee through AssignedToIndex. For the current signed-in user, prefer **GET /items/assigned-to-me** so the backend takes the assignee from the verified profile.

Optional supported filters:

| Parameter | Meaning |
|---|---|
| type | Exact item type, or all. |
| priority | Exact priority, or all. |
| status | Exact stored status, **not-completed**, or all. |
| q | Case-insensitive search in item name/description. |
| dateMode | **updated** (default) or creation-date mode; any non-updated value selects createdAt. |
| from / to | Inclusive lower/upper date bounds in YYYY-MM-DD format, applied to the selected date field. |
| direction | **asc** for ascending; otherwise descending. |
| offset | Zero-based result offset. |
| limit | Page size clamped to 1–250; default 100. |

The handler currently filters and sorts after retrieving the selected index partition. The result count is the filtered count, and nextOffset is null when there are no more results.

### 8.4 Activity query behavior

**GET /items/{itemId}/activity** supports:

- **scope=item** (default): history for the selected item only.
- **scope=all** on a Project/Job: history for the root and descendant items.
- **scope=all** on a Task: history for the Task and its child Follow-ups.
- **q**: case-insensitive search across serialized event fields.

**GET /activity** supports:

- **scope=application** or **scope=global**: application-wide history using a full Activity-table Scan.
- **itemId=<id>**: one item's history.
- **rootParentId=<id>**: history for the root and relevant descendant records.
- **parentId=<id>**: history for direct children of the parent.
- **q**: case-insensitive search across event fields.

Application-wide history has no dedicated GSI and is not paginated at the public response level in the current handler. Its cost and latency increase as the Activity table grows. This is a deliberate fit for the current small lab, not an unlimited-scale timeline design.

### 8.5 Archive/restore behavior and limits

- **GET /archive** queries the Archive index, then applies type, root, text, offset, and limit filters. The requested limit is clamped to at most 500.
- **POST /archive/restore** requires a non-empty itemIds array and accepts at most 500 unique IDs. It validates selected parents and item types before restoring.
- Restore writes are grouped in chunks of 30 items so item puts, archive deletes, and relevant audit summaries remain within DynamoDB transaction action limits.
- A later chunk can fail after earlier chunks committed. The API may return HTTP 409 with **restoredIds** and partial results. Refresh the Archive listing before retrying, rather than assuming the operation was all-or-nothing across all chunks.

### 8.6 Status and error responses

| HTTP status | Meaning |
|---|---|
| 200 | Successful read/update/archive/restore operation. |
| 201 | Work item created. |
| 400 | Invalid JSON, unsupported values, invalid hierarchy, or missing required selector. |
| 401 | Missing/unusable authenticated subject or invalid/missing token at the API gateway. |
| 403 | Cognito subject is not mapped to exactly one enabled team profile, or operation is forbidden. |
| 404 | Item or route was not found. |
| 405 | Attempt to create/edit/delete audit events directly. |
| 409 | Stale item version, write conflict, interrupted archive/restore, or partial restore that needs reconciliation. |
| 500 | Generic database/internal error; internal exception details are not sent to the browser. |

## 9. Security and privacy

### 9.1 Identity mapping

There are two related mappings that must be maintained:

1. **Frontend mapping:** Cognito user attribute **custom:teamUserId** must contain exactly one configured team ID (u1–u6). It is read by the frontend after sign-in.
2. **Backend mapping:** the verified JWT **sub** must match exactly one row's **cognitoSub** in **TeamFollowUp-Users**, where **userId** corresponds to the same team ID and **enabled** is true.

The operator confirmed the custom attribute was created and that the **Team_FollowUp** app client has Read enabled and Write disabled. Verify that Write is disabled on any other app client in the pool as well. The application repository does not directly query the AWS account, so these values are documented from operator confirmation rather than live discovery.

### 9.2 API and data controls

- API Gateway validates Cognito JWTs before requests reach Lambda.
- Lambda re-resolves the verified token subject and denies missing, duplicate, or disabled profile mappings.
- The actor, timestamps, version, hierarchy root, and index attributes are server-controlled.
- The assignee must be an enabled team profile.
- DynamoDB item mutations and audit records are coupled by transactions where supported by the implementation.
- Activity events cannot be altered directly through the API.
- CORS allows only the configured deployed HTTPS origin.
- Lambda IAM access is scoped to the configured target table/index ARNs and transactional operations. The console policy template and SAM execution-role policy must enforce equivalent least privilege. User-seeding permissions belong to the operator, not the Lambda.
- Error messages to clients are sanitized; detailed internal exceptions are not returned.

### 9.3 Secrets and operational privacy

- Public Cognito pool/client IDs and the public API URL are browser configuration values.
- Do not commit AWS credentials, app-client secrets, private Cognito sub values, real user emails, or production account identifiers.
- Run administrative scripts from a trusted environment/profile with the minimum required permissions.
- Keep Cognito username-to-team-ID assignments and subject mapping changes controlled by an administrator.
- Enable MFA and review account-recovery and password policies before production deployment, even though MFA is currently recorded as off.

## 10. Testing and validation

### 10.1 Automated checks

The repository's **npm run test:all** command runs the frontend and backend contract checks. The package scripts currently include:

| Command/script | Coverage focus |
|---|---|
| **npm run test:syntax** / scripts/check-syntax.mjs | JavaScript and markup/script syntax checks. |
| **npm run test:data-api** / scripts/test-data-api.mjs | Ensures AWS-only data access uses authenticated API requests and covers bootstrap, queries, mutation, activity, and archive/restore calls with fixtures. |
| **npm run test:build-config** / scripts/test-build-config.mjs | Requires valid Cognito/API configuration and prevents reverting to a local data/auth mode or a duplicate Cognito infrastructure definition. |
| **npm run test:progressive-loading** | Guards progressive workspace loading behavior. |
| **npm run test:child-search** | Child-item search and Arabic activity behavior regression. |
| **npm run test:activity-coverage** | Activity event coverage and current DynamoDB key/index contract. |
| **npm run test:activity-merge** | Idempotent activity merging. |
| **npm run test:history-structure** | Activity/history structure regression. |
| **npm run test:ui-refinements** | UI behavior/refinements regression. |
| **npm run test:backend** | Python unittest suite for backend helpers, validation, identity mapping, transactional behaviors, and deployment scripts. |
| **npm run test:infrastructure** | Validates the from-scratch SAM resource set, Cognito settings, table names/keys/indexes, IAM scope, CORS wiring, Amplify variables, budget alerts, and the separate current-account snapshot. |
| GitHub Actions workflow | Executes the automated checks, Python compilation, SAM validation/lint, and Lambda build. |

Run locally from the repository root using Node.js 24 and Python 3.12:

~~~bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
npm run build
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
~~~

The normal release build requires real public Cognito IDs and a real HTTPS API base URL; CI uses test configuration only for validating the build path.

**Frontend responsiveness regression coverage (16 October 2026):** the progressive-loading tests also exercise the single-owner modal click handler, iterative/cycle-safe traversal using synthetic deep and cyclic hierarchies, and direct-child type validation. Child-search regression checks verify that child date comparison uses the child's indexed Activity events rather than scanning the full root timeline for each comparator call. These are frontend safeguards; they do not change the API, Cognito, table keys/indexes, or Lambda authorization model.

For a frontend-only change, `npm run test:all` validates the UI/build contracts and `npm run build` creates the configured AWS frontend artifact. A local `npm run build` requires the three real public build variables (`TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`, `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`, `TEAM_FOLLOW_UP_API_BASE_URL`); an Amplify build receives these from the branch configuration. The Amplify branch then builds/publishes the static artifact. Do not redeploy Lambda or change CloudFormation/DynamoDB resources solely for modal, hierarchy-traversal, or sorting changes. A backend contract, Lambda, IAM, or infrastructure change follows the corresponding deployment path below.

### 10.2 Integration test plan

Run these checks in a dedicated test environment after the API and frontend have been deployed:

1. **Authentication:** valid sign-in, invalid credentials, password reset, supported challenge flow, sign-out, and session renewal.
2. **Identity mapping:** missing/unsupported custom team ID, missing/duplicate Cognito-sub mapping, disabled profile, and valid one-to-one mapping.
3. **Work-item CRUD:** create each permitted item type; edit content, assignee, status, priority, and due date; verify server-controlled attribution/time/version.
4. **Hierarchy validation:** reject parentless children, child on a Project/Job, Task under a Job, non-Follow-up under a Task, invalid parent types, self-parenting, and cycles.
5. **Concurrency:** update a record from two browser sessions and confirm a stale version receives 409 instead of overwriting a newer version.
6. **Activity:** verify create/update/status/assignment/archive/restore events; item, hierarchy, and application scope; newest-first order; and rejection of direct event mutation.
7. **Archive/restore:** archive a single item and a hierarchy; restore root/children together; verify missing-parent failures, duplicate selection handling, and partial-conflict recovery.
8. **Shared state:** make a change in one session and verify a second authenticated session sees it after reload/refresh.
9. **Responsive and localization:** desktop, narrow mobile, Arabic RTL, date filters, dialogs, keyboard-only operation, focus states, and both themes.
10. **Error and monitoring behavior:** unauthorized token, disabled profile, invalid request, DynamoDB conflict, Lambda error/throttle, and API Gateway 5xx alarm behavior.

### 10.3 User acceptance criteria

The project should not be considered accepted until representatives can:

- Sign in with their assigned accounts and see no data if identity mapping is invalid.
- Create and update valid Projects, Jobs, Tasks, and Follow-ups while invalid hierarchy combinations are blocked.
- Find their assigned items and filter/search accurately by the UI's supported criteria.
- Confirm every relevant successful mutation is reflected in Activity History with the correct actor and time.
- Archive/restore valid hierarchies without silently losing items or audit history.
- Use the interface in English and Arabic on desktop and mobile without clipped date fields, inaccessible dialogs, or overlapping metadata.
- Observe the intended backend and API operational telemetry in CloudWatch.

## 11. Deployment and operations

### 11.1 Deployment policy and order

**Primary method: AWS Management Console.** The normal project workflow creates and configures each AWS resource manually. Do not use `sam deploy` for the project's normal deployment. GitHub Actions verifies code and template contracts but never deploys resources.

**Alternative method: full-stack CloudFormation/SAM template.** `backend/template.yaml` is maintained for optional automation in a fresh environment. It creates Cognito, all DynamoDB tables/indexes, API Gateway, Lambda/IAM, CloudWatch, Amplify Hosting and the monthly budget. It does not assume a pool, table, or Amplify origin already exists.

The console workflow is staged as follows:

~~~mermaid
flowchart TD
    Code[Commit reviewed source]
    CI[GitHub Actions<br/>tests, template validation/build]
    Account[Confirm AWS account and us-east-1]
    Cognito[Create or verify Cognito pool/client]
    Data[Create or verify four DynamoDB tables<br/>and five GSIs]
    Budget[Create or verify monthly cost budget]
    Team[Create team accounts and map Users rows]
    Hosting[Create Amplify Hosting<br/>capture exact HTTPS branch origin]
    Lambda[Create Lambda role/function<br/>package handler and set table variables]
    API[Create HTTP API<br/>JWT authorizer, route, CORS, logs]
    Config[Set Amplify public environment variables]
    Ops[Create CloudWatch dashboard and alarms]
    Tests[Acceptance and two-session sharing tests]

    Code --> CI
    CI -->|pass| Account
    CI -->|fail| Fix[Fix and recommit]
    Fix --> Code
    Account --> Cognito --> Data --> Budget --> Team --> Hosting --> Lambda --> API --> Config --> Ops --> Tests
~~~

In the account-specific snapshot dated 15 October 2026, Cognito, the four DynamoDB tables and the budget had already been created manually. In that account, verify/reuse them instead of duplicating them. The remaining steps continue with administrator team mappings, Amplify Hosting, Lambda/API, environment configuration and CloudWatch operations. The order for a brand-new environment starts with creating each resource; it does not depend on the snapshot.

### 11.2 Cognito accounts and profile mapping

The target team IDs are:

| Team ID | Display name | Descriptive role |
|---|---|---|
| `u1` | Marwa | Team Leader |
| `u2` | Zyad | AWS Engineer |
| `u3` | Nadine | AWS Engineer |
| `u4` | Omar | AWS Engineer |
| `u5` | Haneen | AWS Engineer |
| `u6` | Dina | AWS Engineer |

Through Cognito's administrator interface, create one account per member and assign unique `custom:teamUserId` values `u1`–`u6`. The app's role labels are descriptive, not privileges. The public app client must have no client secret, must support SRP authentication, must be able to read `custom:teamUserId`, and must not be able to write it. Check Write restrictions on every app client in the pool. The frontend uses direct Cognito SRP sign-in; hosted-login domains/callback URLs are not part of this design.

After accounts exist, install the trusted administration script's dependency:

~~~bash
python -m pip install -r backend/requirements.txt
~~~

Run a dry run first, replacing `<POOL_ID>` with the real pool ID from the console or (for the alternate template) the `CognitoUserPoolId` output:

~~~bash
python backend/scripts/seed_user_profiles_from_cognito.py --user-pool-id <POOL_ID> --table TeamFollowUp-Users --region us-east-1 --dry-run
~~~

Confirm the six standard IDs/names plus `root`, the unique mapping, and enabled states, then repeat without `--dry-run` to write the corresponding `cognitoSub` profile mappings. The script can overwrite the seven matching Users profile rows; review before running the write operation. Use administrator credentials with Cognito `ListUsers` and DynamoDB `BatchWriteItem` permission on Users. Do not grant those administration permissions to the application Lambda, and do not commit real `sub` values or usernames.

### 11.3 AWS Console Amplify, Lambda and API setup

Follow the full service-by-service procedure in [`DEPLOYMENT.md`](DEPLOYMENT.md). The key settings are summarized here as a design cross-check.

**Amplify Hosting:** connect the GitHub repository and intended branch. Use the repository `amplify.yml`, Node.js 24, the `node scripts/build.mjs` build command, and `dist/` output. Record the final branch HTTPS origin (scheme + host only; no path/trailing slash). The first build may fail until the API base URL is configured.

**Lambda:** create a Python 3.12 function named `TeamFollowUp-Api`, 256 MB memory, 20-second timeout, handler `handler.lambda_handler`. Package `backend/src/handler.py` with the dependencies from `backend/src/requirements.txt` at the ZIP root. Create an IAM role named `TeamFollowUp-Api-ExecutionRole` trusted by Lambda, attach `AWSLambdaBasicExecutionRole`, and add the least-privilege policy in [`backend/console-lambda-policy.json`](../backend/console-lambda-policy.json). Replace the account-ID and User Pool ID placeholders; the Cognito actions must reference only the existing pool ARN. Profile edits and pin changes update the Users table through `TransactWriteItems`; keep Users included in the transaction-scoped table resources and do not grant standalone Users write permissions. This matches the explicit `ApiExecutionRole` in the optional template. Set environment variables:
- `ITEMS_TABLE=TeamFollowUp-Items`
- `ACTIVITY_TABLE=TeamFollowUp-Activity`
- `USERS_TABLE=TeamFollowUp-Users`
- `ARCHIVE_TABLE=TeamFollowUp-Archive`
- `COGNITO_USER_POOL_ID=<POOL_ID>`
- `COGNITO_CLIENT_ID=<PUBLIC_APP_CLIENT_ID>`

Create or verify `/aws/lambda/TeamFollowUp-Api` with 30-day retention. The Lambda may use only `cognito-idp:AdminGetUser` and `cognito-idp:AdminInitiateAuth` against that pool for session-bound password verification; do not grant general user creation/deletion or attribute-update permissions.

**API Gateway:** create an HTTP API with Lambda integration and an `ANY /{proxy+}` route at the auto-deployed `$default` stage. Configure a JWT authorizer with identity source `$request.header.Authorization`, issuer `https://cognito-idp.us-east-1.amazonaws.com/<POOL_ID>`, and audience equal to the public app-client ID. Attach the authorizer to every application route. The CORS allow-origin must be exactly the Amplify branch HTTPS origin; do not use `*`. Allow only `authorization` and `content-type` headers, the used HTTP methods (GET, POST, PATCH, DELETE, OPTIONS), and a 600-second max age. Enable 30-day API access logging without logging bearer tokens or Authorization headers.

**Amplify environment variables:** once the API has an invoke URL, set `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`, `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`, `TEAM_FOLLOW_UP_API_BASE_URL` (API origin only), and `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE=custom:teamUserId`. Save and trigger a successful build. All four values are public browser configuration, not secrets.

### 11.4 CloudWatch observability

Create API Gateway access logs and Lambda logs with 30-day retention. Create dashboard `TeamFollowUp-Operations` with time-series widgets for:

1. Lambda invocations, errors and throttles.
2. API Gateway request count and 5xx responses.
3. Lambda duration with p95 statistic.

Create three CloudWatch alarms, each with Sum statistic, 300-second period, one evaluation period, threshold greater than or equal to 1, and missing-data treatment not breaching:

| Alarm | Metric | Dimensions |
|---|---|---|
| `TeamFollowUp-Lambda-Errors` | `AWS/Lambda` / `Errors` | FunctionName = `TeamFollowUp-Api` |
| `TeamFollowUp-Lambda-Throttles` | `AWS/Lambda` / `Throttles` | FunctionName = `TeamFollowUp-Api` |
| `TeamFollowUp-ApiGateway-5xx` | `AWS/ApiGateway` / `5xx` | ApiId = actual API ID; Stage = `$default` |

The cost budget's email alerts are distinct from CloudWatch alarms. CloudWatch alarm actions are not wired to email by default; configure and test SNS/notification actions separately if required.

### 11.5 Optional full-stack CloudFormation/SAM automation

This is an **alternative**, not the normal deployment procedure. The step-by-step execution guide—including account/Region checks, GitHub access setup, SAM prompts, output handling, team-user seeding, smoke tests, updates and cleanup—is in [`AUTOMATED_DEPLOYMENT.md`](AUTOMATED_DEPLOYMENT.md) in the docs folder. The complete template in `backend/template.yaml` creates:
- Cognito pool and public app client with `custom:teamUserId` and limited client attribute write permissions.
- Four DynamoDB tables and five GSIs matching Section 4.2, with 1 RCU / 1 WCU for each table/index.
- API Gateway HTTP API/JWT authorizer, Lambda and scoped execution permissions.
- API/Lambda log groups, dashboard, and three alarms.
- Amplify Hosting app/branch and its public runtime variables.
- A $1 monthly cost budget with actual 50/80/100% and forecast 100% email alerts.

It requires these deployment-time values:

| Parameter | Purpose |
|---|---|
| `ResourceNamePrefix` | Resource name prefix, default `TeamFollowUp`. |
| `RepositoryUrl` | Repository URL to connect to Amplify. |
| `GitHubAccessToken` | Private token used for GitHub repository access by Amplify. |
| `FrontendBranchName` | Branch to publish, default `main`. |
| `BudgetNotificationEmail` | Recipient for budget alert emails. |

The template derives the HTTPS CORS origin from the generated Amplify app domain and injects the created pool/client IDs and API URL into the branch. It does not ask for existing Cognito IDs, table names, or an Amplify origin. At the default prefix it creates the same physical table names used in the console guide. **Do not deploy it with that default prefix into the current account/Region while the manually created resources of those names exist.** CloudFormation does not automatically adopt them. Use a clean account/environment or a deliberate unique prefix.

For optional validation/build only (no infrastructure deployment), install the dev requirements and run:

~~~bash
python -m pip install -r backend/requirements-dev.txt
npm run test:all
python -m compileall -q backend/src backend/scripts scripts/test-infrastructure.py
sam validate --lint --template-file backend/template.yaml
sam build --template-file backend/template.yaml
~~~

For an intentional full-stack automation experiment in a fresh environment, use `sam deploy --guided --template-file backend/template.yaml`, review the CloudFormation changeset, and understand the resources it will create. Both `GitHubAccessToken` and `BudgetNotificationEmail` are marked `NoEcho`, but should still be entered privately and **not** persisted to `samconfig.toml` or committed to Git. The budget recipient must still be present on the resulting AWS Budget resource. Review the changeset before confirmation.

The table resources in the template use both `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. Deleting the stack therefore does not automatically delete table data; a later deployment with the same names will fail until retained tables have been deliberately inspected and reconciled. The template is a starting automation reference and should be validated in a disposable/fresh environment before use.

### 11.6 Releases, troubleshooting and recovery

**Frontend-only release procedure:** run the frontend tests/build, push the reviewed source to the connected Amplify branch, and verify the new Amplify build and the key UI flows. The modal-dispatch, hierarchy traversal, and indexed timestamp changes documented on 16 October 2026 do not alter API routes/payloads, Cognito attributes or app-client settings, DynamoDB keys/indexes, IAM, or Amplify environment-variable names. They require a new static frontend artifact, not a Lambda redeployment or database migration. The optional SAM/CloudFormation stack is for infrastructure/backend changes or a from-scratch automated environment, not routine UI-only publishing.


- **Frontend build fails:** verify all four public Amplify variables and select the correct Node.js 24 build image; then restart the build.
- **Browser CORS failure:** compare the browser's scheme + hostname with the configured exact CORS origin. For the console workflow, adjust CORS in API Gateway; for an optional template stack, update/redeploy the template. Do not use a wildcard as a shortcut.
- **API 401/403:** verify JWT issuer, audience, Authorization bearer token and route authorizer. For authenticated identity-mapping failures, verify that unique `custom:teamUserId` and enabled Users `userId`/`cognitoSub` mappings agree.
- **Lambda access error:** verify table environment variables, current table/GSI statuses and the function's table-scoped IAM policy.
- **HTTP 409 concurrency conflict:** refresh the item before retrying the stale change.
- **Archive/restore conflict:** refresh workspace and Archive and inspect restored IDs. Restore may have committed earlier chunks.
- **Template deployment failure:** inspect CloudFormation stack events and rollback status. For a console-created resource, review the individual service's console events/configuration; there is no CloudFormation stack to roll back.
- **Lost table data:** application-level Archive is not a full database backup. Point-in-time recovery is disabled in the documented baseline; select an appropriate recovery/backup strategy before production-critical use.
- **Cost warning:** inspect Billing and Cost Explorer and unused resources. The $1 budget is notification-only and does not stop spend.

## 12. Known limitations, risks, and next steps

| Topic | Current limitation / risk | Recommended next action |
|---|---|---|
| Deployment completeness | Amplify Hosting and the backend API/Lambda stack are still pending in the current record. | Complete the ordered deployment and run acceptance checks. |
| Cognito permissions | Team_FollowUp Read enabled/Write disabled is recorded from operator confirmation; Write status on every other app client has not been confirmed. | Verify each app client; keep team identity assignment under trusted admin control. |
| Team identity records | User accounts and Users-table mappings must agree; a mismatch blocks application access. | Create/map all expected accounts and run the dry-run seeder. |
| Global activity query | Activity has no GSI; application history performs a full Scan. | Monitor data size and latency; design an additional timeline index only if needed and with explicit capacity/cost review. |
| User profile lookup | Users has no Cognito-subject GSI; Lambda scans the small team table. | Revisit indexing if the team/profile set grows significantly. |
| Provisioned capacity | Base tables/GSIs use 1 RCU/WCU each; bursts beyond capacity may throttle. | Monitor throttles and adjust based on observed use and current regional pricing. |
| Backups | Point-in-time recovery is disabled in the current documented table setup. | Enable PITR/backups and define a tested recovery procedure before production use. |
| Cost | A USD $1 monthly Budget is only a notification mechanism, not a hard cap. | Review credits, free-plan eligibility, service pricing, actual alerts, and usage regularly. |
| Monitoring notifications | CloudWatch alarm actions are not configured by default. | Attach and test a notification target if alerts are required. |
| Accessibility | Automated tests do not replace assistive-technology review. | Complete manual keyboard, screen-reader, contrast, zoom, RTL, and mobile validation. |
| Activity/restore partial progress | Large hierarchy restores are chunked and can partially succeed before returning 409. | Follow the refresh/reconcile instructions; evaluate an operator-facing recovery report for larger production workloads. |
| Admin boundary | Cognito user creation and profile seeding are privileged administration tasks. | Use least-privilege IAM and avoid sharing operator credentials. |

## 13. Glossary

| Term | Definition |
|---|---|
| Project | Top-level work container; can contain Tasks and Follow-ups. |
| Job | Top-level temporary-work container; can contain Follow-ups only. |
| Task | Child work item under a Project; can contain Follow-ups. |
| Follow-up | A leaf-level action/reminder attached to a Project, Job, or Task. |
| Team ID | Stable application identifier expected to be one of u1–u6. |
| Cognito sub | Unique subject claim for a Cognito user; stored in Users.cognitoSub to map the token to a team profile. |
| GSI | DynamoDB Global Secondary Index, configured for a secondary query pattern. |
| RCU / WCU | Provisioned read/write capacity units. Actual charge depends on region, settings, service use, and any credits. |
| DFD | Data Flow Diagram; shows how information passes between actors, processes, and data stores. |
| ERD | Entity-Relationship Diagram; logical entity relationships, even where the physical database does not enforce foreign keys. |
| JWT | Signed JSON Web Token used here for authenticated API requests. |
| SAM | AWS Serverless Application Model, used to describe and deploy the backend CloudFormation stack. |
| Archive | Application-managed storage of removed active work items so the items can be listed and restored. It is not a substitute for database backup. |

---

## Related project references

- [README](../README.md) — project entry point, validation commands, frontend configuration.
- [Architecture guide](ARCHITECTURE.md) — concise architecture and request flow.
- [AWS implementation record](IMPLEMENTATION.md) — current console resources and settings.
- [Deployment runbook](DEPLOYMENT.md) — ordered steps and AWS CLI commands.
- [DynamoDB schema contract](../backend/table-schema.json) — physical table keys, indexes, and bootstrap record.
- [SAM backend template](../backend/template.yaml) — API, Lambda, IAM, and monitoring infrastructure definition.
- [Lambda API handler](../backend/src/handler.py) — routing, validation, identity resolution, transactions, activity, and archive logic.
- [GitHub Actions](https://github.com/retzed/Team_Follow-Up_AWS-Deployment/actions) — automated validation history.


## 14. Account page, Search, navigation and mobile reliability (28 October 2026)

The signed-in application opens on **My Account → Assigned Items**. Account tabs are **Profile**, **Assigned Items**, **Pinned Items**, and **Search**. The Projects & Jobs workspace retains its own Search sidebar, expanded by default and collapsible/expandable with a floating control. The old “Assigned to me” sidebar mode has been removed; current-user assignments live in the Account page.

### Profile and privilege separation

The profile **Name** is a display name, not the Cognito username; the username is not shown as the user's display field and profile save does not rename the Cognito identity. The personal-detail fields are **Display name**, optional **Display name (Arabic)**, **Phone number**, **E-mail**, **Label**, **Label (Arabic)**, and **Profile icon**, in that order. The Arabic label no longer uses the “optional” suffix in its displayed text. The icon selector previews the selection. The profile privilege textbox has been removed; the privilege indicator remains beside the display name at the top of the page, and authorized team privilege management is separate. The backend continues to own privilege authorization and protects the root profile.

**Save changes** persists profile fields through the authenticated API. Theme and language preferences are separate updates. The actual password update remains Amazon Cognito-backed. The current-password check added on 29 October 2026 is a separate authenticated API operation (`POST /users/me/verify-password`) and requires the documented Lambda/Cognito app-client/IAM updates. Earlier Profile/Search and mobile-layout changes were frontend-only, but this check is not.

### Account Search and user/date filters

The Account **Search** tab filters top-level Projects and Jobs. Its text query includes item and Arabic names, description, type/status, and related creator/updater/owner/assignee user identifiers and display information. User association checks support both the demo aliases and canonical fields returned by the AWS data model, including `createdByUserId`, `updatedByUserId`, `ownerId`, and `assignedTo` and their assignee aliases. The explicit user selector narrows results to items associated with the selected teammate; “All users” means no user restriction and does not make every teammate related to every row.

Filters include type, status, date sort mode, inclusive **From / To** calendar-date bounds, and a **Clear** action. Date modes are **Last updated**, **Last created**, and **Created**; the latter sorts oldest first and Last created sorts newest first. Search works over the current top-level item set and does not turn descendant Tasks and Follow-ups into independent result rows. The workspace sidebar's filter state is separate from Account Search state.

Every Search result offers separate **Open in workspace**, **Activity history**, and pin actions. Assigned Items and Pinned Items expose the same workspace navigation and an item-history action. A result's visual card is not itself a navigation control.

### Workspace, lazy loading and history behavior

Opening a Project/Job from account Search switches the UI out of the account page, selects that root, and starts its child-item query. Opening an assigned or pinned item resolves its root Project/Job, switches to the workspace, loads the root's descendants, recalculates its Task-ancestor expansion after hydration, and scrolls the selected item into view. This post-load expansion is necessary when the selected child's Task ancestor was not in the user's initial assignment cache.

Expanding the workspace Search sidebar retains the selection and re-renders the selected root. The selected root is rehydrated as needed; a selected child is brought back into view once the load resolves. Errors are caught and logged while the app retains its normal retry behavior.

History buttons reuse the existing lazy Activity request and persistent response-cache boundary. Item-history retrieval remains scoped to the requested item's history or its root hierarchy according to item type; the Account panels do not prefetch the full Activity table just to display result rows. The API and DynamoDB remain authoritative; the browser's versioned API-response cache is a performance layer, not a local work-data database.

### Mobile and regression coverage

The account Search controls collapse to two shrink-safe columns at widths up to 820 CSS pixels; the query spans the full row. Date inputs and select controls are constrained to their grid columns, and workspace/history action buttons can wrap on narrow screens. The layout is expected to remain usable in both English LTR and Arabic RTL. Inert result cards are not keyboard-focusable; explicit buttons provide keyboard-accessible actions.

Regression coverage asserts the profile field ordering, user/date filter wiring, canonical AWS user-ID aliases, non-action result cards, mobile grid rules, workspace page switching, and Task-ancestor expansion after lazy child loading. These are frontend-only changes: they do not require a database migration or changes to the manually configured AWS resources. Release validation uses the repository's GitHub Actions workflow; a passing CI run validates source/build/test artifacts but does not prove the live AWS account or deployed Amplify branch was exercised end-to-end.


### Workspace Search sidebar lifecycle

The workspace Search sidebar is collapsed by default, including when a Project/Job is opened from Account. The floating toggle synchronizes the layout class, panel `hidden` state, and `aria-expanded` value without running a full translation refresh just to close the panel.

Closing Search clears a queued sidebar query timer and increments `sidebarQuerySequence`. Asynchronous top-level queries validate their captured sequence before rendering, so results initiated before close are discarded instead of re-rendering a closed panel. Reopening uses the existing in-memory parent list and root-child hydration path; selected Project/Job and child navigation are preserved. Viewport changes retain the current visibility choice. This is a frontend change only; Cognito remains the authentication provider and the API Gateway/Lambda/DynamoDB contracts are unchanged. The collapsed CSS uses one flexible grid column after hiding the sidebar. A two-track `0 1fr` definition is invalid in this structure because the remaining `<main>` item auto-places into the first zero-width track; the regression suite asserts this layout contract.

### Assigned Items filters and mobile date fields (29 October 2026)

The **Assigned Items** tab retains its query, type, status, date-mode, From and To filters, plus Clear. The status option `Not completed` is last. The protected `root` profile is omitted from assignee selectors; if an existing item was assigned to root, the editor's selector falls back to its empty option so the item can be reassigned. The root account is not made selectable by the UI.

In mobile layouts, From and To remain side by side in one complete row in both Account Search and Assigned Items, with each field constrained to half the available filter width. The default selected Project/Job also loads its root-scoped activity timeline during startup, so opening its activity view does not need a second request just to populate the selected parent history.

These are frontend/UI behaviors and do not require a table/index migration or a new API route. The current-password verification feature is separate and does require the Lambda/Cognito/IAM setup described in the preceding subsection.

### Protected root identity

The AWS implementation retains Cognito as its only application authentication provider. Create the administrator-managed Cognito identity mapped to application user ID `root` with `custom:teamUserId=root`; use `root@1234` as its initial password only if it complies with the current pool password policy (the documented pool uses email sign-in), and create a Users-table mapping with `userId=root`, `displayName=root`, `role=Root`, `icon=crown`, `privilege=Administrator`, `cognitoSub` set to the real Cognito `sub`, and `enabled=true`. The updated Cognito seeding scripts expect six standard users plus root. Do not persist plaintext passwords or a second password hash in DynamoDB: Cognito owns password storage, password hashing, reset, and change operations. The app and backend make the root profile database-managed and reject profile edits and privilege changes through the app. Account creation and the initial password must be completed by a trusted Cognito administrator; this repository cannot create identities in the live AWS account by itself.

### Current-password check (29 October 2026)

The current-password checkmark is displayed only after verifying the entered password against Cognito. The current-password field shares the normal two-column Profile password grid; its status is reset immediately when the input changes, and asynchronous verification responses are ignored if the value changes before they return. A second checkmark is shown when the new password is at least eight characters and exactly matches its confirmation. The actual password change is still performed by Cognito.

For the AWS deployment, this feature introduces `POST /users/me/verify-password` in Lambda. Before deploying the updated frontend, configure `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` on Lambda, enable `ALLOW_ADMIN_USER_PASSWORD_AUTH` on the existing public app client while retaining SRP and refresh-token flows, and grant only `cognito-idp:AdminGetUser` and `cognito-idp:AdminInitiateAuth` against the configured User Pool ARN. The handler verifies that the supplied username's Cognito `sub` matches the already-authenticated JWT subject and returns only a boolean. Passwords are neither logged by the handler nor stored in DynamoDB. No new DynamoDB table/index, migration, Amplify variable, or API Gateway route is required, but the Lambda ZIP and Cognito/IAM settings must be updated before the frontend is published.
