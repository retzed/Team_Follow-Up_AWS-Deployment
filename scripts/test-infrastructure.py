#!/usr/bin/env python3
"""Contract tests for the target SAM template and recorded console bootstrap."""

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
    if set(documented_tables) != expected_names:
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
    with TEMPLATE_PATH.open(encoding="utf-8") as stream:
        template = yaml.load(stream, Loader=CloudFormationLoader)

    resources = template.get("Resources", {})
    parameters = template.get("Parameters", {})
    required = {
        "TeamFollowUpApi": "AWS::Serverless::HttpApi",
        "ApiFunction": "AWS::Serverless::Function",
        "ApiAccessLogGroup": "AWS::Logs::LogGroup",
        "ApiFunctionLogGroup": "AWS::Logs::LogGroup",
        "TeamFollowUpDashboard": "AWS::CloudWatch::Dashboard",
        "ApiLambdaErrorsAlarm": "AWS::CloudWatch::Alarm",
        "ApiLambdaThrottlesAlarm": "AWS::CloudWatch::Alarm",
        "ApiGateway5xxAlarm": "AWS::CloudWatch::Alarm",
    }
    for logical_id, expected_type in required.items():
        if resources.get(logical_id, {}).get("Type") != expected_type:
            fail(f"Missing or wrong resource type for {logical_id}.")

    resource_types = [resource.get("Type") for resource in resources.values()]
    if any(resource_type == "AWS::DynamoDB::Table" for resource_type in resource_types):
        fail("SAM must reuse the manually created DynamoDB tables, not create conflicting copies.")
    if any(resource_type in ("AWS::Cognito::UserPool", "AWS::Cognito::UserPoolClient") for resource_type in resource_types):
        fail("SAM must reuse the existing Cognito pool/client, not create another identity source.")

    origin = parameters.get("AllowedOrigin", {})
    if "Default" in origin:
        fail("AllowedOrigin must be explicit, not a public placeholder default.")
    if not origin.get("AllowedPattern", "").startswith("^https://"):
        fail("AllowedOrigin must enforce HTTPS.")
    prefix_pattern = parameters.get("TableNamePrefix", {}).get("AllowedPattern", "")
    if not prefix_pattern.startswith("^[A-Za-z0-9]"):
        fail("TableNamePrefix must start with a letter or number for API/log/dashboard resource names.")

    schema_path = ROOT / "backend" / "table-schema.json"
    with schema_path.open(encoding="utf-8") as stream:
        schema = json.load(stream)
    bootstrap = schema["currentConsoleBootstrap"]
    cognito = bootstrap["cognito"]
    expected_parameters = {
        "ExistingCognitoUserPoolId": cognito["userPoolId"],
        "ExistingCognitoAppClientId": cognito["appClientId"],
        "ExistingItemsTableName": "TeamFollowUp-Items",
        "ExistingActivityTableName": "TeamFollowUp-Activity",
        "ExistingUsersTableName": "TeamFollowUp-Users",
        "ExistingArchiveTableName": "TeamFollowUp-Archive",
    }
    for parameter_name, expected_default in expected_parameters.items():
        parameter = parameters.get(parameter_name)
        if not parameter:
            fail(f"SAM is missing the required existing-resource parameter {parameter_name}.")
        if parameter.get("Default") != expected_default:
            fail(f"{parameter_name} default differs from the current console bootstrap; update both deliberately.")
    variables = template.get("Globals", {}).get("Function", {}).get("Environment", {}).get("Variables", {})
    expected_variables = {
        "WORK_ITEMS_TABLE": "ExistingItemsTableName",
        "ACTIVITY_TABLE": "ExistingActivityTableName",
        "USER_PROFILES_TABLE": "ExistingUsersTableName",
        "ARCHIVE_TABLE": "ExistingArchiveTableName",
    }
    for variable, parameter_name in expected_variables.items():
        if variables.get(variable) != {"Ref": parameter_name}:
            fail(f"Lambda environment variable {variable} must point to {parameter_name}.")

    api_properties = resources["TeamFollowUpApi"]["Properties"]
    authorizers = api_properties.get("Auth", {}).get("Authorizers", {})
    jwt = authorizers.get("CognitoJwt", {}).get("JwtConfiguration", {})
    if "ExistingCognitoUserPoolId" not in str(jwt.get("issuer")):
        fail("API JWT issuer must use the existing Cognito User Pool parameter.")
    if "ExistingCognitoAppClientId" not in str(jwt.get("audience")):
        fail("API JWT audience must use the existing public app client parameter.")
    if api_properties.get("Name") and api_properties.get("DefinitionBody", {}).get("info", {}).get("title"):
        fail("SAM HttpApi Name and inline OpenAPI info.title conflict; keep the title unset when Name is configured.")
    if not api_properties.get("AccessLogSettings"):
        fail("API Gateway access logging is not configured.")
    if api_properties.get("Auth", {}).get("DefaultAuthorizer") != "CognitoJwt":
        fail("The API must use CognitoJwt as its default route authorizer.")
    cors = api_properties.get("CorsConfiguration", {})
    if "*" in str(cors) or "AllowedOrigin" not in str(cors.get("AllowOrigins", [])):
        fail("CORS must be restricted to the explicit AllowedOrigin parameter.")

    log_group = resources["ApiFunctionLogGroup"]["Properties"]
    if log_group.get("RetentionInDays") != {"Ref": "LogRetentionDays"}:
        fail("Lambda log retention must be controlled by LogRetentionDays.")

    function = resources["ApiFunction"]["Properties"]
    if function.get("CodeUri") != "backend/src/":
        fail("Lambda CodeUri must remain backend/src/ so handler and dependency manifest package together.")
    if not (ROOT / "backend" / "src" / "requirements.txt").exists():
        fail("SAM CodeUri must include requirements.txt so backend dependencies are reproducible.")

    policies = function.get("Policies", [])
    if "DynamoDBCrudPolicy" in str(policies):
        fail("Lambda must not receive broad DynamoDB CRUD permissions.")
    statements = [
        statement
        for policy in policies if isinstance(policy, dict)
        for statement in (policy.get("Statement", []) if isinstance(policy.get("Statement", []), list) else [policy.get("Statement")])
        if isinstance(statement, dict)
    ]
    policy_text = str(policies)
    for parameter_name in ("ExistingItemsTableName", "ExistingActivityTableName", "ExistingUsersTableName", "ExistingArchiveTableName"):
        if parameter_name not in policy_text:
            fail(f"Lambda IAM must scope reads to the configured table name parameter {parameter_name}.")
    if "/index/*" not in policy_text:
        fail("Lambda IAM must allow reads on the existing Items and Archive secondary indexes.")
    read_statement = next((statement for statement in statements if "dynamodb:Scan" in str(statement.get("Action", []))), None)
    if not read_statement:
        fail("Lambda must have explicit read/scan access for the existing no-GSI Users table and Activity timeline.")
    if not all(action in str(read_statement.get("Action", [])) for action in ("dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan")):
        fail("Read policy must support existing table lookups, queries, and scans.")

    transaction_resources = next(
        (statement.get("Resource") for statement in statements
         if "dynamodb:TransactWriteItems" in str(statement.get("Action", []))),
        None,
    )
    if transaction_resources is None or not all(
        parameter_name in str(transaction_resources)
        for parameter_name in ("ExistingItemsTableName", "ExistingActivityTableName", "ExistingArchiveTableName")
    ):
        fail("Transactional write permission must be scoped to the existing Items, Activity, and Archive tables.")
    if "dynamodb:EnclosingOperation" not in policy_text or "ConditionCheckItem" not in policy_text:
        fail("Transactional item permissions must be restricted to operations inside TransactWriteItems.")
    for required_action in ("dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"):
        if required_action not in policy_text:
            fail(f"Missing transactional item permission: {required_action}.")
    if not any(
        "dynamodb:BatchWriteItem" in str(statement.get("Action", []))
        and "ExistingActivityTableName" in str(statement.get("Resource"))
        for statement in statements
    ):
        fail("Partial restore activity summaries require BatchWriteItem only on the existing Activity table.")

    table_schema = {row["name"]: row for row in schema["tables"]}
    defined_indexes = {
        index["name"]
        for table in table_schema.values()
        for index in table.get("gsis", [])
    }
    handler = (ROOT / "backend" / "src" / "handler.py").read_text(encoding="utf-8")
    used_indexes = set(re.findall(r"IndexName=['\"]([A-Za-z0-9_]+)['\"]", handler))
    missing_indexes = used_indexes - defined_indexes
    if missing_indexes:
        fail("Handler references indexes not present in the current table schema: " + ", ".join(sorted(missing_indexes)))
    if not {"ParentIdIndex", "AssignedToIndex", "WorkspaceIndex", "GSI_ArchiveIndex"}.issubset(used_indexes):
        fail("Handler must exercise the current Items and Archive indexes instead of the superseded SAM-only indexes.")
    if re.search(r"IndexName=['\"]GSI_(?:CognitoSub|ItemTimeline|ApplicationTimeline|RootTimeline|ParentTimeline|ListUpdated|ListCreated|RootUpdated|AssignedUpdated|AssignedCreated)['\"]", handler):
        fail("Handler still references an index that does not exist on the manually created tables.")

    outputs = template.get("Outputs", {})
    if outputs.get("CognitoUserPoolId", {}).get("Value") != {"Ref": "ExistingCognitoUserPoolId"}:
        fail("CognitoUserPoolId output must expose the existing pool ID.")
    if outputs.get("CognitoUserPoolClientId", {}).get("Value") != {"Ref": "ExistingCognitoAppClientId"}:
        fail("CognitoUserPoolClientId output must expose the existing app client ID.")

    print("Infrastructure checks passed: existing Cognito/table parameters, current DynamoDB key/index contracts, scoped IAM, HTTP API/JWT/CORS, Lambda, and CloudWatch resources.")


if __name__ == "__main__":
    main()
