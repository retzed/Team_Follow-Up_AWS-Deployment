#!/usr/bin/env python3
"""Seed the existing TeamFollowUp-Users table from Cognito team IDs.

Each standard user must have custom:teamUserId set to u1..u6 and the protected
root Cognito user must be mapped to root. The script resolves sub values itself.
Run it from a trusted admin environment with cognito-idp:ListUsers and
DynamoDB BatchWriteItem permissions.
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
    "root": ("root", "Root"),
}


def list_team_users(cognito, user_pool_id):
    """Return a one-to-one mapping of team IDs to Cognito users."""
    mapped = {}
    seen_subs = set()
    paginator = cognito.get_paginator("list_users")

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

            username = user.get("Username", "<unknown>")
            if team_user_id not in EXPECTED:
                raise ValueError(
                    f"Cognito user {username} has unsupported custom:teamUserId {team_user_id!r}; "
                    f"expected one of {', '.join(EXPECTED)}."
                )
            if team_user_id in mapped:
                raise ValueError(
                    f"More than one Cognito account is mapped to {team_user_id}; "
                    "each team ID must belong to exactly one account."
                )

            sub = attributes.get("sub", "").strip()
            if not sub:
                raise ValueError(f"Cognito user {username} has no sub attribute.")
            if sub in seen_subs:
                raise ValueError("Duplicate Cognito sub detected; refusing to write profiles.")
            seen_subs.add(sub)

            display_name, role = EXPECTED[team_user_id]
            mapped[team_user_id] = {
                "userId": team_user_id,
                "displayName": display_name,
                "role": role,
                "icon": "crown" if team_user_id == "root" else ("compass" if team_user_id == "u1" else "terminal"),
                "privilege": "Administrator" if team_user_id in {"u1", "root"} else "User",
                "cognitoSub": sub,
                "enabled": bool(user.get("Enabled", True)),
            }

    missing = sorted(set(EXPECTED) - set(mapped))
    if missing:
        raise ValueError(
            "No Cognito user was found for: " + ", ".join(missing)
            + ". Create each account and set its custom:teamUserId before seeding."
        )
    return mapped


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-pool-id", required=True, help="Deployed Cognito User Pool ID.")
    parser.add_argument("--table", required=True, help="Existing Users table name; use TeamFollowUp-Users in the current lab.")
    parser.add_argument("--region", required=True, help="AWS Region for Cognito and DynamoDB.")
    parser.add_argument("--dry-run", action="store_true", help="Validate account mapping (including root) without writing records.")
    args = parser.parse_args(argv)

    try:
        cognito = boto3.client("cognito-idp", region_name=args.region)
        mapped = list_team_users(cognito, args.user_pool_id)
    except Exception as exc:
        print(f"Profile mapping validation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    print("Validated Cognito accounts (sub values are not displayed):")
    for user_id in EXPECTED:
        row = mapped[user_id]
        status = "enabled" if row["enabled"] else "disabled"
        print(f"  {user_id}: {row['displayName']} ({row['role']}) — {status}")

    if args.dry_run:
        print("Dry run complete; no DynamoDB records were written.")
        return 0

    try:
        table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
        with table.batch_writer() as batch:
            for user_id in EXPECTED:
                batch.put_item(Item=mapped[user_id])
    except Exception as exc:
        print(f"Profile seeding failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"Seeded {len(mapped)} profiles into {args.table} in {args.region}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
