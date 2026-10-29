#!/usr/bin/env python3
"""Contract tests for the full-stack automation template, console IAM policy, and current-account snapshot."""

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = ROOT / "backend" / "template.yaml"


class CloudFormationLoader(yaml.SafeLoader):
    pass


def load_intrinsic(loader, tag_suffix, node):
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node)
    else:
        value = loader.construct_mapping(node)
    return {tag_suffix: value}


CloudFormationLoader.add_multi_constructor("!", load_intrinsic)


def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def validate_console_bootstrap():
    """Keep the manually configured AWS resource inventory accurate and regression-tested."""
    schema_path = ROOT / "backend" / "table-schema.json"
    try:
        with schema_path.open(encoding="utf-8") as stream:
            schema = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"Could not load backend/table-schema.json current bootstrap record: {exc}")

    if schema.get("thisFileProvisionsAwsResources") is not False:
        fail("table-schema.json is a documentation/schema reference, not an AWS provisioning mechanism.")

    bootstrap = schema.get("currentConsoleBootstrap")
    if not isinstance(bootstrap, dict) or bootstrap.get("region") != "us-east-1":
        fail("Current console bootstrap must document the manually configured us-east-1 resources.")

    cognito = bootstrap.get("cognito", {})
    if cognito.get("teamUserIdAttribute") != "custom:teamUserId":
        fail("The current Cognito bootstrap must document the custom:teamUserId attribute.")
    if "added per operator confirmation" not in str(cognito.get("teamUserIdAttributeStatus", "")).lower():
        fail("Cognito bootstrap must reflect the operator-confirmed addition of custom:teamUserId.")
    attribute_settings = cognito.get("teamUserIdAttributeSettings", {})
    if (attribute_settings.get("dataType"), attribute_settings.get("minLength"),
            attribute_settings.get("maxLength"), attribute_settings.get("mutable")) != ("String", 1, 32, True):
        fail("Cognito bootstrap must record the instructed String/1-32/mutable teamUserId settings.")
    app_client_permissions = cognito.get("teamUserIdAttributePermissions", {})
    followup_permissions = app_client_permissions.get("Team_FollowUp", {})
    if "enabled per operator confirmation" not in followup_permissions.get("read", ""):
        fail("Cognito bootstrap must reflect the operator-confirmed enabled Read permission for Team_FollowUp.")
    if "disabled per operator confirmation" not in followup_permissions.get("write", ""):
        fail("Cognito bootstrap must reflect the operator-confirmed disabled Write permission for Team_FollowUp.")
    other_clients_write = app_client_permissions.get("otherAppClients", {}).get("write", "")
    if "must be disabled" not in other_clients_write or "not yet confirmed" not in other_clients_write:
        fail("Cognito bootstrap must distinguish the required other-client Write restriction from its unconfirmed status.")

    table_rows = bootstrap.get("dynamodb", [])
    tables = {row.get("name"): row for row in table_rows if isinstance(row, dict)}
    expected_names = {
        "TeamFollowUp-Items",
        "TeamFollowUp-Activity",
        "TeamFollowUp-Users",
        "TeamFollowUp-Archive",
    }
    if set(tables) != expected_names:
        fail("Current console bootstrap must list exactly the four manually created DynamoDB tables, including Archive.")

    # These are the console settings reported for the manually created tables and indexes.
    for name, table in tables.items():
        if table.get("status") != "ACTIVE":
            fail(f"{name} must be recorded as ACTIVE in the current console bootstrap.")
        if table.get("billingMode") != "PROVISIONED" or table.get("tableClass") != "STANDARD":
            fail(f"{name} must document the Standard/provisioned settings used in the console.")
        if table.get("partitionKey", {}).get("type") != "S":
            fail(f"{name} must record a String partition key.")
        if table.get("provisionedThroughput") != {"readCapacityUnits": 1, "writeCapacityUnits": 1}:
            fail(f"{name} must document 1 RCU / 1 WCU on the base table.")
        for setting in ("autoScaling", "pointInTimeRecovery", "deletionProtection", "streams"):
            if table.get(setting) is not False:
                fail(f"{name} must record {setting}=false for the current low-cost bootstrap.")
        if table.get("encryption") != "AWS-owned default key":
            fail(f"{name} must document the AWS-owned default encryption key.")
        for index in table.get("globalSecondaryIndexes", []):
            if index.get("projection") != "ALL":
                fail(f"{name}/{index.get('name')} must document an All projection.")
            if index.get("readCapacityUnits") != 1 or index.get("writeCapacityUnits") != 1:
                fail(f"{name}/{index.get('name')} must document 1 RCU / 1 WCU.")

    archive = tables["TeamFollowUp-Archive"]
    if archive.get("partitionKey") != {"name": "archiveId", "type": "S"} or archive.get("sortKey") is not None:
        fail("TeamFollowUp-Archive must use archiveId (String) as its only primary key.")
    archive_indexes = {
        row.get("name"): (row.get("partitionKey"), row.get("sortKey"))
        for row in archive.get("globalSecondaryIndexes", [])
    }
    expected_archive_indexes = {
        "GSI_ArchiveIndex": ("archivePK", "archiveSort"),
        "GSI_ArchiveRoot": ("archiveRootPK", "archiveRootSort"),
    }
    if archive_indexes != expected_archive_indexes:
        fail("Archive bootstrap must define GSI_ArchiveIndex and GSI_ArchiveRoot with the expected key attributes.")

    not_created = bootstrap.get("notYetCreated", [])
    if any("archive table" in str(value).lower() for value in not_created):
        fail("The Archive table is created; it must not remain in currentConsoleBootstrap.notYetCreated.")

    expected_table_indexes = {
        "TeamFollowUp-Items": {
            "ParentIdIndex": ("parentId", "createdAt"),
            "AssignedToIndex": ("assignedTo", "updatedAt"),
            "WorkspaceIndex": ("workspaceKey", "createdAt"),
        },
        "TeamFollowUp-Activity": {},
        "TeamFollowUp-Users": {},
        "TeamFollowUp-Archive": expected_archive_indexes,
    }
    documented_tables = {row.get("name"): row for row in schema.get("tables", [])}
    expected_documented_names = {"TeamFollowUp-Items", "TeamFollowUp-Activity", "TeamFollowUp-Users", "TeamFollowUp-Archive"}
    if set(documented_tables) != expected_documented_names:
        fail("table-schema.json must document the same four existing DynamoDB tables, not an un-deployed target schema.")
    for table_name, indexes in expected_table_indexes.items():
        row = documented_tables[table_name]
        actual_indexes = {gsi.get("name"): (gsi.get("pk"), gsi.get("sk")) for gsi in row.get("gsis", [])}
        if actual_indexes != indexes:
            fail(f"{table_name} schema documentation differs from the manually configured GSIs.")
    if documented_tables["TeamFollowUp-Activity"].get("primaryKey") != {
        "partition": "itemId", "partitionType": "S", "sort": "activityKey", "sortType": "S"
    }:
        fail("Activity schema must retain the existing itemId + activityKey composite key.")
    if documented_tables["TeamFollowUp-Users"].get("primaryKey", {}).get("partition") != "userId":
        fail("Users schema must use the existing userId primary key.")

    target_archive = documented_tables["TeamFollowUp-Archive"]
    if target_archive.get("primaryKey", {}).get("partition") != "archiveId":
        fail("Archive schema must document the existing archiveId primary key.")
    target_indexes = {row.get("name"): (row.get("pk"), row.get("sk")) for row in target_archive.get("gsis", [])}
    if target_indexes != expected_archive_indexes:
        fail("Archive key/index documentation must agree with the backend's archive access contract.")

    capacity = bootstrap.get("capacitySummary", {})
    if (capacity.get("readCapacityUnits"), capacity.get("writeCapacityUnits")) != (9, 9):
        fail("Current bootstrap capacity summary must reflect 9 RCUs / 9 WCUs including Archive's two indexes.")


