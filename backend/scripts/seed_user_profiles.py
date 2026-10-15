#!/usr/bin/env python3
"""Seed team profiles from a private JSON mapping of Cognito sub values.

Prefer seed_user_profiles_from_cognito.py, which discovers sub values directly
from Cognito. This manual alternative overwrites the listed profile rows, so
review the dry-run output before applying it.
"""
import argparse
import json
import sys
from pathlib import Path

import boto3

EXPECTED = {
    "u1": ("Marwa", "Team Leader"),
    "u2": ("Zyad", "AWS Engineer"),
    "u3": ("Nadine", "AWS Engineer"),
    "u4": ("Omar", "AWS Engineer"),
    "u5": ("Haneen", "AWS Engineer"),
    "u6": ("Dina", "AWS Engineer"),
}


def normalize_profiles(rows):
    """Validate the entire mapping before allowing any writes."""
    if not isinstance(rows, list):
        raise ValueError("Mapping file must contain a JSON array.")
    if len(rows) != len(EXPECTED) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Mapping file must contain exactly six profile objects (u1 through u6).")

    ids = [row.get("userId") for row in rows]
    if any(not isinstance(user_id, str) for user_id in ids):
        raise ValueError("Every profile must have a string userId.")
    if len(set(ids)) != len(EXPECTED) or set(ids) != set(EXPECTED):
        raise ValueError("Mapping file must contain each ID u1 through u6 exactly once.")

    normalized = []
    seen_subs = set()
    by_id = {row["userId"]: row for row in rows}
    for user_id, (display_name, role) in EXPECTED.items():
        row = by_id[user_id]
        sub_value = row.get("cognitoSub")
        if not isinstance(sub_value, str):
            raise ValueError(f"{user_id} must have a string cognitoSub.")
        sub = sub_value.strip()
        if not sub or "REPLACE_WITH" in sub.upper():
            raise ValueError(f"{user_id} has no real cognitoSub; replace all placeholders before seeding.")
        if sub in seen_subs:
            raise ValueError("Each team member must map to a unique Cognito sub.")
        seen_subs.add(sub)

        if row.get("displayName") != display_name or row.get("role") != role:
            raise ValueError(
                f"Profile name/role mismatch for {user_id}; expected {display_name} / {role}."
            )
        enabled = row.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError(f"{user_id}.enabled must be true or false.")

        normalized.append({
            "userId": user_id,
            "displayName": display_name,
            "role": role,
            "cognitoSub": sub,
            "enabled": enabled,
        })
    return normalized


def load_profiles(path):
    """Read and normalize a private JSON mapping file."""
    try:
        with Path(path).open(encoding="utf-8") as stream:
            rows = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read valid JSON from {path}: {exc}") from exc
    return normalize_profiles(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="Private JSON file containing the six actual Cognito sub values.")
    parser.add_argument("--table", required=True, help="Existing Users table name; use TeamFollowUp-Users in the current lab.")
    parser.add_argument("--region", required=True, help="AWS Region where the table exists.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and preview the mapping without writing records.")
    args = parser.parse_args(argv)

    try:
        profiles = load_profiles(args.file)
    except ValueError as exc:
        parser.error(str(exc))

    print("Validated profile mapping (Cognito sub values are not displayed):")
    for row in profiles:
        status = "enabled" if row["enabled"] else "disabled"
        print(f"  {row['userId']}: {row['displayName']} ({row['role']}) — {status}")
    if args.dry_run:
        print("Dry run complete; no DynamoDB records were written.")
        return 0

    try:
        table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
        with table.batch_writer() as batch:
            for row in profiles:
                batch.put_item(Item=row)
    except Exception as exc:
        print(f"Profile seeding failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"Seeded {len(profiles)} profiles into {args.table} in {args.region}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
