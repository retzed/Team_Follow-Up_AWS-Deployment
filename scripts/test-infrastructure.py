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

    target_archive = next((row for row in schema.get("tables", []) if row.get("name") == "TeamFollowUp-Archive"), None)
    if not target_archive or target_archive.get("primaryKey", {}).get("partition") != "archiveId":
        fail("Target SAM schema must continue documenting the Archive primary key.")
    target_indexes = {row.get("name"): (row.get("pk"), row.get("sk")) for row in target_archive.get("gsis", [])}
    if target_indexes != expected_archive_indexes:
        fail("Target Archive key/index documentation must agree with the backend's archive access contract.")

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
        "TeamFollowUpUserPool": "AWS::Cognito::UserPool",
        "TeamFollowUpUserPoolClient": "AWS::Cognito::UserPoolClient",
        "TeamFollowUpApi": "AWS::Serverless::HttpApi",
        "ApiFunction": "AWS::Serverless::Function",
        "WorkItemsTable": "AWS::DynamoDB::Table",
        "ActivityEventsTable": "AWS::DynamoDB::Table",
        "UserProfilesTable": "AWS::DynamoDB::Table",
        "ArchiveTable": "AWS::DynamoDB::Table",
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

    origin = parameters.get("AllowedOrigin", {})
    if "Default" in origin:
        fail("AllowedOrigin must be explicit, not a public placeholder default.")
    if not origin.get("AllowedPattern", "").startswith("^https://"):
        fail("AllowedOrigin must enforce HTTPS.")
    prefix_pattern = parameters.get("TableNamePrefix", {}).get("AllowedPattern", "")
    if not prefix_pattern.startswith("^[A-Za-z0-9]"):
        fail("TableNamePrefix must start with a letter or number to produce valid DynamoDB table names.")

    cognito_client = resources["TeamFollowUpUserPoolClient"]["Properties"]
    if cognito_client.get("GenerateSecret") is not False:
        fail("Browser Cognito client must not have a client secret.")
    if "custom:teamUserId" not in cognito_client.get("ReadAttributes", []):
        fail("Cognito client must be able to read custom:teamUserId.")

    authorizers = resources["TeamFollowUpApi"]["Properties"].get("Auth", {}).get("Authorizers", {})
    jwt = authorizers.get("CognitoJwt", {}).get("JwtConfiguration", {})
    if "TeamFollowUpUserPool" not in str(jwt.get("issuer")) or "TeamFollowUpUserPoolClient" not in str(jwt.get("audience")):
        fail("API JWT authorizer must use the generated Cognito pool and public client.")
    api_properties = resources["TeamFollowUpApi"]["Properties"]
    openapi_info = api_properties.get("DefinitionBody", {}).get("info", {})
    if api_properties.get("Name") and openapi_info.get("title"):
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

    policies = resources["ApiFunction"]["Properties"].get("Policies", [])
    if "DynamoDBCrudPolicy" in str(policies):
        fail("Lambda must not receive broad DynamoDB CRUD permissions; use read policies and explicit write actions.")
    read_tables = {
        policy["DynamoDBReadPolicy"]["TableName"].get("Ref")
        for policy in policies
        if isinstance(policy, dict)
        and isinstance(policy.get("DynamoDBReadPolicy"), dict)
        and isinstance(policy["DynamoDBReadPolicy"].get("TableName"), dict)
    }
    if read_tables != {"WorkItemsTable", "ActivityEventsTable", "UserProfilesTable", "ArchiveTable"}:
        fail("Lambda must use read-only policy templates for each of the four application tables.")
    inline_statements = [
        statement
        for policy in policies if isinstance(policy, dict)
        for statement in (policy.get("Statement", []) if isinstance(policy.get("Statement", []), list) else [policy.get("Statement")])
        if isinstance(statement, dict)
    ]
    transaction_resources = next(
        (statement.get("Resource") for statement in inline_statements
         if "dynamodb:TransactWriteItems" in str(statement.get("Action", []))),
        None,
    )
    if transaction_resources is None or not all(
        table_id in str(transaction_resources)
        for table_id in ("WorkItemsTable", "ActivityEventsTable", "ArchiveTable")
    ):
        fail("Lambda requires explicit transaction-write permission scoped to WorkItems, ActivityEvents, and Archive.")
    if "dynamodb:EnclosingOperation" not in str(policies) or "ConditionCheckItem" not in str(policies):
        fail("Transactional item permissions must be limited to the enclosing write transaction.")
    for required_action in ("dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"):
        if required_action not in str(policies):
            fail(f"Missing transactional item permission: {required_action}.")
    if not any(
        "dynamodb:BatchWriteItem" in str(statement.get("Action", []))
        and "ActivityEventsTable.Arn" in str(statement.get("Resource"))
        for statement in inline_statements
    ):
        fail("Partial restore audit summaries require BatchWriteItem only on the ActivityEvents table.")
    if resources["ApiFunction"]["Properties"].get("CodeUri") != "backend/src/":
        fail("Lambda CodeUri must remain backend/src/ so the handler and dependency manifest package together.")
    if not (ROOT / "backend" / "src" / "requirements.txt").exists():
        fail("SAM CodeUri must include requirements.txt so backend dependencies are reproducible.")

    for logical_id in ("WorkItemsTable", "ActivityEventsTable", "UserProfilesTable", "ArchiveTable"):
        table = resources[logical_id]
        if table.get("DeletionPolicy") != "Retain" or table.get("UpdateReplacePolicy") != "Retain":
            fail(f"{logical_id} must retain team data on stack removal/replacement.")

    table_indexes = {
        logical_id: {gsi["IndexName"] for gsi in resource["Properties"].get("GlobalSecondaryIndexes", [])}
        for logical_id, resource in resources.items()
        if resource.get("Type") == "AWS::DynamoDB::Table"
    }
    expected_indexes = {
        "WorkItemsTable": {"GSI_ListUpdated", "GSI_ListCreated", "GSI_RootUpdated", "GSI_AssignedUpdated", "GSI_AssignedCreated"},
        "ActivityEventsTable": {"GSI_ItemTimeline", "GSI_ApplicationTimeline", "GSI_RootTimeline", "GSI_ParentTimeline"},
        "UserProfilesTable": {"GSI_CognitoSub"},
        "ArchiveTable": {"GSI_ArchiveIndex", "GSI_ArchiveRoot"},
    }
    for table_id, indexes in expected_indexes.items():
        if table_indexes.get(table_id) != indexes:
            fail(f"{table_id} indexes differ from the documented data access contract.")
    handler = (ROOT / "backend" / "src" / "handler.py").read_text(encoding="utf-8")
    used_indexes = set(re.findall(r"IndexName=['\"](GSI_[A-Za-z0-9]+)['\"]", handler))
    defined_indexes = set().union(*table_indexes.values())
    missing_indexes = used_indexes - defined_indexes
    if missing_indexes:
        fail("Handler references undefined DynamoDB indexes: " + ", ".join(sorted(missing_indexes)))

    print("Infrastructure checks passed: target SAM contract plus current four-table console bootstrap, Archive keys/indexes/capacity, Cognito/JWT, restricted CORS, Lambda IAM, and CloudWatch resources.")


if __name__ == "__main__":
    main()
