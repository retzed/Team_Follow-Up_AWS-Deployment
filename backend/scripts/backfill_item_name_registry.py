#!/usr/bin/env python3
"""Backfill permanent global work-item name reservations in TeamFollowUp-Realtime.

The script is intentionally dry-run by default. Run it while application writes
are paused, resolve any reported duplicate names, then rerun with --apply.
"""
from __future__ import annotations

import argparse
import sys
import unicodedata
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


def normalize_item_name(value: object) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).split()).lower()


def scan_all(table):
    rows = []
    kwargs = {"ConsistentRead": True}
    while True:
        result = table.scan(**kwargs)
        rows.extend(result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            return rows
        kwargs["ExclusiveStartKey"] = last_key


def item_identity(row: dict) -> str:
    return str(row.get("itemId") or row.get("archiveId") or row.get("id") or "").strip()


def collect_reservations(work_rows: list[dict], archive_rows: list[dict]):
    by_name: dict[str, dict] = {}
    conflicts: dict[str, dict[str, dict]] = {}
    for state, rows in (("active", work_rows), ("archived", archive_rows)):
        for row in rows:
            item_id = item_identity(row)
            normalized = normalize_item_name(row.get("name"))
            if not item_id or not normalized:
                continue
            existing = by_name.get(normalized)
            current = {"itemId": item_id, "name": str(row.get("name") or ""), "type": str(row.get("type") or ""), "state": state}
            if existing and existing["itemId"] != item_id:
                conflicts.setdefault(normalized, {existing["itemId"]: existing})[item_id] = current
            else:
                by_name[normalized] = current
    return by_name, conflicts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write reservations and the completed marker; default is dry-run")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--items-table", default="TeamFollowUp-Items")
    parser.add_argument("--archive-table", default="TeamFollowUp-Archive")
    parser.add_argument("--realtime-table", default="TeamFollowUp-Realtime")
    args = parser.parse_args()

    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    work = dynamodb.Table(args.items_table)
    archive = dynamodb.Table(args.archive_table)
    realtime = dynamodb.Table(args.realtime_table)

    work_rows = scan_all(work)
    archive_rows = scan_all(archive)
    reservations, conflicts = collect_reservations(work_rows, archive_rows)

    if conflicts:
        print("Global item-name conflicts must be resolved before enabling the registry:")
        for normalized, rows in sorted(conflicts.items()):
            print(f"  {normalized!r}:")
            for row in rows.values():
                print(f"    {row['itemId']} ({row['type']}, {row['state']}): {row['name']}")
        print(f"Found {len(conflicts)} conflicting normalized name(s); no marker was written.")
        return 2

    # Refuse to overwrite a reservation that belongs to a different item.
    for normalized, row in reservations.items():
        key = {"partitionKey": "ITEM_NAME#" + normalized, "sortKey": "NAME"}
        current = realtime.get_item(Key=key, ConsistentRead=True).get("Item") or {}
        if current and str(current.get("itemId") or "") != row["itemId"]:
            print(
                f"Reservation conflict for {row['name']!r}: "
                f"registry owner={current.get('itemId')}, data owner={row['itemId']}"
            )
            return 2

    print(
        f"Validated {len(work_rows)} active and {len(archive_rows)} archived rows; "
        f"{len(reservations)} unique normalized name(s)."
    )
    if not args.apply:
        print("Dry run only. Pause application writes, resolve conflicts if any, then rerun with --apply.")
        return 0

    reserved_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    written = 0
    for normalized, row in reservations.items():
        key = {"partitionKey": "ITEM_NAME#" + normalized, "sortKey": "NAME"}
        try:
            realtime.put_item(
                Item={
                    **key,
                    "itemId": row["itemId"],
                    "name": row["name"],
                    "normalizedName": normalized,
                    "reservedAt": reserved_at,
                },
                ConditionExpression="attribute_not_exists(#partitionKey) OR #itemId = :itemId",
                ExpressionAttributeNames={"#partitionKey": "partitionKey", "#itemId": "itemId"},
                ExpressionAttributeValues={":itemId": row["itemId"]},
            )
            written += 1
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code == "ConditionalCheckFailedException":
                current = realtime.get_item(Key=key, ConsistentRead=True).get("Item") or {}
                if str(current.get("itemId") or "") == row["itemId"]:
                    continue
            print(f"Failed to reserve {row['name']!r}: {code or type(exc).__name__}")
            return 2

    marker_key = {"partitionKey": "ITEM_NAME_REGISTRY", "sortKey": "VERSION"}
    realtime.put_item(
        Item={
            **marker_key,
            "version": 1,
            "completedAt": reserved_at,
            "reservationCount": len(reservations),
        },
        ConditionExpression="attribute_not_exists(#partitionKey) OR #version = :version",
        ExpressionAttributeNames={"#partitionKey": "partitionKey", "#version": "version"},
        ExpressionAttributeValues={":version": 1},
    )
    print(f"Registry backfill completed. Wrote or verified {len(reservations)} reservations ({written} writes).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
