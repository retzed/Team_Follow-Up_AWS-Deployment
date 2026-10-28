# Automated Deployment Runbook — AWS SAM / CloudFormation

This runbook explains how to deploy the **entire Team Follow-Up stack from scratch** using AWS SAM CLI and AWS CloudFormation. It is the optional automation path; the project's primary deployment instructions remain in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md), which uses the AWS Management Console.

**Template:** [`backend/template.yaml`](../backend/template.yaml)  
**Target Region:** `us-east-1` (US East, N. Virginia)  
**Default stack prefix:** `TeamFollowUp`  
**Expected result:** Cognito + DynamoDB + API Gateway + Lambda/IAM + CloudWatch + Amplify Hosting + AWS Budgets.

> [!IMPORTANT]
> **This template creates new resources; it does not adopt existing console-created resources.** The current account snapshot already records a Cognito pool/client, four DynamoDB tables and a monthly budget with the default `TeamFollowUp` naming contract. Do not deploy this template with `ResourceNamePrefix=TeamFollowUp` into that same account/Region while those named resources still exist.
>
> For an isolated automation test in the current account, use a distinct prefix such as `TeamFollowUpAuto`. That creates a separate application environment with a new Cognito pool, a separate database and new identities; it does not reuse the manual environment's users or data. For a clean account/environment, the default prefix can be used if no conflicting names exist. Review all charges before proceeding.

---

## 1. What this template creates

The template provisions the target application infrastructure below. Generated IDs and hostnames will differ from any console-created environment.

| Service | Resources created |
|---|---|
| Amazon Cognito | A user pool; the `Team_FollowUp` public app client; mutable String `custom:teamUserId` attribute, length 1–32; email sign-in; administrator-managed accounts; SRP sign-in and token refresh; app client can read but not write the team-ID attribute. |
| Amazon DynamoDB | `<prefix>-Items`, `<prefix>-Activity`, `<prefix>-Users`, `<prefix>-Archive`; five GSIs with the same names/key attributes as the target schema. Each base table/GSI uses Provisioned capacity of 1 RCU / 1 WCU. |
| AWS Lambda | Python 3.12 `<prefix>-Api`, 256 MB memory, 20-second timeout, explicit `<prefix>-Api-ExecutionRole`, scoped DynamoDB access and standard CloudWatch logging. |
| Amazon API Gateway | HTTP API, `$default` stage, Lambda proxy route and Cognito JWT authorizer. CORS is derived from the configured Amplify branch HTTPS origin. |
| AWS Amplify Hosting | GitHub-connected hosting app and the requested branch; public runtime variables are injected by the template, and the branch is configured for automatic builds. |
| Amazon CloudWatch | API access and Lambda log groups with 30-day retention, dashboard, Lambda error/throttle alarms, and API Gateway 5xx alarm. Alarm notification actions are not configured by default. |
| AWS Budgets | A notification-only monthly USD $1 cost budget with actual 50%, 80%, and 100% alerts and a 100% forecast alert. |
| SAM deployment artifacts | SAM uploads the packaged Lambda artifact/template to an S3 bucket for CloudFormation deployment. This artifact bucket is a deployment prerequisite, not one of the application's output resources. |

The four DynamoDB tables use **DeletionPolicy: Retain** and **UpdateReplacePolicy: Retain**. Stack deletion/replacement therefore does not automatically delete their data. Other stack-owned resources, including the Cognito user pool and its users, are not protected by this table-retention rule.

### What it does not create

- It does not create the six standard Cognito team accounts or the protected root account, nor does it populate their Users-table profiles. Those steps are performed after deployment using Cognito administration and the trusted seeding script.
- It does not add a Cognito managed-login/hosted-UI domain. The frontend uses direct Cognito SRP sign-in, so a hosted login domain and OAuth callback URLs are not required.
- It does not create sample projects/tasks or migrate data from the manual environment.
- It does not configure email/SNS actions for CloudWatch alarms. The AWS Budget has its own email subscribers.
- It does not put AWS credentials, a GitHub token, user emails, or per-user Cognito `sub` values into repository files.

---

## 2. Prerequisites

### 2.1 Local tools

Install the following on your deployment computer:

- **Git**, to clone or update the repository.
- **Node.js 24**, matching `amplify.yml`.
- **Python 3.12**, matching the Lambda runtime.
- **AWS CLI v2**, configured for the target AWS account.
- **AWS SAM CLI**, for template validation, packaging and deployment.