def main():
    validate_console_bootstrap()
    schema_path = ROOT / "backend" / "table-schema.json"
    with schema_path.open(encoding="utf-8") as stream:
        schema = json.load(stream)
    with TEMPLATE_PATH.open(encoding="utf-8") as stream:
        template = yaml.load(stream, Loader=CloudFormationLoader)

    resources = template.get("Resources", {})
    parameters = template.get("Parameters", {})
    required = {
        "TeamFollowUpUserPool": "AWS::Cognito::UserPool",
        "TeamFollowUpAppClient": "AWS::Cognito::UserPoolClient",
        "ItemsTable": "AWS::DynamoDB::Table",
        "ActivityTable": "AWS::DynamoDB::Table",
        "UsersTable": "AWS::DynamoDB::Table",
        "ArchiveTable": "AWS::DynamoDB::Table",
        "TeamFollowUpApi": "AWS::Serverless::HttpApi",
        "ApiExecutionRole": "AWS::IAM::Role",
        "ApiFunction": "AWS::Serverless::Function",
        "ApiAccessLogGroup": "AWS::Logs::LogGroup",
        "ApiFunctionLogGroup": "AWS::Logs::LogGroup",
        "TeamFollowUpDashboard": "AWS::CloudWatch::Dashboard",
        "ApiLambdaErrorsAlarm": "AWS::CloudWatch::Alarm",
        "ApiLambdaThrottlesAlarm": "AWS::CloudWatch::Alarm",
        "ApiGateway5xxAlarm": "AWS::CloudWatch::Alarm",
        "FrontendApp": "AWS::Amplify::App",
        "FrontendBranch": "AWS::Amplify::Branch",
        "MonthlyCostBudget": "AWS::Budgets::Budget",
    }
    for logical_id, expected_type in required.items():
        if resources.get(logical_id, {}).get("Type") != expected_type:
            fail(f"Missing or wrong resource type for {logical_id}: expected {expected_type}.")

    forbidden_parameters = {
        "ExistingCognitoUserPoolId", "ExistingCognitoAppClientId",
        "ExistingItemsTableName", "ExistingActivityTableName",
        "ExistingUsersTableName", "ExistingArchiveTableName", "AllowedOrigin",
    }
    if forbidden_parameters.intersection(parameters):
        fail("The from-scratch automation template must not require pre-existing Cognito/table IDs or a pre-created Amplify origin.")
    prefix = parameters.get("ResourceNamePrefix", {})
    if prefix.get("Default") != "TeamFollowUp" or not prefix.get("AllowedPattern", "").startswith("^[A-Za-z0-9]"):
        fail("ResourceNamePrefix must default to TeamFollowUp and enforce safe resource-name characters.")
    for sensitive_parameter in ("GitHubAccessToken", "BudgetNotificationEmail"):
        if parameters.get(sensitive_parameter, {}).get("NoEcho") is not True:
            fail(f"{sensitive_parameter} must be marked NoEcho.")
    if parameters.get("GitHubAccessToken", {}).get("Default") or parameters.get("BudgetNotificationEmail", {}).get("Default"):
        fail("The template must not contain a GitHub token or billing-notification email default.")

    # The template creates its own Cognito pool and client with the same public-client trust boundary.
    pool_properties = resources["TeamFollowUpUserPool"]["Properties"]
    if pool_properties.get("UsernameAttributes") != ["email"]:
        fail("The Cognito pool must support email sign-in.")
    if pool_properties.get("AdminCreateUserConfig", {}).get("AllowAdminCreateUserOnly") is not True:
        fail("Cognito self-registration must be disabled; accounts are administrator managed.")
    if pool_properties.get("MfaConfiguration") != "OFF":
        fail("Cognito MFA setting must match the documented OFF configuration.")
    custom_attribute = next((row for row in pool_properties.get("Schema", []) if row.get("Name") == "teamUserId"), None)
    constraints = (custom_attribute or {}).get("StringAttributeConstraints", {})
    if not custom_attribute or custom_attribute.get("AttributeDataType") != "String" or custom_attribute.get("Mutable") is not True:
        fail("Cognito must create mutable String custom attribute teamUserId.")
    if (constraints.get("MinLength"), constraints.get("MaxLength")) != ("1", "32"):
        fail("Cognito custom:teamUserId must use the String length range 1-32.")
    client = resources["TeamFollowUpAppClient"]["Properties"]
    if client.get("UserPoolId") != {"Ref": "TeamFollowUpUserPool"} or client.get("GenerateSecret") is not False:
        fail("Cognito app client must belong to the template pool and must not have a client secret.")
    if not {"ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_ADMIN_USER_PASSWORD_AUTH"}.issubset(set(client.get("ExplicitAuthFlows", []))):
        fail("Cognito app client must support SRP sign-in, token refresh, and the server-side current-password verification flow.")
    if "custom:teamUserId" not in client.get("ReadAttributes", []):
        fail("The browser app client must be allowed to read custom:teamUserId.")
    if "custom:teamUserId" in client.get("WriteAttributes", []):
        fail("The browser app client must not be allowed to write custom:teamUserId.")

    # Verify default display/physical names shared by the console runbook and template.
    if pool_properties.get("UserPoolName") != {"Sub": "${ResourceNamePrefix}-Cognito"}:
        fail("Default Cognito pool name must match the new-environment console instructions.")
    if client.get("ClientName") != "Team_FollowUp":
        fail("Cognito browser app-client name must match the console runbook.")
    expected_sub_names = {
        ("ApiExecutionRole", "RoleName"): "${ResourceNamePrefix}-Api-ExecutionRole",
        ("ApiFunction", "FunctionName"): "${ResourceNamePrefix}-Api",
        ("ApiAccessLogGroup", "LogGroupName"): "/${ResourceNamePrefix}/apigateway/access",
        ("ApiFunctionLogGroup", "LogGroupName"): "/aws/lambda/${ResourceNamePrefix}-Api",
        ("TeamFollowUpDashboard", "DashboardName"): "${ResourceNamePrefix}-Operations",
        ("ApiLambdaErrorsAlarm", "AlarmName"): "${ResourceNamePrefix}-Lambda-Errors",
        ("ApiLambdaThrottlesAlarm", "AlarmName"): "${ResourceNamePrefix}-Lambda-Throttles",
        ("ApiGateway5xxAlarm", "AlarmName"): "${ResourceNamePrefix}-ApiGateway-5xx",
        ("MonthlyCostBudget", "BudgetName"): "${ResourceNamePrefix}-Monthly-Cost",
        ("FrontendApp", "Name"): "${ResourceNamePrefix}-frontend",
    }
    for (logical_id, property_name), expected_suffix in expected_sub_names.items():
        props = resources[logical_id]["Properties"]
        actual_value = props.get(property_name)
        if logical_id == "MonthlyCostBudget":
            actual_value = props.get("Budget", {}).get("BudgetName")
        if actual_value != {"Sub": expected_suffix}:
            fail(f"{logical_id}.{property_name} must use the console-aligned default name {expected_suffix}.")
    api_title = resources["TeamFollowUpApi"]["Properties"].get("DefinitionBody", {}).get("info", {}).get("title")
    if api_title != {"Sub": "${ResourceNamePrefix} API"}:
        fail("HTTP API title/name must match the console runbook default.")
    branch_properties_for_name = resources["FrontendBranch"]["Properties"]
    if branch_properties_for_name.get("BranchName") != {"Ref": "FrontendBranchName"}:
        fail("Amplify branch must use the configured branch name.")
    for logical_id in ("ApiAccessLogGroup", "ApiFunctionLogGroup"):
        if resources[logical_id]["Properties"].get("RetentionInDays") != 30:
            fail(f"{logical_id} must retain logs for 30 days to match the runbook.")

    # Target table names, primary keys, GSIs, projections, capacity, and Lambda references.
    table_resources = {
        "TeamFollowUp-Items": ("ItemsTable", "Items"),
        "TeamFollowUp-Activity": ("ActivityTable", "Activity"),
        "TeamFollowUp-Users": ("UsersTable", "Users"),
        "TeamFollowUp-Archive": ("ArchiveTable", "Archive"),
    }
    target_schema = {row.get("name"): row for row in schema.get("tables", [])}
    if set(target_schema) != set(table_resources):
        fail("table-schema.json must define the same four target physical tables as the template.")
    capacity_total = 0
    for physical_name, (logical_id, suffix) in table_resources.items():
        resource = resources[logical_id]
        props = resource.get("Properties", {})
        expected_name = {"Sub": f"${{ResourceNamePrefix}}-{suffix}"}
        if props.get("TableName") != expected_name:
            fail(f"{logical_id} must create the expected physical name pattern {physical_name}.")
        if props.get("BillingMode") != "PROVISIONED" or props.get("TableClass") != "STANDARD":
            fail(f"{logical_id} must use Standard table class with provisioned capacity.")
        if props.get("ProvisionedThroughput") != {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1}:
            fail(f"{logical_id} must use 1 RCU / 1 WCU for the base table.")
        if props.get("PointInTimeRecoverySpecification", {}).get("PointInTimeRecoveryEnabled") is not False:
            fail(f"{logical_id} must match the documented low-cost PITR-off setting.")
        if props.get("DeletionProtectionEnabled") is not False:
            fail(f"{logical_id} must have DynamoDB deletion protection disabled to match the console configuration.")
        if resource.get("DeletionPolicy") != "Retain" or resource.get("UpdateReplacePolicy") != "Retain":
            fail(f"{logical_id} must retain data if its CloudFormation stack is deleted or the table is replaced.")
        schema_row = target_schema[physical_name]
        if schema_row.get("physicalNameTemplate") != f"${{ResourceNamePrefix}}-{suffix}":
            fail(f"{physical_name} schema reference has the wrong physical-name template.")
        physical_indexes = {
            gsi.get("IndexName"): (
                next((key.get("AttributeName") for key in gsi.get("KeySchema", []) if key.get("KeyType") == "HASH"), None),
                next((key.get("AttributeName") for key in gsi.get("KeySchema", []) if key.get("KeyType") == "RANGE"), None),
            )
            for gsi in props.get("GlobalSecondaryIndexes", [])
        }
        documented_indexes = {gsi.get("name"): (gsi.get("pk"), gsi.get("sk")) for gsi in schema_row.get("gsis", [])}
        if physical_indexes != documented_indexes:
            fail(f"{logical_id} Global Secondary Indexes do not match table-schema.json.")
        for gsi in props.get("GlobalSecondaryIndexes", []):
            if gsi.get("Projection", {}).get("ProjectionType") != "ALL":
                fail(f"{logical_id}/{gsi.get('IndexName')} must use an All projection.")
            if gsi.get("ProvisionedThroughput") != {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1}:
                fail(f"{logical_id}/{gsi.get('IndexName')} must use 1 RCU / 1 WCU.")
            capacity_total += 2
        capacity_total += 2
    if capacity_total != 18:
        fail("Four base tables and five GSIs should total 9 RCUs and 9 WCUs each.")

    # Serialize table creation to avoid creating multiple indexed tables concurrently.
    for child, parent in (("ActivityTable", "ItemsTable"), ("UsersTable", "ActivityTable"), ("ArchiveTable", "UsersTable")):
        if resources[child].get("DependsOn") != parent:
            fail(f"{child} must depend on {parent} so indexed table creation is staged.")

    variables = template.get("Globals", {}).get("Function", {}).get("Environment", {}).get("Variables", {})
    expected_variables = {
        "ITEMS_TABLE": "ItemsTable",
        "ACTIVITY_TABLE": "ActivityTable",
        "USERS_TABLE": "UsersTable",
        "ARCHIVE_TABLE": "ArchiveTable",
        "COGNITO_USER_POOL_ID": "TeamFollowUpUserPool",
        "COGNITO_CLIENT_ID": "TeamFollowUpAppClient",
    }
    for variable, logical_id in expected_variables.items():
        if variables.get(variable) != {"Ref": logical_id}:
            fail(f"Lambda environment variable {variable} must reference the created {logical_id} resource.")

    api_properties = resources["TeamFollowUpApi"]["Properties"]
    authorizers = api_properties.get("Auth", {}).get("Authorizers", {})
    jwt = authorizers.get("CognitoJwt", {}).get("JwtConfiguration", {})
    if "TeamFollowUpUserPool" not in str(jwt.get("issuer")):
        fail("API JWT issuer must reference the User Pool created by this template.")
    if "TeamFollowUpAppClient" not in str(jwt.get("audience")):
        fail("API JWT audience must reference the public app client created by this template.")
    if api_properties.get("Auth", {}).get("DefaultAuthorizer") != "CognitoJwt":
        fail("The API must use CognitoJwt as its default route authorizer.")
    if not api_properties.get("AccessLogSettings"):
        fail("API Gateway access logging must be configured.")
    cors = api_properties.get("CorsConfiguration", {})
    origins = cors.get("AllowOrigins", [])
    if len(origins) != 1 or "FrontendBranchName" not in str(origins[0]) or "FrontendApp.DefaultDomain" not in str(origins[0]) or "*" in str(origins[0]):
        fail("CORS must derive one exact branch HTTPS origin from the Amplify app, without a wildcard.")
    if cors.get("AllowHeaders") != ["authorization", "content-type"]:
        fail("CORS must allow only the frontend's Authorization and JSON headers.")
    if "OPTIONS" not in cors.get("AllowMethods", []):
        fail("CORS must support preflight OPTIONS.")

    function = resources["ApiFunction"]["Properties"]
    if function.get("CodeUri") != "backend/src/":
        fail("Lambda CodeUri must remain backend/src/ so handler and dependency manifest package together.")
    if not (ROOT / "backend" / "src" / "requirements.txt").exists():
        fail("SAM CodeUri must include requirements.txt so backend dependencies are reproducible.")
    role_properties = resources["ApiExecutionRole"]["Properties"]
    if function.get("Role") != {"GetAtt": "ApiExecutionRole.Arn"}:
        fail("Lambda must use the explicit execution role shared by the console and template configurations.")
    if role_properties.get("RoleName") != {"Sub": "${ResourceNamePrefix}-Api-ExecutionRole"}:
        fail("Template execution-role name must match the console runbook at the default prefix.")
    if not any("AWSLambdaBasicExecutionRole" in str(value) for value in role_properties.get("ManagedPolicyArns", [])):
        fail("Explicit Lambda execution role must include the AWSLambdaBasicExecutionRole managed policy.")
    trust = role_properties.get("AssumeRolePolicyDocument", {})
    if not any("lambda.amazonaws.com" in str(statement.get("Principal", {})) and "sts:AssumeRole" in str(statement.get("Action", [])) for statement in trust.get("Statement", [])):
        fail("Execution role must allow Lambda service to assume it.")
    policies = [policy.get("PolicyDocument", {}) for policy in role_properties.get("Policies", [])]
    if "DynamoDBCrudPolicy" in str(policies):
        fail("Lambda must not receive broad DynamoDB CRUD permissions.")
    statements = [
        statement
        for policy in policies if isinstance(policy, dict)
        for statement in (policy.get("Statement", []) if isinstance(policy.get("Statement", []), list) else [policy.get("Statement")])
        if isinstance(statement, dict)
    ]
    policy_text = str(policies)
    for logical_id in ("ItemsTable", "ActivityTable", "UsersTable", "ArchiveTable"):
        if logical_id not in policy_text:
            fail(f"Lambda IAM must scope access to {logical_id} created by the template.")
    if "/index/*" not in policy_text:
        fail("Lambda IAM must include the secondary-index ARNs.")
    read_statement = next((s for s in statements if "dynamodb:Scan" in str(s.get("Action", []))), None)
    if not read_statement or not all(a in str(read_statement.get("Action", [])) for a in (
        "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan"
    )):
        fail("Lambda must have explicit, table-scoped read/query/scan permissions.")
    if "dynamodb:EnclosingOperation" not in policy_text or "ConditionCheckItem" not in policy_text:
        fail("Transactional item permissions must be restricted to TransactWriteItems.")
    for required_action in ("dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"):
        if required_action not in policy_text:
            fail(f"Missing transactional item permission: {required_action}.")
    transact = next((s for s in statements if "dynamodb:TransactWriteItems" in str(s.get("Action", []))), None)
    if not transact or not all(name in str(transact.get("Resource")) for name in ("ItemsTable", "ActivityTable", "ArchiveTable", "UsersTable")):
        fail("Transaction writes must be scoped to Items, Activity, Archive, and profile-update Users tables.")
    batch_write = next((s for s in statements if "dynamodb:BatchWriteItem" in str(s.get("Action", []))), None)
    if not batch_write or "ActivityTable" not in str(batch_write.get("Resource")) or "ItemsTable" in str(batch_write.get("Resource")):
        fail("BatchWriteItem is only allowed on Activity for partial-restore summaries.")

    # The manual Console workflow uses an equivalent least-privilege policy template.
    console_policy_path = ROOT / "backend" / "console-lambda-policy.json"
    try:
        with console_policy_path.open(encoding="utf-8") as stream:
            console_policy = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"Could not load console Lambda policy template: {exc}")
    if console_policy.get("Version") != "2012-10-17":
        fail("Console Lambda policy must use the current IAM policy language version.")
    console_statements = console_policy.get("Statement", [])
    if not isinstance(console_statements, list) or not console_statements:
        fail("Console Lambda policy must define a non-empty Statement list.")
    serialized_console_policy = json.dumps(console_policy)
    if "*" in [resource for statement in console_statements for resource in (
        statement.get("Resource", []) if isinstance(statement.get("Resource", []), list) else [statement.get("Resource")]
    )]:
        fail("Console Lambda policy must not grant resource-wide wildcard access.")
    for table_name in ("TeamFollowUp-Items", "TeamFollowUp-Activity", "TeamFollowUp-Users", "TeamFollowUp-Archive"):
        if table_name not in serialized_console_policy:
            fail(f"Console Lambda policy must include the target {table_name} table.")
    if "REPLACE_WITH_12_DIGIT_ACCOUNT_ID" not in serialized_console_policy:
        fail("Console Lambda policy must use an explicit account-ID placeholder rather than a guessed account ID.")
    console_read = next((s for s in console_statements if "dynamodb:Scan" in str(s.get("Action", []))), None)
    if not console_read or not all(action in str(console_read.get("Action", [])) for action in (
        "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan"
    )):
        fail("Console Lambda policy must allow the table-scoped read/query operations used by the handler.")
    console_batch_write = next((s for s in console_statements if "dynamodb:BatchWriteItem" in str(s.get("Action", []))), None)
    if not console_batch_write or "TeamFollowUp-Activity" not in str(console_batch_write.get("Resource")) or "TeamFollowUp-Items" in str(console_batch_write.get("Resource")):
        fail("Console Lambda policy BatchWriteItem must be scoped to the Activity table only.")
    console_transact = next((s for s in console_statements if "dynamodb:TransactWriteItems" in str(s.get("Action", []))), None)
    if not console_transact or not all(name in str(console_transact.get("Resource")) for name in (
        "TeamFollowUp-Items", "TeamFollowUp-Activity", "TeamFollowUp-Archive", "TeamFollowUp-Users"
    )):
        fail("Console Lambda policy transactions must be scoped to Items, Activity, Archive, and Users profile writes.")
    if "dynamodb:EnclosingOperation" not in serialized_console_policy:
        fail("Console Lambda policy transactional item-level writes must be restricted to TransactWriteItems.")
    handler_source_for_profile_access = (ROOT / "backend" / "src" / "handler.py").read_text(encoding="utf-8")
    if "USERS.update_item(" in handler_source_for_profile_access:
        fail("Users-table writes must use TransactWriteItems; do not grant standalone UpdateItem on Users.")

    user_transactional_items = next((s for s in console_statements if s.get("Sid") == "AllowTransactionalItemOperationsOnly"), {})
    if "TeamFollowUp-Users" not in str(user_transactional_items.get("Resource", [])):
        fail("Users profile field updates must be allowed only within the constrained transactional item-action statement.")
    if "dynamodb:EnclosingOperation" not in str(user_transactional_items.get("Condition", {})):
        fail("Users profile item writes must stay restricted to TransactWriteItems.")

    # The console policy and template policy must grant the same actions and conditions;
    # only resource references differ (literal ARNs versus CloudFormation resource ARNs).
    template_by_sid = {statement.get("Sid"): statement for statement in statements if statement.get("Sid")}
    console_by_sid = {statement.get("Sid"): statement for statement in console_statements if statement.get("Sid")}
    expected_sids = {
        "ReadApplicationTables",
        "AllowPartialRestoreActivitySummaries",
        "AllowTransactionalItemOperationsOnly",
        "AllowAtomicWorkItemArchiveAndAuditTransactions",
        "VerifyCurrentCognitoPassword",
    }
    if set(template_by_sid) != expected_sids or set(console_by_sid) != expected_sids:
        fail("Console and template IAM policies must contain the same five narrowly scoped statement IDs.")
    for sid in sorted(expected_sids):
        template_statement = template_by_sid[sid]
        console_statement = console_by_sid[sid]
        template_actions = template_statement.get("Action", [])
        console_actions = console_statement.get("Action", [])
        template_actions = [template_actions] if isinstance(template_actions, str) else template_actions
        console_actions = [console_actions] if isinstance(console_actions, str) else console_actions
        if sorted(template_actions) != sorted(console_actions):
            fail(f"Console and template IAM action sets diverge for {sid}.")
        if template_statement.get("Condition") != console_statement.get("Condition"):
            fail(f"Console and template IAM conditions diverge for {sid}.")


    password_verify_statement = template_by_sid["VerifyCurrentCognitoPassword"]
    password_verify_actions = password_verify_statement.get("Action", [])
    if sorted(password_verify_actions) != ["cognito-idp:AdminGetUser", "cognito-idp:AdminInitiateAuth"]:
        fail("Current-password verification must use only AdminGetUser and AdminInitiateAuth.")
    if "TeamFollowUpUserPool" not in str(password_verify_statement.get("Resource", "")):
        fail("Password-verification IAM permissions must be scoped to the Cognito pool.")
    console_password_statement = console_by_sid["VerifyCurrentCognitoPassword"]
    if sorted(console_password_statement.get("Action", [])) != sorted(password_verify_actions):
        fail("Console and template Cognito password-verification actions must match.")
    if "userpool/REPLACE_WITH_USER_POOL_ID" not in str(console_password_statement.get("Resource", "")):
        fail("Console Cognito permissions must use an explicit User Pool ARN placeholder.")
    if "dynamodb:" in str(console_password_statement.get("Action", [])):
        fail("Cognito verification permissions must not grant additional DynamoDB access.")

    # The generated web origin and frontend settings are wired together without a dependency cycle.
    app_properties = resources["FrontendApp"]["Properties"]
    if app_properties.get("Repository") != {"Ref": "RepositoryUrl"} or app_properties.get("AccessToken") != {"Ref": "GitHubAccessToken"}:
        fail("Amplify app must connect to the configurable GitHub repository using the private token parameter.")
    branch_properties = resources["FrontendBranch"]["Properties"]
    if branch_properties.get("AppId") != {"GetAtt": "FrontendApp.AppId"}:
        fail("Amplify branch must belong to the app created by the template.")
    branch_vars = {row.get("Name"): row.get("Value") for row in branch_properties.get("EnvironmentVariables", [])}
    expected_branch_vars = {
        "TEAM_FOLLOW_UP_COGNITO_USER_POOL_ID": {"Ref": "TeamFollowUpUserPool"},
        "TEAM_FOLLOW_UP_COGNITO_CLIENT_ID": {"Ref": "TeamFollowUpAppClient"},
        "TEAM_FOLLOW_UP_COGNITO_TEAM_USER_ATTRIBUTE": "custom:teamUserId",
    }
    for name, value in expected_branch_vars.items():
        if branch_vars.get(name) != value:
            fail(f"Amplify branch must set {name} to the matching Cognito configuration.")
    api_env_value = branch_vars.get("TEAM_FOLLOW_UP_API_BASE_URL", {})
    if not isinstance(api_env_value, dict) or "TeamFollowUpApi" not in str(api_env_value.get("Sub", "")):
        fail("Amplify branch must receive the API URL generated by this template.")
    if resources["TeamFollowUpApi"]["Properties"]["CorsConfiguration"]["AllowOrigins"][0].get("Sub") != "https://${FrontendBranchName}.${FrontendApp.DefaultDomain}":
        fail("The API CORS origin must match the branch URL pattern used by the outputs.")

    # Cost alerts match the console setup; the recipient is injected at deploy time.
    budget = resources["MonthlyCostBudget"]["Properties"]["Budget"]
    if budget.get("BudgetLimit") != {"Amount": 1, "Unit": "USD"} or budget.get("TimeUnit") != "MONTHLY" or budget.get("BudgetType") != "COST":
        fail("The cost budget must be a $1 monthly cost budget.")
    notifications = resources["MonthlyCostBudget"]["Properties"].get("NotificationsWithSubscribers", [])
    actual_thresholds = sorted(
        n.get("Notification", {}).get("Threshold")
        for n in notifications if n.get("Notification", {}).get("NotificationType") == "ACTUAL"
    )
    forecast_thresholds = [
        n.get("Notification", {}).get("Threshold")
        for n in notifications if n.get("Notification", {}).get("NotificationType") == "FORECASTED"
    ]
    if actual_thresholds != [50, 80, 100] or forecast_thresholds != [100] or len(notifications) != 4:
        fail("Budget notifications must be actual 50/80/100 percent plus forecasted 100 percent.")
    if any(n.get("Notification", {}).get("ThresholdType") != "PERCENTAGE" for n in notifications):
        fail("Budget thresholds must be percentages.")
    if any(n.get("Subscribers", [{}])[0].get("Address") != {"Ref": "BudgetNotificationEmail"} for n in notifications):
        fail("All budget alerts must use the required deployment-time email parameter.")

    table_schema = {row["name"]: row for row in schema["tables"]}
    defined_indexes = {index["name"] for table in table_schema.values() for index in table.get("gsis", [])}
    handler = (ROOT / "backend" / "src" / "handler.py").read_text(encoding="utf-8")
    used_indexes = set(re.findall(r"IndexName=['\"]([A-Za-z0-9_]+)['\"]", handler))
    missing_indexes = used_indexes - defined_indexes
    if missing_indexes:
        fail("Handler references indexes not present in the physical schema contract: " + ", ".join(sorted(missing_indexes)))
    if not {"ParentIdIndex", "AssignedToIndex", "WorkspaceIndex", "GSI_ArchiveIndex"}.issubset(used_indexes):
        fail("Handler must exercise the documented Items and Archive access indexes.")
    if re.search(r"IndexName=['\"]GSI_(?:CognitoSub|ItemTimeline|ApplicationTimeline|RootTimeline|ParentTimeline|ListUpdated|ListCreated|RootUpdated|AssignedUpdated|AssignedCreated)['\"]", handler):
        fail("Handler still references a legacy index not created by either documented deployment path.")

    outputs = template.get("Outputs", {})
    expected_outputs = {
        "CognitoUserPoolId": {"Ref": "TeamFollowUpUserPool"},
        "CognitoUserPoolClientId": {"Ref": "TeamFollowUpAppClient"},
        "ItemsTableName": {"Ref": "ItemsTable"},
        "ActivityTableName": {"Ref": "ActivityTable"},
        "UsersTableName": {"Ref": "UsersTable"},
        "ArchiveTableName": {"Ref": "ArchiveTable"},
        "CloudWatchDashboardName": {"Ref": "TeamFollowUpDashboard"},
        "ApiExecutionRoleName": {"Ref": "ApiExecutionRole"},
        "MonthlyCostBudgetName": {"Ref": "MonthlyCostBudget"},
    }
    for name, value in expected_outputs.items():
        if outputs.get(name, {}).get("Value") != value:
            fail(f"Output {name} must expose the resource created by this template.")
    if not isinstance(outputs.get("ApiBaseUrl", {}).get("Value"), dict) or "TeamFollowUpApi" not in str(outputs["ApiBaseUrl"]["Value"]):
        fail("ApiBaseUrl output must point to the created HTTP API.")
    if not isinstance(outputs.get("FrontendUrl", {}).get("Value"), dict) or "FrontendApp.DefaultDomain" not in str(outputs["FrontendUrl"]["Value"]):
        fail("FrontendUrl output must identify the generated Amplify branch URL.")

    print("Infrastructure checks passed: full from-scratch Cognito/DynamoDB/API/Lambda/IAM/CloudWatch/Amplify/Budget template, exact HTTPS CORS, matching schema/index contracts, least-privilege console Lambda policy, and separate current-account snapshot.")

if __name__ == "__main__":
    main()
