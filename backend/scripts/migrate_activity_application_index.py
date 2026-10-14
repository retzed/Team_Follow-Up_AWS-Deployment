#!/usr/bin/env python3
"""Backfill the application-wide activity GSI keys on existing audit events.

Run after GSI_ApplicationTimeline becomes ACTIVE. Requires boto3 credentials with
Scan and UpdateItem permissions on the activity table.
"""
import argparse
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
import boto3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--table', default=os.environ.get('ACTIVITY_TABLE', 'TeamFollowUp-ActivityEvents'))
    parser.add_argument('--region', default=os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION'))
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 32:
        parser.error('--workers must be between 1 and 32')
    kwargs = {'region_name': args.region} if args.region else {}
    table = boto3.resource('dynamodb', **kwargs).Table(args.table)
    scanned = updated = skipped = 0
    executor = ThreadPoolExecutor(max_workers=args.workers)
    try:
        last_key = None
        while True:
            req = {'ConsistentRead': True, 'ProjectionExpression': 'eventId, #at, #appPK, #appSort', 'ExpressionAttributeNames': {'#at': 'at', '#appPK': 'applicationPK', '#appSort': 'applicationSort'}}
            if last_key:
                req['ExclusiveStartKey'] = last_key
            page = table.scan(**req)
            futures = []
            for row in page.get('Items', []):
                scanned += 1
                event_id = str(row.get('eventId') or '')
                if not event_id:
                    skipped += 1
                    continue
                stamp = str(row.get('at') or '1970-01-01T00:00:00.000Z') + '#' + event_id
                if row.get('applicationPK') == 'APPLICATION' and row.get('applicationSort') == stamp:
                    skipped += 1
                    continue
                futures.append(executor.submit(table.update_item, Key={'eventId': event_id},
                    UpdateExpression='SET applicationPK = :pk, applicationSort = :sort',
                    ExpressionAttributeValues={':pk': 'APPLICATION', ':sort': stamp},
                    ConditionExpression='attribute_exists(eventId)'))
            for future in as_completed(futures):
                future.result()
                updated += 1
            print(f'Scanned {scanned} events; indexed {updated}; already indexed/ skipped {skipped}.')
            last_key = page.get('LastEvaluatedKey')
            if not last_key:
                break
    finally:
        executor.shutdown(wait=True)
    print(f'Done. Scanned {scanned} events, indexed {updated}, skipped {skipped}.')


if __name__ == '__main__':
    main()