Official installation references: [AWS SAM CLI installation](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), [SAM deployment guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/using-sam-cli-deploy.html).

Verify installations from a terminal:

```powershell
git --version
node --version
python --version
aws --version
sam --version
```

Use Node.js 24 and Python 3.12. If a command resolves to a different runtime, correct that before continuing.

### 2.2 AWS credentials and permissions

Use a trusted IAM Identity Center/SSO profile or another approved least-privilege deployment identity. Avoid using the AWS root user for routine deployment.

The deployment identity needs permissions to create/update/delete the resource types in the template: CloudFormation, Lambda, IAM role/policy creation and pass-role, API Gateway, Cognito user pools/clients, DynamoDB tables/indexes, CloudWatch logs/dashboard/alarms, Amplify apps/branches, AWS Budgets, and access to the SAM artifact bucket. Your organization may provide a managed deployment role. CloudFormation must be allowed to create the explicitly named IAM role; the command below includes `CAPABILITY_NAMED_IAM`.

### 2.3 Amplify access to the GitHub repository

The stack creates an Amplify app connected to the GitHub repository, so configure the AWS Amplify GitHub App and prepare a GitHub personal access token before deployment.

1. Install the Amplify GitHub App for the target Region: [Install the AWS Amplify GitHub App in us-east-1](https://github.com/apps/aws-amplify-us-east-1/installations/new).
2. Select the GitHub account/organization that owns the repository. Prefer **Only select repositories** and grant it access to `retzed/Team_Follow-Up_AWS-Deployment`.
3. In GitHub, open **Settings → Developer settings → Personal access tokens** and create a token authorized for that repository. Follow the current [AWS Amplify GitHub access instructions](https://docs.aws.amazon.com/amplify/latest/userguide/setting-up-GitHub-access.html); the documented classic-token flow requests the `admin:repo_hook` scope.
4. Keep the token private. Do not put it in source, screenshots, chat, command-line arguments, committed scripts, or `samconfig.toml`. Use a trusted terminal during the guided deployment. Revoke/rotate the token if it is exposed or no longer needed.

The template marks `GitHubAccessToken` as `NoEcho`, and Amplify's `AccessToken` property is not stored by the Amplify resource, but these safeguards are not permission to save credentials in local deployment configuration.

### 2.4 Select the correct AWS account and Region

Open PowerShell and set the profile and Region. Replace the profile name with the one configured on your computer:

```powershell
$env:AWS_PROFILE = "team-followup-deploy"
$Region = "us-east-1"
aws sts get-caller-identity
aws configure get region --profile $env:AWS_PROFILE
```

Check the returned AWS account identity. If you do not use a named profile, remove the `AWS_PROFILE` assignment and make sure the active credentials are the intended ones.

This runbook uses **us-east-1** consistently. Do not continue if the account or Region is wrong.

---

## 3. Confirm that deployment will not collide with the manual environment

Before deploying, list the current resources:

```powershell
aws cloudformation list-stacks --region $Region --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE
aws dynamodb list-tables --region $Region
aws cognito-idp list-user-pools --region $Region --max-results 60
aws amplify list-apps --region $Region
```

The existing manual environment uses the default names `TeamFollowUp-Items`, `TeamFollowUp-Activity`, `TeamFollowUp-Users`, `TeamFollowUp-Archive`, `TeamFollowUp-Monthly-Cost`, and a manually created Cognito pool/client. CloudFormation will not automatically adopt these resources.

Choose a **stack name** and a valid **ResourceNamePrefix**. The prefix must contain 3–20 letters, digits, dots, underscores, or hyphens, and must begin with a letter or digit.

| Scenario | Stack name example | ResourceNamePrefix |
|---|---|---|
| Fresh account/Region with no name conflicts | `team-followup-automation` | `TeamFollowUp` |
| Isolated automation environment in the current account | `team-followup-automation` | `TeamFollowUpAuto` |

Use `TeamFollowUpAuto` in the current account unless you have verified that the default physical names are free. It creates a second, independent environment; its new pool and tables do not share identities/data with the manually created resources.

---

## 4. Get the repository and validate the template

Open a terminal in your preferred development directory. Clone the repository if you do not already have it; otherwise update the local copy.

```powershell
git clone https://github.com/retzed/Team_Follow-Up_AWS-Deployment.git
cd Team_Follow-Up_AWS-Deployment
git checkout main
git pull
```

If you already cloned the repository, run only the commands for `cd`, `git checkout main`, and `git pull` from inside that repository.

Validate the exact template that will be deployed:

```powershell
sam validate --lint --template-file backend/template.yaml
```

Build the Lambda deployment artifact and SAM's transformed template:

```powershell
sam build --template-file backend/template.yaml
```

Expected result: the validation and build complete without errors, and SAM reports the generated artifact directory `.aws-sam/build` and template `.aws-sam/build/template.yaml`.

Optionally run the repository regression checks before any AWS deployment:

```powershell
python -m pip install -r backend/requirements-dev.txt
npm run test:all
```

A successful validation/build/test run proves the local code and template contracts passed; it does **not** create AWS resources or prove the account is configured correctly.

---

## 5. Start the guided CloudFormation deployment

Run the following from the repository root after a successful build:

```powershell
sam deploy --guided --template-file .aws-sam/build/template.yaml --capabilities CAPABILITY_NAMED_IAM
```

SAM will ask for deployment settings and all template parameters. Prompt wording can vary slightly by SAM CLI version. Use the following values.

### 5.1 SAM deployment settings

| Prompt | Recommended response |
|---|---|
| Stack Name | `team-followup-automation` (or another valid, unused CloudFormation stack name). |
| AWS Region | `us-east-1`. |
| Confirm changes before deploy | **Yes**. You must review the changeset before it is applied. |
| Allow SAM CLI/IAM role creation, if shown | **Yes**, because CloudFormation must create IAM resources defined by the template. The command also specifies `CAPABILITY_NAMED_IAM`. |
| Rollback on failure | Keep rollback enabled unless you have a specific troubleshooting reason. |
| S3 bucket for deployment artifacts, if prompted | Use an approved private S3 bucket in `us-east-1`, or the SAM-managed bucket option if your CLI offers one. Never make this bucket public. |
| Save arguments to configuration file? | **No**. Do not persist the GitHub token or budget email in `samconfig.toml`. |

The deployment artifact bucket is used to upload the function package and deployment template. It is separate from the application resources listed in the Outputs section.

### 5.2 Template parameters

The template should prompt for these parameters. Use the table to decide each value.

| Parameter | What to enter |
|---|---|
| `ResourceNamePrefix` | `TeamFollowUpAuto` for the existing current account; `TeamFollowUp` only for a clean environment with no naming collisions. |
| `RepositoryUrl` | `https://github.com/retzed/Team_Follow-Up_AWS-Deployment` unless deploying a fork. |
| `GitHubAccessToken` | The private GitHub token prepared in Step 2.3. Enter it interactively; never put it in the command line or a file. |
| `FrontendBranchName` | `main`, unless you intentionally deploy a different branch. |
| `BudgetNotificationEmail` | The email inbox that should receive actual/forecast budget warnings. Enter it privately; do not commit it to Git. |

Parameter strings are case-sensitive. Use a single ResourceNamePrefix throughout one stack. The template supplies generated Cognito IDs and the API base URL to the Amplify branch automatically.

### 5.3 Review the changeset before approving it

**Do not approve the changeset until you have inspected it.** Check that:

- All resources belong to the stack and use the intended Region.
- The four table names use your selected prefix and do not conflict with an existing DynamoDB table.
- A new Cognito pool/client, API Gateway API, Lambda function, explicit IAM role, CloudWatch resources, Amplify app/branch, and monthly budget are being created.
- The Amplify branch name is correct and the repository URL points to the intended source.
- No unexpected resource replacement or deletion is proposed.
- The stack is not trying to use the manually created pool or tables from the separate console environment.

If you see a physical-name collision, stop the deployment, cancel the changeset and choose a safe prefix/stack plan. Do not delete existing data simply to make the changeset succeed.

Once the changeset accurately describes the intended new environment, confirm deployment. CloudFormation will create resources; wait until the stack status is **CREATE_COMPLETE**. If it fails, see [Troubleshooting](#12-troubleshooting) before retrying.

---

## 6. Read and record the CloudFormation outputs

In the AWS Console, open **CloudFormation → Stacks → your stack → Outputs**. The template returns the following values.

| Output | Purpose |
|---|---|
| `CognitoUserPoolId` | User Pool ID for the new environment. |
| `CognitoUserPoolClientId` | Public browser app-client ID. |
| `ItemsTableName`, `ActivityTableName`, `UsersTableName`, `ArchiveTableName` | Names of all four tables. |
| `ApiBaseUrl` | API Gateway HTTPS base URL. |
| `AmplifyAppId` | Amplify application identifier. |
| `FrontendUrl` | The configured Amplify branch's HTTPS URL. This exact origin is used by API CORS. |
| `ApiExecutionRoleName` | Lambda's explicit execution-role name. |
| `CloudWatchDashboardName` | Operations dashboard name. |
| `MonthlyCostBudgetName` | Cost-budget name. |

You can also print the outputs via the CLI:

```powershell
$StackName = "team-followup-automation"
aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output table
```

Save the non-secret output values in your private deployment notes. Do not commit credentials or per-user Cognito subject values.

---

## 7. Wait for and verify the Amplify build

The Amplify branch is configured for automatic builds and already receives these build-time variables from CloudFormation:

- `TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`
- `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`
- `TEAM_FOLLOW_UP_API_BASE_URL`
- `TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE=custom:teamUserId`

The repository's `amplify.yml` uses Node.js 24, runs `node scripts/build.mjs`, and publishes `dist/`.

1. Open **AWS Amplify → your created app → Hosting → Build history**.
2. Select the configured branch and open its latest build.
3. Confirm the build succeeds and the artifacts are published.
4. Open the `FrontendUrl` output from Step 6. Make sure the page loads over HTTPS.

If the first build fails, check the build log for Node.js version/setup or missing public runtime variables. Confirm the branch is `main` and the template parameters/outputs match the stack. Do not paste a GitHub token into a build log or browser configuration.

---

## 8. Create team accounts and seed Users profiles

CloudFormation creates the Cognito schema and the Users table, but it intentionally does not create real team accounts or store user email addresses in the template. Create the six standard administrator-managed Cognito users and the protected `root` Cognito user for this environment.

### 8.1 Create Cognito users

1. Open **Amazon Cognito → User pools → the pool identified by `CognitoUserPoolId` → Users**.
2. Create one account per team member using the real email address supplied by your team administrator.
3. Set the custom attribute `custom:teamUserId` to the unique ID shown below for each account.
4. Use the Cognito administrator workflow for temporary credentials/invitations and have each user complete any required first-login password change.
5. Verify that each team ID is used by exactly one account. These values are descriptive identity mappings, not role-based privileges.

| `custom:teamUserId` | Display name | Role label |
|---|---|---|
| `u1` | Marwa | Team Leader |
| `u2` | Zyad | AWS Engineer |
| `u3` | Nadine | AWS Engineer |
| `u4` | Omar | AWS Engineer |
| `u5` | Haneen | AWS Engineer |
| `u6` | Dina | AWS Engineer |
| `root` | root | Root |

The browser app client can read `custom:teamUserId` but cannot write it. Only the trusted administrator should assign or correct these values. Do not store real email addresses in the repository.

### 8.2 Retrieve stack output values for the seeding script

In PowerShell, use the same `AWS_PROFILE` and `Region` from Step 2.4. The commands below read the actual user pool and Users table names from CloudFormation, so the script works with either `TeamFollowUp` or a unique prefix such as `TeamFollowUpAuto`.

```powershell
$StackName = "team-followup-automation"
$UserPoolId = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue | [0]" --output text
$UsersTable = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='UsersTableName'].OutputValue | [0]" --output text
$UserPoolId
$UsersTable
```

Confirm the values are not blank or `None`.

### 8.3 Install dependencies, dry-run, then write

Install the administrator script dependency:

```powershell
python -m pip install -r backend/requirements.txt
```

The active AWS profile must have `cognito-idp:ListUsers` for the new pool and `dynamodb:BatchWriteItem` for the new Users table. These administrative permissions are **not** granted to the application Lambda execution role.

First run a dry run:

```powershell
python backend/scripts/seed_user_profiles_from_cognito.py --user-pool-id $UserPoolId --table $UsersTable --region $Region --dry-run
```

Check that the six standard IDs and the protected `root` ID are found and enabled. The script does not print Cognito `sub` values. If any account is missing, duplicated, or has an unsupported `custom:teamUserId`, stop and fix the Cognito accounts before writing.

Only after the dry run is correct, run the same command without `--dry-run`:

```powershell
python backend/scripts/seed_user_profiles_from_cognito.py --user-pool-id $UserPoolId --table $UsersTable --region $Region
```

The write operation creates/overwrites seven corresponding profile rows, including the protected root mapping. Review the output before running it again.

---

## 9. Test the deployed application

Perform these checks after the stack is healthy, the Amplify build succeeded, and the six profiles are seeded.

1. **Authentication:** open the `FrontendUrl`, sign in using one of the administrator-created team accounts, and confirm the workspace loads. Confirm that the account's `custom:teamUserId` matches exactly one enabled Users profile.
2. **Unauthenticated API protection:** from PowerShell, request an application route without a bearer token:
   ```powershell
   $ApiBaseUrl = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='ApiBaseUrl'].OutputValue | [0]" --output text
   curl.exe -i "$ApiBaseUrl/bootstrap"
   ```
   The request should be denied (HTTP 401/403). Do not add a wildcard CORS origin or remove authorization to work around a denied request.
3. **Shared data:** sign in from a second browser/session using another mapped account. Create a Project and Job, then verify they appear after refresh in both sessions.
4. **Hierarchy rules:** create Tasks and Follow-ups only where allowed. Verify invalid parent/child combinations are rejected.
5. **Activity:** create/edit an item, change status/assignee, then confirm the correct actor and actions appear in Activity History.
6. **Archive/restore:** archive an item with descendants, confirm it appears in Archive, then restore it and verify hierarchy.
7. **Localization/layout:** test English and Arabic (RTL), light and dark modes, mobile layout and date filters.
8. **Monitoring:** open the CloudWatch dashboard listed in Outputs, inspect Lambda/API logs, and verify the three alarms exist. Alarm creation does not mean email notifications will be sent.
9. **Budget:** confirm the budget notifications are present and the recipient is correct. This budget only warns about actual/forecast cost; it is not a spending cap.

A successful CloudFormation stack and a healthy website are necessary but not sufficient; complete all acceptance tests before using the environment for shared work.

---

## 10. Updating the automated environment

First identify which layer changed. The optional template provisions the full stack from scratch; it is not the routine release command for every frontend source change.

### Frontend-only change

Changes limited to `index.html`, frontend JavaScript/styles, UI tests, or other frontend-only files do not change the Cognito/API/DynamoDB contract. The Amplify branch created by the template has automatic builds enabled and points at the configured GitHub branch.

1. Run the repository checks locally where practical:
   ```powershell
   npm run test:all
   npm run build
   ```
   A local AWS build requires the three real public configuration values (`TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID`, `TEAM_FOLLOW_UP_COGNITO_CLIENT_ID`, and `TEAM_FOLLOW_UP_API_BASE_URL`). Use values from this environment; Amplify supplies the variables during hosted builds. Do not commit them into source files.
2. Commit and push the reviewed change to the configured Amplify branch (normally `main`). Watch **Amplify → Hosting → Build history** and confirm the published artifact is healthy.
3. Exercise sign-in, item creation/editing, modal close/save behavior, child hierarchy/search/sort, item Activity, and application-wide Activity. Confirm failures show a retryable state instead of an indefinite loading indicator.
4. Do **not** run `sam deploy`, rebuild the Lambda ZIP, change API Gateway/CORS, alter Cognito, or modify DynamoDB solely for a frontend-only change.

If the branch's automatic build is disabled, start a new build for that branch in Amplify Console. The standard build remains defined by `amplify.yml`: Node.js 24, `node scripts/build.mjs`, and publishing `dist/`.

### Lambda, API, or infrastructure change

For changes under `backend/src/`, `backend/template.yaml`, IAM, Cognito, DynamoDB schema, API configuration, or Amplify branch configuration:

1. Review the Git changes and identify whether the Lambda package, infrastructure template, or both need to change.
2. Validate and build the full template:
   ```powershell
   sam validate --lint --template-file backend/template.yaml
   sam build --template-file backend/template.yaml
   ```
3. If deploying this optional automated environment, deploy the built template with the same CloudFormation stack name and resource prefix:
   ```powershell
   sam deploy --guided --template-file .aws-sam/build/template.yaml --capabilities CAPABILITY_NAMED_IAM
   ```
4. Review the CloudFormation changeset carefully, especially any table replacement, IAM, Cognito replacement, or Amplify branch change. Approve only if the changes are intended.
5. Verify stack status and outputs, review Amplify build results, and run relevant acceptance tests.

Keep `GitHubAccessToken` and `BudgetNotificationEmail` out of `samconfig.toml` and source control. Do not change `ResourceNamePrefix` on an existing stack casually: doing so may replace physical resources. To create a separate test environment, use a separate stack name and distinct prefix. The console-first deployment remains the project's primary path; use this procedure only for the optional automated environment.

## 11. Delete an automated test stack safely

Deleting a stack is destructive to stack-managed services. Before cleanup, decide whether you need to retain Cognito accounts, logs, API/Amplify identifiers, or other configuration.

The template protects the **four DynamoDB tables only** with `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. When the stack is deleted:

- The four tables and their data are retained as standalone DynamoDB tables, and CloudFormation no longer manages them through that stack.
- The Cognito user pool and its Cognito accounts are deleted with the stack unless you deliberately change the template's lifecycle policy first.
- The API, Lambda, IAM role, Amplify app/branch, CloudWatch log groups/dashboard/alarms, and monthly budget are deleted as stack resources.
- The SAM deployment-artifact S3 bucket is separate. Review and clean it up only if it is dedicated to this deployment and no other stack/deployment uses it.

From the repo root, SAM can initiate deletion:

```powershell
sam delete --stack-name $StackName --region $Region
```

Read each confirmation prompt. After deletion, check the CloudFormation stack status and review retained DynamoDB tables in the console. If you plan to redeploy with the same prefix, first deliberately handle the retained tables: the new stack cannot create physical table names that still exist. Export any required data before deleting a retained table. Do not delete the current manual environment's resources as part of an automated-test cleanup.

The monthly $1 budget does not automatically stop spend; verify that the intended resources and artifact bucket are gone if your goal is to stop ongoing charges.

---

## 12. Troubleshooting

| Symptom | Checks and action |
|---|---|
| `sam validate` fails | Confirm you are in the repository root and are validating `backend/template.yaml`; inspect the first YAML/schema error. Run the repository tests after fixing code. |
| SAM build fails | Confirm Python 3.12 and the SAM CLI are installed, dependency downloads are allowed, and `backend/src/requirements.txt` is present. |
| Deployment fails with `AlreadyExists` or physical-name conflict | Stop. Review the CloudFormation Events tab and your actual resource names. Use a fresh environment or a distinct prefix; do not delete data just to resolve the conflict. |
| CloudFormation reports missing capability for IAM | Ensure the deploy command includes `--capabilities CAPABILITY_NAMED_IAM` and approve the requested IAM capability only for the reviewed template. |
| Amplify cannot connect to GitHub | Verify the AWS Amplify GitHub App is installed in **us-east-1**, has access to the exact repository, and the token is current/authorized. Follow the official [Amplify GitHub setup guide](https://docs.aws.amazon.com/amplify/latest/userguide/setting-up-GitHub-access.html). |
| Amplify build fails | Open the branch build log. Check Node.js 24 support, `amplify.yml`, the branch name and generated runtime variables. Confirm the CloudFormation outputs are correct. |
| API returns HTTP 401/403 after sign-in | Verify the Cognito pool/client IDs are from this stack, the request uses a valid Cognito bearer access token, the API's JWT authorizer is active and a single enabled Users row matches the Cognito subject. |
| API CORS error | Check that the browser origin exactly matches the `FrontendUrl` scheme and hostname. The template calculates this origin; do not add `*` as a workaround. |
| Seeding fails | Confirm every account has exactly one supported `custom:teamUserId` value (`u1`–`u6`), all IDs are represented, the output values are for this stack, and the active AWS identity can list Cognito users and batch-write to that Users table. |
| Stack rollback retains table names | This is expected with table `DeletionPolicy: Retain`. Inspect the retained tables in DynamoDB and deliberately rename/prefix a new environment or handle retained data before redeploying. |
| Unexpected AWS costs | Check Billing/Cost Explorer, provisioned capacity, Amplify builds/hosting, CloudWatch logs, the SAM artifact bucket and all active stacks. A budget alert is not a hard spend limit. |

---

## Official references

- [AWS SAM CLI installation](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [Deploying with AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/using-sam-cli-deploy.html)
- [SAM `deploy` command reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html)
- [Setting up AWS Amplify access to GitHub repositories](https://docs.aws.amazon.com/amplify/latest/userguide/setting-up-GitHub-access.html)
- [AWS CloudFormation resource reference: Amplify App](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-amplify-app.html)


**Root credentials:** create the Cognito user `root`, set `custom:teamUserId=root`, and use `root@1234` as its initial/temporary password when creating the account. The seeding script then creates the corresponding root profile row. Cognito remains the password store and verifier; this template does not create a separate database-password authentication path. Root's application profile is read-only and its privilege cannot be changed through the UI.
