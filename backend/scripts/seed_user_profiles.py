#!/usr/bin/env python3
"""Seed the six application profiles after Cognito users have been created.

Use AWS CloudShell or a trusted admin workstation with boto3 and AWS credentials.
Do not commit the real mapping file: Cognito sub values are account identifiers.
"""
import argparse
import json
import re
import sys
import boto3

EXPECTED = {
    'u1': ('Marwa', 'Team Leader'),
    'u2': ('Zyad', 'AWS Engineer'),
    'u3': ('Nadine', 'AWS Engineer'),
    'u4': ('Omar', 'AWS Engineer'),
    'u5': ('Haneen', 'AWS Engineer'),
    'u6': ('Dina', 'AWS Engineer'),
}


def main():
    parser = argparse.ArgumentParser(description='Seed TeamFollowUp-UserProfiles using Cognito sub values.')
    parser.add_argument('--file', required=True, help='Private JSON file containing the six actual Cognito sub values.')
    parser.add_argument('--table', default='TeamFollowUp-UserProfiles', help='DynamoDB user profile table name.')
    parser.add_argument('--region', required=True, help='AWS region where the table exists.')
    args = parser.parse_args()
    try:
        rows = json.load(open(args.file, encoding='utf-8'))
    except Exception as exc:
        parser.error(f'Could not read mapping JSON: {exc}')
    if not isinstance(rows, list):
        parser.error('Mapping file must contain a JSON array.')
    if {r.get('userId') for r in rows if isinstance(r, dict)} != set(EXPECTED):
        parser.error('Mapping file must contain exactly u1 through u6.')
    subs = []
    normalized = []
    for row in rows:
        uid = row['userId']
        display_name, role = EXPECTED[uid]
        sub = str(row.get('cognitoSub') or '').strip()
        if not sub or 'REPLACE_WITH' in sub.upper():
            parser.error(f'{uid} has no real cognitoSub; replace all placeholders before seeding.')
        if row.get('displayName') != display_name or row.get('role') != role:
            parser.error(f'Profile name/role mismatch for {uid}; expected {display_name} / {role}.')
        subs.append(sub)
        normalized.append({'userId': uid, 'displayName': display_name, 'role': role, 'cognitoSub': sub, 'enabled': row.get('enabled', True) is not False})
    if len(set(subs)) != len(subs):
        parser.error('Each team member must map to a unique Cognito sub.')
    table = boto3.resource('dynamodb', region_name=args.region).Table(args.table)
    with table.batch_writer() as batch:
        for item in normalized:
            batch.put_item(Item=item)
    print(f'Seeded {len(normalized)} profiles in {args.table}.')


if __name__ == '__main__':
    main()
