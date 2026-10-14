#!/usr/bin/env python3
"""Backfill application-wide timeline keys on existing ActivityEvents rows.

Run after GSI_ApplicationTimeline is ACTIVE. Requires Scan and UpdateItem
permissions on the exact ActivityEvents table. Safe to rerun: correct keys are skipped.
"""
import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3


def application_index_values(row):
    """Return required index keys or None when the row is already indexed."""
    event_id = str(row.get("eventId") or "").strip()
    if not event_id:
        raise ValueError("Activity event is missing its eventId key.")
    timestamp = row.get("at")
    if not isinstance(timestamp, str) or not timestamp.strip():
        raise ValueError(
            f"Activity event {event_id} is missing its timestamp; repair the source record before migrating."
        )
    sort_key = f"{timestamp}#{event_id}"
    if row.get("applicationPK") == "APPLICATION" and row.get("applicationSort") == sort_key:
        return None
    return {"applicationPK": "APPLICATION", "applicationSort": sort_key}


def chunks(items, size):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", required=True, help="Exact ActivityEvents table name from the SAM stack outputs.")
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        help="AWS Region. Defaults to AWS_REGION/AWS_DEFAULT_REGION when set.",
    )
    parser.add_argument("--workers", type=int, default=8, help="Concurrent updates (1-32; default: 8).")
    parser.add_argument("--page-size", type=int, default=100, help="Rows scanned per page (1-500; default: 100).")
    parser.add_argument("--dry-run", action="store_true", help="Count rows to index without modifying DynamoDB.")
    args = parser.parse_args(argv)

    if not args.region:
        parser.error("Pass --region or set AWS_REGION/AWS_DEFAULT_REGION.")
    if not 1 <= args.workers <= 32:
        parser.error("--workers must be between 1 and 32.")
    if not 1 <= args.page_size <= 500:
        parser.error("--page-size must be between 1 and 500.")

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
    scanned = updated = skipped = 0
    last_key = None
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            while True:
                request = {
                    "ConsistentRead": True,
                    "Limit": args.page_size,
                    "ProjectionExpression": "eventId, #at, #appPK, #appSort",
                    "ExpressionAttributeNames": {
                        "#at": "at",
                        "#appPK": "applicationPK",
                        "#appSort": "applicationSort",
                    },
                }
                if last_key:
                    request["ExclusiveStartKey"] = last_key
                page = table.scan(**request)
                updates = []
                for row in page.get("Items", []):
                    scanned += 1
                    values = application_index_values(row)
                    if values is None:
                        skipped += 1
                    else:
                        updates.append((str(row["eventId"]), values))

                if args.dry_run:
                    updated += len(updates)
                else:
                    for batch in chunks(updates, args.page_size):
                        futures = [
                            executor.submit(
                                table.update_item,
                                Key={"eventId": event_id},
                                UpdateExpression="SET applicationPK = :pk, applicationSort = :sort",
                                ExpressionAttributeValues={
                                    ":pk": values["applicationPK"],
                                    ":sort": values["applicationSort"],
                                },
                                ConditionExpression="attribute_exists(eventId)",
                            )
                            for event_id, values in batch
                        ]
                        for future in as_completed(futures):
                            future.result()
                            updated += 1

                verb = "would index" if args.dry_run else "indexed"
                print(f"Scanned {scanned} events; {verb} {updated}; already indexed {skipped}.")
                last_key = page.get("LastEvaluatedKey")
                if not last_key:
                    break
    except Exception as exc:
        print(f"Activity index migration failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    verb = "would be indexed" if args.dry_run else "indexed"
    print(f"Done. Scanned {scanned} events, {verb}: {updated}, already indexed: {skipped}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
