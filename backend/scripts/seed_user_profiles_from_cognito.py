#!/usr/bin/env python3
"""Seed the Team Follow-Up profile table from the deployed Cognito user pool.

Each provisioned Cognito user must have the administrator-managed
``custom:teamUserId`` attribute set to one of u1..u6. The public browser client
is deliberately not granted permission to modify this attribute. This script
resolves each user's Cognito ``sub`` server-side so operators do not need to copy
tokens or sub values by hand.
Run only from a trusted administrative environment using credentials with
cognito-idp:ListUsers and dynamodb:BatchWriteItem permissions.
"""

import argparse
import sys

import boto3

EXPECTED = {
    "u1": ("Marwa", "Team Leader"),
    "u2": ("Zyad", "AWS Engineer"),
    "u3": ("Nadine", "AWS Engineer"),
    "u4": ("Omar", "AWS Engineer"),
    "u5": ("Haneen", "AWS Engineer"),
    "u6": ("Dina", "AWS Engineer"),
}


def list_team_users(cognito, user_pool_id):
    """Return a one-to-one mapping of team IDs to active Cognito users."""
    paginator = cognito.get_paginator("list_users")
    mapped = {}
    all_subs = set()

    for page in paginator.paginate(
        UserPoolId=user_pool_id,
        PaginationConfig={"PageSize": 60},
    ):
        for user in page.get("Users", []):
            attributes = {
                item.get("Name", ""): item.get("Value", "")
                for item in user.get("Attributes", [])
            }
            team_user_id = attributes.get("custom:teamUserId", "").strip()
            if not team_user_id:
                continue
            if team_user_id not in EXPECTED:
                raise ValueError(
                    f"Cognito user {user.get('Username', '<unknown>')} has unsupported "
                    f"custom:teamUserId {team_user_id!r}; expected one of {', '.join(EXPECTED)}."
                )
            if team_user_id in mapped:
                raise ValueError(
                    f"More than one Cognito account is mapped to {team_user_id}. "
                    "Ensure each team ID belongs to exactly one account."
                )
            sub = attributes.get("sub", "").strip()
            if not sub:
                raise ValueError(
                    f"Cognito user {user.get('Username', '<unknown>')} has no sub attribute."
                )
            if sub in all_subs:
                raise ValueError("Duplicate Cognito sub detected; refusing to write profiles.")
            all_subs.add(sub)
            mapped[team_user_id] = {
                "userId": team_user_id,
                "displayName": EXPECTED[team_user_id][0],
                "role": EXPECTED[team_user_id][1],
                "cognitoSub": sub,
                "enabled": bool(user.get("Enabled", True)),
            }

    missing = sorted(set(EXPECTED) - set(mapped))
    if missing:
        raise ValueError(
            "No Cognito user was found for: " + ", ".join(missing) +
            ". Create each account and set its custom:teamUserId before seeding."
        )
    return mapped


def main():
    parser = argparse.ArgumentParser(
        description="Seed TeamFollowUp-UserProfiles from a Cognito User Pool."
    )
    parser.add_argument("--user-pool-id", required=True, help="Deployed Cognito User Pool ID.")
    parser.add_argument("--table", required=True, help="UserProfiles DynamoDB table name from stack outputs.")
    parser.add_argument("--region", required=True, help="AWS Region for Cognito and DynamoDB.")
    parser.add_argument("--dry-run", action="store_true", help="Validate mapping and show names without writing records.")
    args = parser.parse_args()

    cognito = boto3.client("cognito-idp", region_name=args.region)
    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    try:
        mapped = list_team_users(cognito, args.user_pool_id)
    except Exception as exc:
        print(f"Profile mapping validation failed: {exc}", file=sys.stderr)
        return 2

    print("Validated Cognito accounts:")
    for user_id in EXPECTED:
        row = mapped[user_id]
        print(f"  {user_id}: {row['displayName']} ({row['role']}) — {'enabled' if row['enabled'] else 'disabled'}")

    if args.dry_run:
        print("Dry run complete; no DynamoDB records were written.")
        return 0

    table = dynamodb.Table(args.table)
    with table.batch_writer() as batch:
        for row in mapped.values():
            batch.put_item(Item=row)
    print(f"Seeded {len(mapped)} profiles into {args.table}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
