#!/usr/bin/env python3
"""Static contract tests for the deployable AWS SAM template."""

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


def main():
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

    print("Infrastructure contract checks passed: Cognito, JWT authorization, restricted CORS, log retention, Lambda transaction IAM, four retained DynamoDB tables with required indexes, CloudWatch dashboard/alarms, and handler index names.")


if __name__ == "__main__":
    main()
