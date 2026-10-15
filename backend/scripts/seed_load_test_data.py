#!/usr/bin/env python3
"""Seed a removable synthetic workload to test lazy-loading and history popups.

The script is dry-run by default. It writes only when --apply is passed. Each run
uses a unique loadtest-<run-id>- key prefix so the matching run can be removed
without touching ordinary workspace records.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


RUN_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{8}$")
STATUSES = ("not-started", "in-progress", "on-hold", "completed")
PRIORITIES = ("low", "medium", "high", "urgent")


def utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or remove a synthetic DynamoDB load-test workspace."
    )
    parser.add_argument("--region", default=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    parser.add_argument("--items-table", default="TeamFollowUp-Items")
    parser.add_argument("--activity-table", default="TeamFollowUp-Activity")
    parser.add_argument("--users-table", default="TeamFollowUp-Users")
    parser.add_argument("--archive-table", default="TeamFollowUp-Archive")
    parser.add_argument("--projects", type=int, default=4, help="Synthetic Project count (default: 4).")
    parser.add_argument("--jobs", type=int, default=2, help="Synthetic Job count (default: 2).")
    parser.add_argument("--tasks-per-project", type=int, default=10)
    parser.add_argument("--followups-per-task", type=int, default=2)
    parser.add_argument("--direct-followups-per-root", type=int, default=3)
    parser.add_argument("--events-per-item", type=int, default=4)
    parser.add_argument(
        "--cleanup-run-id",
        help="Remove only records belonging to this exact run ID (shown after a seed run).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the requested writes/deletes. Without this switch, the script only reports the plan.",
    )
    args = parser.parse_args()
    for name in (
        "projects",
        "jobs",
        "tasks_per_project",
        "followups_per_task",
        "direct_followups_per_root",
    ):
        if getattr(args, name) < 0:
            parser.error(f"--{name.replace('_', '-')} must be zero or greater.")
    if args.events_per_item < 1:
        parser.error("--events-per-item must be at least 1.")
    if args.projects + args.jobs < 1 and not args.cleanup_run_id:
        parser.error("Create at least one root item, or use --cleanup-run-id.")
    if args.cleanup_run_id and not RUN_ID_RE.fullmatch(args.cleanup_run_id):
        parser.error("--cleanup-run-id must exactly match a run ID printed by this script.")
    return args


def load_handler(args):
    # Reuse the Lambda's canonical index-key conversion helpers. These are pure
    # transformations; AWS writes are performed explicitly below by this script.
    source_dir = Path(__file__).resolve().parents[1] / "src"
    sys.path.insert(0, str(source_dir))
    os.environ["AWS_DEFAULT_REGION"] = args.region
    os.environ["AWS_REGION"] = args.region
    os.environ["ITEMS_TABLE"] = args.items_table
    os.environ["ACTIVITY_TABLE"] = args.activity_table
    os.environ["USERS_TABLE"] = args.users_table
    os.environ["ARCHIVE_TABLE"] = args.archive_table
    import handler  # type: ignore[import-not-found]  # noqa: E402

    return handler


def make_workload(handler, users, run_id, args):
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=30)
    user_ids = [str(user["userId"]) for user in users]
    items = []
    events = []
    item_names = {}
    root_names = {}
    root_types = {}
    item_number = 0
    event_number = 0

    def add_item(item_type, label, root_id, root_name, root_type, parent_id=None):
        nonlocal item_number, event_number
        item_number += 1
        item_id = f"loadtest-{run_id}-{item_type}-{item_number:04d}"
        name = f"[LOAD TEST] {label}"
        creator = user_ids[(item_number - 1) % len(user_ids)]
        created_at = start + timedelta(minutes=5 * (item_number - 1))
        item_span = max(0.0, (now - created_at).total_seconds())
        due_date = (now + timedelta(days=(item_number % 28) + 1)).date().isoformat()
        raw = {
            "id": item_id,
            "type": item_type,
            "name": name,
            "description": (
                f"Synthetic load-test item for run {run_id}. "
                "Remove this run with seed_load_test_data.py --cleanup-run-id."
            ),
            "status": STATUSES[item_number % len(STATUSES)],
            "ownerId": user_ids[(item_number + 1) % len(user_ids)],
            "dueDate": due_date,
            "createdAt": utc_iso(created_at),
            "updatedAt": utc_iso(created_at),
            "createdBy": creator,
            "updatedBy": creator,
            "version": args.events_per_item,
            "rootParentId": root_id or item_id,
        }
        if item_type in ("task", "followup"):
            raw["priority"] = PRIORITIES[item_number % len(PRIORITIES)]
        if parent_id:
            raw["parentId"] = parent_id
        else:
            raw.pop("parentId", None)
        indexed = handler.index_work_item(raw)
        items.append(indexed)
        item_names[item_id] = name
        if item_type in ("project", "job"):
            root_names[item_id] = name
            root_types[item_id] = item_type

        ancestors = []
        if parent_id:
            ancestors.append(parent_id)
        if root_id and root_id != item_id and root_id not in ancestors:
            ancestors.append(root_id)

        latest_at = created_at
        latest_actor = creator
        for event_index in range(args.events_per_item):
            event_number += 1
            actor = user_ids[(item_number + event_index) % len(user_ids)]
            fraction = event_index / max(1, args.events_per_item - 1)
            event_at = created_at + timedelta(seconds=item_span * fraction)
            if event_index == 0:
                action, kind = f"Created {item_type}: {name}", "create"
            elif event_index % 3 == 1:
                action, kind = f"Updated description for {item_type}: {name}.", "update"
            elif event_index % 3 == 2:
                action, kind = "Status changed from Not started to In progress.", "status"
            else:
                action, kind = f"Updated assignee for {item_type}: {name}.", "update"
            event = {
                "id": f"loadtest-{run_id}-event-{event_number:06d}",
                "itemId": item_id,
                "rootParentId": root_id or item_id,
                "rootParentName": root_name or name,
                "rootParentType": root_type or item_type,
                "parentId": parent_id,
                "ancestorIds": ancestors,
                "itemName": name,
                "itemType": item_type,
                "userId": actor,
                "action": action,
                "kind": kind,
                "at": utc_iso(event_at),
            }
            events.append(handler.activity_item(event))
            if event_at >= latest_at:
                latest_at = event_at
                latest_actor = actor
        indexed["updatedAt"] = utc_iso(latest_at)
        indexed["updatedBy"] = latest_actor
        indexed["updatedByUserId"] = latest_actor
        return item_id

    for root_index in range(1, args.projects + 1):
        root_name = f"[LOAD TEST] Project {root_index:02d} — Service rollout"
        root_id = add_item("project", root_name.removeprefix("[LOAD TEST] "), None, "", "")
        for task_index in range(1, args.tasks_per_project + 1):
            task_name = f"Project {root_index:02d} / Task {task_index:02d} — Work package"
            task_id = add_item("task", task_name, root_id, root_names[root_id], root_types[root_id], root_id)
            for followup_index in range(1, args.followups_per_task + 1):
                add_item(
                    "followup",
                    f"Task {task_index:02d} / Follow-up {followup_index:02d} — Check progress",
                    root_id,
                    root_names[root_id],
                    root_types[root_id],
                    task_id,
                )
        for followup_index in range(1, args.direct_followups_per_root + 1):
            add_item(
                "followup",
                f"Project {root_index:02d} / Direct follow-up {followup_index:02d} — Confirm delivery",
                root_id,
                root_names[root_id],
                root_types[root_id],
                root_id,
            )

    for root_index in range(1, args.jobs + 1):
        job_name = f"[LOAD TEST] Job {root_index:02d} — Operational handover"
        root_id = add_item("job", job_name.removeprefix("[LOAD TEST] "), None, "", "")
        for followup_index in range(1, args.direct_followups_per_root + 1):
            add_item(
                "followup",
                f"Job {root_index:02d} / Follow-up {followup_index:02d} — Confirm handover",
                root_id,
                root_names[root_id],
                root_types[root_id],
                root_id,
            )

    return items, events


def scan_all(table):
    rows = []
    response = table.scan()
    rows.extend(response.get("Items", []))
    while response.get("LastEvaluatedKey"):
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        rows.extend(response.get("Items", []))
    return rows


def cleanup(handler, run_id, apply):
    prefix = f"loadtest-{run_id}-"
    work_rows = [row for row in scan_all(handler.WORK) if str(row.get("itemId", "")).startswith(prefix)]
    activity_rows = [row for row in scan_all(handler.ACTIVITY) if str(row.get("itemId", "")).startswith(prefix)]
    archive_rows = [row for row in scan_all(handler.ARCHIVE) if str(row.get("archiveId", "")).startswith(prefix)]
    print(f"Load-test run: {run_id}")
    print(f"Matching active work items: {len(work_rows)}")
    print(f"Matching activity events: {len(activity_rows)}")
    print(f"Matching archived records: {len(archive_rows)}")
    if not apply:
        print("Dry run only. Add --apply to delete exactly these prefixed records.")
        return
    with handler.WORK.batch_writer() as batch:
        for row in work_rows:
            batch.delete_item(Key={"itemId": row["itemId"]})
    with handler.ACTIVITY.batch_writer() as batch:
        for row in activity_rows:
            batch.delete_item(Key={"itemId": row["itemId"], "activityKey": row["activityKey"]})
    with handler.ARCHIVE.batch_writer() as batch:
        for row in archive_rows:
            batch.delete_item(Key={"archiveId": row["archiveId"]})
    print("Cleanup completed for the selected load-test run.")


def main():
    args = parse_args()
    handler = load_handler(args)
    if args.cleanup_run_id:
        cleanup(handler, args.cleanup_run_id, args.apply)
        return

    users = [
        row for row in handler.scan_pages(handler.USERS)
        if row.get("userId") and row.get("enabled", True)
    ]
    if not users:
        raise SystemExit(
            "No enabled team profiles were found in the Users table. Seed the user-profile mappings first."
        )
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    items, events = make_workload(handler, users, run_id, args)
    print(f"Region: {args.region}")
    print(f"Run ID: {run_id}")
    print(f"Root items: {args.projects} Projects + {args.jobs} Jobs")
    print(f"Total work items to create: {len(items)}")
    print(f"Activity events to create: {len(events)}")
    print("All generated item names begin with [LOAD TEST].")
    print("No records will be written without --apply.")
    if not args.apply:
        print("\nDry run only. After reviewing the counts, run the same command with --apply.")
        print("Cleanup command:")
        print(
            f"python backend/scripts/seed_load_test_data.py --region {args.region} "
            f"--cleanup-run-id {run_id} --apply"
        )
        return

    try:
        with handler.WORK.batch_writer(overwrite_by_pkeys=["itemId"]) as batch:
            for item in items:
                batch.put_item(Item=item)
        with handler.ACTIVITY.batch_writer(overwrite_by_pkeys=["itemId", "activityKey"]) as batch:
            for event in events:
                batch.put_item(Item=event)
    except Exception:
        print(
            "\nSeeding may have stopped part-way through. Remove any records already written with:\n"
            f"python backend/scripts/seed_load_test_data.py --region {args.region} "
            f"--cleanup-run-id {run_id} --apply",
            file=sys.stderr,
        )
        raise
    print("Load-test data was written to DynamoDB.")
    print("Open a Project/Job history popup, then application-wide history, and compare loading behavior.")
    print("When finished, remove only this run's records with:")
    print(
        f"python backend/scripts/seed_load_test_data.py --region {args.region} "
        f"--cleanup-run-id {run_id} --apply"
    )


if __name__ == "__main__":
    main()
