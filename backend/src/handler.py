"""Team Follow-Up API handler.

API Gateway validates the Cognito JWT before this function runs. The handler then
maps the verified Cognito ``sub`` to an enabled team profile and treats that profile
as the source of truth for creator, editor, assignee, and activity actor identity.
"""

import base64
import json
import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import unquote

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
SERIALIZER = TypeSerializer()

# ---------------------------------------------------------------------------
# DynamoDB serialization and atomic writes
# ---------------------------------------------------------------------------
def av_map(item):
    return {str(k): SERIALIZER.serialize(v) for k, v in item.items() if v is not None}


def commit_item_with_events(item, events, condition=None, expected_version=None):
    writes=[{'Put': {'TableName': WORK.name, 'Item': av_map(item)}}]
    if condition == 'create':
        writes[0]['Put']['ConditionExpression']='attribute_not_exists(#itemId)'
        writes[0]['Put']['ExpressionAttributeNames']={'#itemId':'itemId'}
    elif condition == 'version':
        writes[0]['Put']['ConditionExpression']='attribute_not_exists(#version) OR #version = :expected'
        writes[0]['Put']['ExpressionAttributeNames']={'#version':'version'}
        writes[0]['Put']['ExpressionAttributeValues']={':expected':SERIALIZER.serialize(expected_version)}
    for event in events:
        writes.append({'Put': {'TableName': ACTIVITY.name, 'Item': av_map(event), 'ConditionExpression': 'attribute_not_exists(#activityKey)', 'ExpressionAttributeNames': {'#activityKey': 'activityKey'}}})
    ddb.meta.client.transact_write_items(TransactItems=writes)

ddb = boto3.resource('dynamodb')
WORK = ddb.Table(os.environ['ITEMS_TABLE'])
ACTIVITY = ddb.Table(os.environ['ACTIVITY_TABLE'])
USERS = ddb.Table(os.environ['USERS_TABLE'])
ARCHIVE = ddb.Table(os.environ['ARCHIVE_TABLE'])


# ---------------------------------------------------------------------------
# HTTP request/response and identity helpers
# ---------------------------------------------------------------------------
def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def response(status, payload):
    """Build a non-cacheable JSON API response."""
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
        "body": json.dumps(payload, ensure_ascii=False, default=str),
    }



def body_of(event):
    """Decode an API Gateway JSON object without hiding malformed requests."""
    raw = event.get("body") or "{}"
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        parsed = json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else raw
        if not isinstance(parsed, dict):
            return {"__invalid_json_body__": True}
        return parsed
    except (ValueError, UnicodeDecodeError, TypeError):
        return {"__invalid_json_body__": True}



def query(event):
    return event.get("queryStringParameters") or {}
def all_pages(table, **kwargs):
    """Query every DynamoDB page for the supplied key/index request."""
    items=[]
    result=table.query(**kwargs)
    items.extend(result.get('Items',[]))
    while result.get('LastEvaluatedKey'):
        kwargs['ExclusiveStartKey']=result['LastEvaluatedKey']
        result=table.query(**kwargs)
        items.extend(result.get('Items',[]))
    return items
def scan_pages(table, **kwargs):
    """Scan through all pages using DynamoDB continuation keys."""
    items=[]
    result=table.scan(**kwargs)
    items.extend(result.get('Items',[]))
    while result.get('LastEvaluatedKey'):
        kwargs['ExclusiveStartKey']=result['LastEvaluatedKey']
        result=table.scan(**kwargs)
        items.extend(result.get('Items',[]))
    return items


def get_identity(event):
    """Return JWT claims attached by API Gateway's JWT authorizer."""
    try:
        return event['requestContext']['authorizer']['jwt']['claims']
    except Exception:
        return {}
def current_profile(event):
    """Resolve the authenticated Cognito subject against the small existing Users table.

    The manually created TeamFollowUp-Users table has no Cognito-subject GSI.
    Its profile count is deliberately small (six team members), so scan it and
    fail closed if a subject is missing, duplicated, or disabled.
    """
    sub=str(get_identity(event).get('sub') or '').strip()
    if not sub:
        return None
    matches=[row for row in scan_pages(USERS) if str(row.get('cognitoSub') or '').strip()==sub]
    if len(matches)!=1 or not matches[0].get('enabled',True):
        return None
    return matches[0]

# ---------------------------------------------------------------------------
# Work-item and audit-event data contracts
# ---------------------------------------------------------------------------
def index_work_item(x):
    """Materialize only the secondary-index attributes present on TeamFollowUp-Items."""
    x=dict(x)
    item_id=str(x.get('itemId') or x.get('id') or '')
    if not item_id:
        raise ValueError('itemId is required')
    x.pop('id',None)
    x['itemId']=item_id
    x['createdByUserId']=x.get('createdByUserId') or x.get('createdBy') or ''
    x['updatedByUserId']=x.get('updatedByUserId') or x.get('updatedBy') or ''
    x.pop('activityEvents',None)

    # The existing WorkspaceIndex lists top-level Projects/Jobs by createdAt.
    # ParentIdIndex lists children by parentId/createdAt. AssignedToIndex uses
    # assignedTo/updatedAt; ownerId remains the public business-facing field.
    top=x.get('type') in ('project','job')
    if top:
        x.pop('parentId',None)
        x['rootParentId']=item_id
        x['workspaceKey']='WORKSPACE'
    else:
        x.pop('workspaceKey',None)

    owner_id=x.get('ownerId')
    if owner_id:
        x['assignedTo']=str(owner_id)
    else:
        x.pop('assignedTo',None)

    # Drop fields from the previous, un-deployed SAM-only index design.
    for key in ('listPK','updatedSort','createdSort','rootPK','rootUpdatedSort',
                'assigneePK','assigneeUpdatedSort','assigneeCreatedSort'):
        x.pop(key,None)
    return x


def activity_item(e):
    """Return an audit event keyed by the existing Activity table's composite PK."""
    x=dict(e)
    event_id=str(x.get('eventId') or x.get('id') or ('evt_'+uuid.uuid4().hex))
    item_id=str(x.get('itemId') or '')
    if not item_id:
        raise ValueError('Activity event itemId is required.')
    x.pop('id',None)
    x['eventId']=event_id
    x['itemId']=item_id
    x['actorUserId']=x.get('actorUserId') or x.get('userId') or ''
    x['itemNameSnapshot']=x.get('itemNameSnapshot') or x.get('itemName') or ''
    x['itemTypeSnapshot']=x.get('itemTypeSnapshot') or x.get('itemType') or ''
    x.pop('userId',None)
    x.pop('itemName',None)
    x.pop('itemType',None)
    event_at=str(x.get('at') or now())
    x['at']=event_at
    # The current table is keyed by itemId + activityKey, not eventId.
    x['activityKey']=event_at+'#'+event_id
    for key in ('itemPK','itemSort','applicationPK','applicationSort','rootPK',
                'rootSort','parentPK','parentSort'):
        x.pop(key,None)
    return x


def public_item(x):
    y=dict(x)
    y['id']=y.get('itemId')
    y.pop('itemId',None)
    y['createdBy']=y.get('createdByUserId') or y.get('createdBy','')
    y['updatedBy']=y.get('updatedByUserId') or y.get('updatedBy','')
    for k in ('createdByUserId','updatedByUserId','listPK','updatedSort','createdSort','rootPK','rootUpdatedSort','assigneePK','assigneeUpdatedSort','assigneeCreatedSort','workspaceKey','assignedTo','deletedAt'):
        y.pop(k,None)
    return y


def public_archive_item(x):
    y=dict(x)
    item_id=str(y.get('itemId') or y.get('id') or y.get('archiveId') or '')
    # Reuse active-item API field mapping, while retaining archive-specific user-visible metadata.
    z=public_item(y)
    z['id']=item_id
    z['archiveRootId']=y.get('archiveRootId') or y.get('rootParentId') or item_id
    z['archiveRootName']=y.get('archiveRootName') or y.get('name') or ''
    z['archiveRootType']=y.get('archiveRootType') or (y.get('type') if z['archiveRootId']==item_id else '') or ''
    z['archivedAt']=y.get('archivedAt') or y.get('deletedAt') or ''
    z['archivedBy']=y.get('archivedByUserId') or y.get('updatedByUserId') or y.get('updatedBy') or ''
    for k in ('archiveId','archivePK','archiveSort','archiveRootPK','archiveRootSort','archiveParentId','archivedByUserId'):
        z.pop(k,None)
    return z


def make_archive_record(item, archived_at, actor_user_id, row_cache=None):
    raw=dict(item)
    item_id=str(raw.get('itemId') or raw.get('id') or '')
    cache=row_cache if row_cache is not None else {}
    def lookup(record_id):
        record_id=str(record_id or '')
        if not record_id:
            return None
        if record_id not in cache:
            found=WORK.get_item(Key={'itemId':record_id},ConsistentRead=True).get('Item')
            if not found:
                found=ARCHIVE.get_item(Key={'archiveId':record_id},ConsistentRead=True).get('Item')
            cache[record_id]=found or {}
        return cache[record_id] or None
    root_id=item_id if raw.get('type') in ('project','job') else str(raw.get('rootParentId') or raw.get('parentId') or '')
    if root_id==item_id:
        root_name=raw.get('name','')
        root_type=raw.get('type','')
    else:
        root=lookup(root_id)
        root_name=(root or {}).get('name') or (root or {}).get('archiveRootName') or ''
        root_type=(root or {}).get('type') or (root or {}).get('archiveRootType') or ''
    parent_id=str(raw.get('parentId') or '')
    parent_row=lookup(parent_id) if parent_id else None
    parent_name=(parent_row or {}).get('name') or (parent_row or {}).get('archiveParentName') or raw.get('archiveParentName') or ''
    for key in ('id','deletedAt','listPK','updatedSort','createdSort','rootPK','rootUpdatedSort','assigneePK','assigneeUpdatedSort','assigneeCreatedSort','workspaceKey','assignedTo'):
        raw.pop(key,None)
    raw['archiveId']=item_id
    raw['archiveRootId']=root_id
    raw['archiveRootName']=root_name
    raw['archiveRootType']=root_type
    if raw.get('parentId'):
        raw['archiveParentId']=str(raw['parentId'])
        raw['archiveParentName']=parent_name
    raw['archivedAt']=archived_at
    raw['archivedByUserId']=actor_user_id
    raw['archivePK']='ARCHIVE'
    raw['archiveSort']=archived_at+'#'+item_id
    raw['archiveRootPK']='ROOT#'+root_id
    raw['archiveRootSort']=archived_at+'#'+item_id
    return raw


def public_event(x):
    y=dict(x)
    y['id']=y.get('eventId')
    y.pop('eventId',None)
    y['userId']=y.get('actorUserId') or y.get('userId')
    y['itemName']=y.get('itemNameSnapshot') or y.get('itemName')
    y['itemType']=y.get('itemTypeSnapshot') or y.get('itemType')
    for k in ('actorUserId','itemNameSnapshot','itemTypeSnapshot','activityKey',
              'itemPK','itemSort','applicationPK','applicationSort','rootPK',
              'rootSort','parentPK','parentSort'):
        y.pop(k,None)
    return y


# ---------------------------------------------------------------------------
# Server-side business validation# ---------------------------------------------------------------------------
# Server-side business validation and audit construction
# ---------------------------------------------------------------------------
def validate_item(event, item, previous=None):
    """Validate client input and derive trusted identity and index metadata."""
    profile=current_profile(event)
    if not profile:
        raise PermissionError('Authenticated Cognito user is not mapped to an enabled team profile.')
    item=dict(item)
    # Validate untrusted user-editable values before building index keys or writing records.
    name=item.get('name')
    if not isinstance(name,str) or not name.strip():
        raise ValueError('Item name is required.')
    name=name.strip()
    if len(name)>200:
        raise ValueError('Item name cannot exceed 200 characters.')
    item['name']=name
    description=item.get('description') or ''
    if not isinstance(description,str):
        raise ValueError('Description must be text.')
    if len(description)>5000:
        raise ValueError('Description cannot exceed 5000 characters.')
    item['description']=description
    allowed_statuses={'not-started','in-progress','on-hold','completed'}
    item['status']=item.get('status') or 'not-started'
    if item['status'] not in allowed_statuses:
        raise ValueError('Status is not supported.')
    owner_id=item.get('ownerId') or None
    if owner_id is not None:
        owner=USERS.get_item(Key={'userId':str(owner_id)}).get('Item')
        if not owner or not owner.get('enabled',True):
            raise ValueError('Assignee must be an enabled team member.')
        item['ownerId']=str(owner_id)
    else:
        item['ownerId']=None
    due_date=item.get('dueDate')
    if due_date and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(due_date)):
        raise ValueError('Due date must use YYYY-MM-DD format.')
    # Clients may edit business fields, but never control server-owned IDs/timestamps,
    # creator/editor identity, index keys, deletion state, or concurrency versions.
    for field in ('listPK','updatedSort','createdSort','rootPK','rootUpdatedSort','assigneePK',
                  'assigneeUpdatedSort','assigneeCreatedSort','workspaceKey','assignedTo','deletedAt'):
        item.pop(field,None)
    if previous is None:
        item['createdByUserId']=profile['userId']
        item['createdAt']=now()
    else:
        for field in ('createdByUserId','createdAt','itemId','rootParentId'):
            if field in previous:
                item[field]=previous[field]
    item['updatedByUserId']=profile['userId']
    item['updatedAt']=now()
    item['version']=int((previous or {}).get('version',0))+1
    kind=item.get('type')
    parent_id=item.get('parentId')
    item_id=str(item.get('itemId') or '')
    if kind in ('task','followup'):
        item['priority']=item.get('priority') or 'medium'
        if item['priority'] not in {'low','medium','high','urgent'}:
            raise ValueError('Priority is not supported.')
    if kind in ('project','job'):
        if parent_id:
            raise ValueError('Projects and jobs cannot have a parent item.')
        item.pop('parentId',None)
        item['rootParentId']=item_id
        if kind=='job':
            children=query_children_rows(item_id)
            if any(not c.get('deletedAt') and c.get('type')=='task' for c in children):
                raise ValueError('A project containing tasks cannot be changed to a job.')
    elif kind in ('task','followup'):
        if not parent_id:
            raise ValueError('Child items require a parentId.')
        if str(parent_id)==item_id:
            raise ValueError('An item cannot be its own parent.')
        parent=WORK.get_item(Key={'itemId':str(parent_id)}).get('Item')
        if not parent or parent.get('deletedAt'):
            raise ValueError('Parent item does not exist.')
        # Walk the parent chain to reject cycles when editing/moving existing items.
        cursor=parent
        seen=set()
        while cursor:
            cid=str(cursor.get('itemId') or '')
            if cid==item_id:
                raise ValueError('Moving this item would create a hierarchy cycle.')
            if not cid or cid in seen:
                break
            seen.add(cid)
            next_id=cursor.get('parentId')
            cursor=WORK.get_item(Key={'itemId':str(next_id)}).get('Item') if next_id else None
        parent_type=parent.get('type')
        if parent_type=='job' and kind!='followup':
            raise ValueError('Jobs can contain follow-ups only.')
        elif parent_type=='task' and kind!='followup':
            raise ValueError('Tasks can contain follow-ups only.')
        elif parent_type=='project' and kind not in ('task','followup'):
            raise ValueError('Projects can contain tasks and follow-ups only.')
        elif parent_type not in ('project','job','task'):
            raise ValueError('Follow-ups cannot contain child items.')
        item['rootParentId']=parent.get('itemId') if parent_type in ('project','job') else parent.get('rootParentId')
        if previous and previous.get('type')=='task' and kind=='followup':
            nested=query_children_rows(item_id)
            if any(not c.get('deletedAt') for c in nested):
                raise ValueError('A task containing follow-ups cannot be converted to a follow-up.')
    else:
        raise ValueError('Item type must be project, job, task, or followup.')
    return index_work_item(item),profile


def ancestor_ids_for(item):
    ids=[]
    seen=set()
    cursor=item
    while cursor and cursor.get('parentId'):
        parent_id=str(cursor.get('parentId'))
        if parent_id in seen:
            break
        seen.add(parent_id)
        ids.append(parent_id)
        cursor=WORK.get_item(Key={'itemId':parent_id}).get('Item')
    root=item.get('rootParentId')
    if root and root not in ids:
        ids.append(root)
    return list(dict.fromkeys(ids))


def build_audit_events(item, actor, event_kind, supplied_events=None, previous=None, at=None, affected_count=None):
    """Construct audit events from server-validated state; trust supplied IDs only, not action/actor/time."""
    supplied_events=supplied_events or []
    when=at or item.get('updatedAt') or now()
    item_id=str(item.get('itemId') or item.get('id') or '')
    item_type=item.get('type','item')
    item_name=item.get('name','')
    root_id=item.get('rootParentId') or item_id
    parent_id=item.get('parentId')
    if root_id==item_id:
        root_name=item_name
        root_type=item_type
    else:
        root_row=WORK.get_item(Key={'itemId':str(root_id)},ConsistentRead=True).get('Item')
        if not root_row:
            root_row=ARCHIVE.get_item(Key={'archiveId':str(root_id)},ConsistentRead=True).get('Item')
        root_name=(root_row or {}).get('name') or (root_row or {}).get('archiveRootName') or ''
        root_type=(root_row or {}).get('type') or (root_row or {}).get('archiveRootType') or ''
    used=set()
    def event_id_for(kind):
        for raw in supplied_events:
            if raw.get('kind')==kind:
                candidate=str(raw.get('eventId') or raw.get('id') or '')
                if candidate and candidate not in used:
                    used.add(candidate)
                    return candidate
        return 'evt_'+uuid.uuid4().hex
    def make(kind, action, extra=None):
        event_at=when
        event={'eventId':event_id_for(kind),'itemId':item_id,'itemNameSnapshot':item_name,
          'itemTypeSnapshot':item_type,'rootParentId':root_id,'rootParentName':root_name,'rootParentType':root_type,'rootTypeSnapshot':root_type,'parentId':parent_id,
          'ancestorIds':ancestor_ids_for(item),'actorUserId':actor.get('userId',''),
          'action':action,'summary':action,'kind':kind,'at':event_at}
        if extra:
            event.update(extra)
        return activity_item(event)
    if event_kind=='create':
        return [make('create',f'Created {item_type}: {item_name}')]
    if event_kind=='delete':
        count=max(1,int(affected_count or 1))
        descendants=max(0,count-1)
        return [make('delete',f'Deleted {item_type}: {item_name}',{'bulkOperation':'delete-subtree' if descendants else 'delete-item','affectedCount':count,'affectedDescendantCount':descendants})]
    before=public_item(previous or {})
    fields=[('name','name'),('description','description'),('type','type'),('priority','priority'),('ownerId','assignee'),('dueDate','due date')]
    changed=[label for field,label in fields if before.get(field)!=item.get(field)]
    events=[]
    old_status=before.get('status')
    new_status=item.get('status')
    if old_status!=new_status:
        labels={'not-started':'Not started','in-progress':'In progress','on-hold':'On hold','completed':'Completed'}
        events.append(make('status',f'Status changed from {labels.get(old_status,old_status)} to {labels.get(new_status,new_status)}.'))
    if changed:
        events.append(make('update',f'Updated {", ".join(changed)} for {item_type}: {item_name}.'))
    return events

# ---------------------------------------------------------------------------
# Indexed data access for the application views
# ---------------------------------------------------------------------------
def query_children_rows(parent_id, direction='desc'):
    """Query children through the existing ParentIdIndex."""
    rows=all_pages(
        WORK,
        IndexName='ParentIdIndex',
        KeyConditionExpression=Key('parentId').eq(str(parent_id)),
        ScanIndexForward=(direction=='asc'),
    )
    return [row for row in rows if not row.get('deletedAt')]


def query_descendant_rows(root_id):
    """Walk the existing parent index to collect a hierarchy without a root GSI."""
    root_id=str(root_id)
    collected=[]
    visited={root_id}
    queue=[root_id]
    while queue:
        parent_id=queue.pop(0)
        for row in query_children_rows(parent_id):
            item_id=str(row.get('itemId') or '')
            if not item_id or item_id in visited:
                continue
            visited.add(item_id)
            collected.append(row)
            if row.get('type') in ('project','job','task'):
                queue.append(item_id)
    return collected


def query_root_rows(root_id, include_root=True):
    """Return the active hierarchy using GetItem plus ParentIdIndex only."""
    rows=query_descendant_rows(root_id)
    if include_root:
        root=WORK.get_item(Key={'itemId':str(root_id)}).get('Item')
        if root and not root.get('deletedAt'):
            rows.append(root)
    return rows


def query_archived_history_rows(root_id=None, parent_id=None):
    """Return archived records needed to find old events when a history popup opens.

    Archive has only its archivePK GSI in the configured table contract, so this
    reads that partition on demand and filters by the root or direct parent.
    It is deliberately not part of workspace bootstrap or ordinary item queries.
    """
    if root_id is None and parent_id is None:
        return []
    rows=all_pages(
        ARCHIVE,
        IndexName='GSI_ArchiveIndex',
        KeyConditionExpression=Key('archivePK').eq('ARCHIVE'),
        ScanIndexForward=False,
    )
    if root_id is not None:
        wanted=str(root_id)
        return [row for row in rows if str(row.get('archiveRootId') or row.get('rootParentId') or row.get('itemId') or '')==wanted]
    wanted=str(parent_id)
    return [row for row in rows if str(row.get('archiveParentId') or row.get('parentId') or '')==wanted]


def query_events_for_item(item_id):
    """Read one item's audit timeline from Activity's actual composite primary key."""
    return all_pages(
        ACTIVITY,
        KeyConditionExpression=Key('itemId').eq(str(item_id)),
        ScanIndexForward=False,
    )


def query_events_for_items(item_ids):
    """Merge item-specific timelines and de-duplicate by public event ID."""
    rows=[]
    seen_items=set()
    for item_id in item_ids:
        item_id=str(item_id)
        if not item_id or item_id in seen_items:
            continue
        seen_items.add(item_id)
        rows.extend(query_events_for_item(item_id))
    unique={str(row.get('eventId') or row.get('activityKey')):row for row in rows}
    return sorted(unique.values(),key=lambda row:(str(row.get('at') or ''),str(row.get('eventId') or '')),reverse=True)


def query_work_items(qs):
    direction='asc' if qs.get('direction')=='asc' else 'desc'
    date_field='updatedAt' if qs.get('dateMode','updated')=='updated' else 'createdAt'
    if qs.get('scope')=='top-level':
        rows=all_pages(
            WORK,
            IndexName='WorkspaceIndex',
            KeyConditionExpression=Key('workspaceKey').eq('WORKSPACE'),
        )
    elif qs.get('parentId'):
        rows=query_children_rows(qs['parentId'],direction)
    elif qs.get('rootParentId'):
        rows=query_root_rows(qs['rootParentId'],include_root=True)
    elif qs.get('assigneeUserId'):
        rows=all_pages(
            WORK,
            IndexName='AssignedToIndex',
            KeyConditionExpression=Key('assignedTo').eq(str(qs['assigneeUserId'])),
        )
    else:
        raise ValueError('Choose a supported work-item query.')

    rows=[row for row in rows if not row.get('deletedAt')]
    for key in ('type','priority'):
        value=qs.get(key)
        if value and value!='all':
            rows=[row for row in rows if row.get(key)==value]
    status=qs.get('status')
    if status and status!='all':
        rows=[row for row in rows if (row.get('status')!='completed' if status=='not-completed' else row.get('status')==status)]
    search=str(qs.get('q') or '').lower()
    if search:
        rows=[row for row in rows if search in str(row.get('name','')).lower() or search in str(row.get('description','')).lower()]
    start=qs.get('from')
    end=qs.get('to')
    if start:
        rows=[row for row in rows if str(row.get(date_field,''))[:10]>=start]
    if end:
        rows=[row for row in rows if str(row.get(date_field,''))[:10]<=end]
    rows.sort(key=lambda row:(str(row.get(date_field) or ''),str(row.get('itemId') or '')),reverse=(direction!='asc'))
    offset=max(0,int(qs.get('offset',0)))
    limit=max(1,min(250,int(qs.get('limit',100))))
    total=len(rows)
    return {'items':[public_item(row) for row in rows[offset:offset+limit]],'count':total,'nextOffset':offset+limit if offset+limit<total else None}



def query_work_items_all(qs):
    combined=[]
    offset=0
    while True:
        page=query_work_items({**qs,'limit':'250','offset':str(offset)})
        combined.extend(page['items'])
        if page.get('nextOffset') is None:
            break
        offset=page['nextOffset']
    return combined


def cache_version(rows):
    """Stable validator for persisted browser-side copies of table-backed data."""
    tokens=[]
    for row in rows or []:
        tokens.append({
            'id': row.get('id') or row.get('itemId') or row.get('eventId') or row.get('userId') or '',
            'updatedAt': row.get('updatedAt') or row.get('at') or row.get('archivedAt') or row.get('createdAt') or '',
            'version': row.get('version'),
            'deletedAt': row.get('deletedAt') or '',
            'activityKey': row.get('activityKey') or '',
            'name': row.get('name') or row.get('displayName') or '',
            'role': row.get('role') or '',
            'status': row.get('status') or '',
        })
    tokens.sort(key=lambda value: json.dumps(value,sort_keys=True,default=str))
    serialized=json.dumps(tokens,sort_keys=True,separators=(',',':'),default=str).encode('utf-8')
    return hashlib.sha256(serialized).hexdigest()


# ---------------------------------------------------------------------------
# API Gateway HTTP API entry point
# ---------------------------------------------------------------------------
def restore_root_completion_positions(ordered, selected_roots, selected_under):
    """Return the last ordered-item position belonging to each restore summary root.

    Restore writes are chunked. A root summary can be committed with the same
    transaction as the final selected item beneath that root.
    """
    positions = {}
    for root in selected_roots:
        root_id = str(root.get("itemId") or "")
        matching = [
            index for index, row in enumerate(ordered)
            if selected_under(row, root_id)
        ]
        if matching:
            positions[root_id] = max(matching)
    return positions


PROFILE_PRIVILEGES = {"Administrator", "Editor", "User"}
PROFILE_ICONS = {"user", "compass", "terminal", "shield", "briefcase", "wrench", "settings", "cpu", "clipboard", "search", "code", "database", "monitor", "rocket", "hard-hat", "crown", "badge-check", "cowboy-hat", "layers", "sparkles", "target", "graduation-cap"}
PROFILE_PREFERENCE_LANGS = {"en", "ar"}
PROFILE_PREFERENCE_THEMES = {"light", "dark"}


def public_team_user(row, include_private=False):
    """Shape a team profile for the browser without exposing private fields to the team list."""
    result = {
        "id": str(row.get("userId") or ""),
        "name": str(row.get("displayName") or ""),
        "nameArabic": str(row.get("displayNameArabic") or ""),
        "role": str(row.get("role") or "Team member"),
        "roleArabic": str(row.get("roleArabic") or ""),
        "icon": str(row.get("icon") or "user"),
        "privilege": str(row.get("privilege") or ("Administrator" if str(row.get("userId") or "") in {"u1", "root"} else "User")),
        "enabled": row.get("enabled", True) is not False,
    }
    if include_private:
        result.update({
            "phoneNumber": str(row.get("phoneNumber") or ""),
            "email": str(row.get("email") or ""),
            "preferences": row.get("preferences") if isinstance(row.get("preferences"), dict) else {},
            "pinnedItemIds": list(dict.fromkeys(str(value) for value in row.get("pinnedItemIds", []) if isinstance(value, (str, int)))) if isinstance(row.get("pinnedItemIds"), list) else [],
        })
    return result


def is_privilege_manager(profile):
    user_id = str(profile.get("userId") or "")
    return user_id == "root" or profile.get("privilege") == "Administrator" or (user_id == "u1" and not profile.get("privilege"))


def profile_audit_event(actor, target, action, at=None):
    """Build an append-only app-wide event for a profile field change."""
    target_id = str(target.get("userId") or "")
    target_name = str(target.get("displayName") or target_id or "User")
    return activity_item({
        "eventId": "evt_profile_" + uuid.uuid4().hex,
        "itemId": "PROFILE#" + target_id,
        "actorUserId": str(actor.get("userId") or ""),
        "itemNameSnapshot": target_name,
        "itemTypeSnapshot": "profile",
        "rootParentId": "USER_PROFILES",
        "rootParentName": "User profiles",
        "rootParentType": "profile",
        "action": action,
        "kind": "profile",
        "at": at or now(),
    })


def normalize_profile_updates(body, actor, target):
    """Validate editable profile fields. Authentication identity/passwords are not editable here."""
    if not isinstance(body, dict) or not body:
        raise ValueError("Provide at least one profile field to update.")
    if str(target.get("userId") or "") == "root":
        raise PermissionError("The root profile is database-managed and cannot be edited in the application.")
    allowed = {"name", "nameArabic", "phoneNumber", "email", "icon", "role", "roleArabic", "preferences", "privilege"}
    unknown = set(body) - allowed
    if unknown:
        raise ValueError("Unsupported profile field: " + sorted(unknown)[0])
    if "privilege" in body and not is_privilege_manager(actor):
        raise PermissionError("Only an Administrator or root can change user privileges.")
    normalized = {}
    if "name" in body:
        value = body["name"]
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 100:
            raise ValueError("Name must contain 1-100 characters.")
        normalized["displayName"] = value.strip()
    if "nameArabic" in body:
        value = body["nameArabic"]
        if not isinstance(value, str) or len(value.strip()) > 100:
            raise ValueError("Arabic display name must contain at most 100 characters.")
        normalized["displayNameArabic"] = value.strip()
    if "phoneNumber" in body:
        value = body["phoneNumber"]
        if not isinstance(value, str) or len(value.strip()) > 40:
            raise ValueError("Phone number must be text with at most 40 characters.")
        normalized["phoneNumber"] = value.strip()
    if "email" in body:
        value = body["email"]
        candidate = value.strip() if isinstance(value, str) else None
        if candidate is None or len(candidate) > 254 or (candidate and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", candidate)):
            raise ValueError("Enter a valid e-mail address.")
        normalized["email"] = candidate
    if "icon" in body:
        value = body["icon"]
        if not isinstance(value, str) or value not in PROFILE_ICONS:
            raise ValueError("Select a supported profile icon.")
        normalized["icon"] = value
    if "role" in body:
        value = body["role"]
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80:
            raise ValueError("Label must contain 1-80 characters.")
        normalized["role"] = value.strip()
    if "roleArabic" in body:
        value = body["roleArabic"]
        if not isinstance(value, str) or len(value.strip()) > 80:
            raise ValueError("Arabic label must contain at most 80 characters.")
        normalized["roleArabic"] = value.strip()
    if "privilege" in body:
        value = body["privilege"]
        if not isinstance(value, str) or value not in PROFILE_PRIVILEGES:
            raise ValueError("Privilege must be Administrator, Editor, or User.")
        normalized["privilege"] = value
    if "preferences" in body:
        value = body["preferences"]
        if not isinstance(value, dict) or set(value) - {"lang", "theme"}:
            raise ValueError("Preferences may contain only language and theme.")
        preferences = dict(target.get("preferences") or {})
        if "lang" in value:
            if value["lang"] not in PROFILE_PREFERENCE_LANGS:
                raise ValueError("Language must be en or ar.")
            preferences["lang"] = value["lang"]
        if "theme" in value:
            if value["theme"] not in PROFILE_PREFERENCE_THEMES:
                raise ValueError("Theme must be light or dark.")
            preferences["theme"] = value["theme"]
        normalized["preferences"] = preferences
    if not normalized:
        raise ValueError("No editable profile fields were supplied.")
    return normalized


def commit_profile_update(actor, target, normalized):
    """Atomically update a profile and append an audit event for each required field change."""
    old = dict(target)
    changed_target = {**old, **normalized}
    action_by_field = (
        ("displayName", "Updated profile name"),
        ("displayNameArabic", "Updated Arabic profile name"),
        ("phoneNumber", "Updated profile phone number"),
        ("email", "Updated profile e-mail"),
        ("role", "Updated profile label"),
        ("roleArabic", "Updated Arabic profile label"),
        ("privilege", "Updated user privilege"),
    )
    events = [
        profile_audit_event(actor, changed_target, action)
        for field, action in action_by_field
        if field in normalized and old.get(field, "") != normalized[field]
    ]
    names = {"#userId": "userId", "#profileVersion": "profileVersion"}
    values = {":versionIncrement": SERIALIZER.serialize(1), ":zero": SERIALIZER.serialize(0)}
    clauses = ["#profileVersion = if_not_exists(#profileVersion, :zero) + :versionIncrement"]
    for index, (field, value) in enumerate(normalized.items()):
        alias = "#field" + str(index)
        token = ":value" + str(index)
        names[alias] = field
        values[token] = SERIALIZER.serialize(value)
        clauses.append(alias + " = " + token)
    writes = [{
        "Update": {
            "TableName": USERS.name,
            "Key": av_map({"userId": str(target["userId"])}),
            "UpdateExpression": "SET " + ", ".join(clauses),
            "ExpressionAttributeNames": names,
            "ExpressionAttributeValues": values,
            "ConditionExpression": "attribute_exists(#userId)",
        }
    }]
    for event in events:
        writes.append({
            "Put": {
                "TableName": ACTIVITY.name,
                "Item": av_map(event),
                "ConditionExpression": "attribute_not_exists(#activityKey)",
                "ExpressionAttributeNames": {"#activityKey": "activityKey"},
            }
        })
    ddb.meta.client.transact_write_items(TransactItems=writes)
    updated = USERS.get_item(Key={"userId": str(target["userId"])}, ConsistentRead=True).get("Item") or changed_target
    return public_team_user(updated, include_private=True), [public_event(event) for event in events]


def lambda_handler(event, context):
    """Handle API Gateway HTTP API requests."""
    request_id = getattr(context, "aws_request_id", None) or event.get("requestContext", {}).get("requestId", "unknown")
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    ).upper()
    path = unquote(event.get("rawPath") or event.get("path") or "/")
    qs = query(event)
    body = body_of(event)
    claims = get_identity(event)
    if body.get("__invalid_json_body__"):
        return response(400, {"message": "Request body must be a valid JSON object."})
    try:
        logger.info(
            "request_started",
            extra={"requestId": request_id, "method": method, "path": path},
        )
        if not claims.get('sub'):
            return response(401,{'message':'Unauthorized'})
        profile=current_profile(event)
        if not profile:
            return response(403,{'message':'Cognito identity is not mapped to an enabled team profile.'})
        if method=='GET' and path=='/bootstrap':
            # Keep startup lightweight: return only top-level Projects/Jobs and team
            # profiles. Descendant items and Activity history are fetched on demand.
            parents=query_work_items_all({'scope':'top-level','dateMode':'updated','direction':'desc'})
            user_rows=scan_pages(USERS)
            users=[public_team_user(u) for u in user_rows if u.get('enabled',True)]
            return response(200,{'items':parents,'users':users})
        if method=='GET' and path=='/users/me':
            return response(200, {'user': public_team_user(profile, include_private=True)})
        if method=='PATCH' and path=='/users/me':
            updates = normalize_profile_updates(body, profile, profile)
            user, events = commit_profile_update(profile, profile, updates)
            return response(200, {'user': user, 'activityEvents': events})
        if method=='PATCH' and path=='/users/me/pins':
            if str(profile.get('userId') or '') == 'root':
                raise PermissionError('The root profile is database-managed and cannot be edited in the application.')
            ids = body.get('itemIds')
            if not isinstance(ids, list) or len(ids) > 500:
                raise ValueError('Pinned item IDs must be a list containing at most 500 items.')
            pinned = list(dict.fromkeys(str(value).strip() for value in ids if isinstance(value, (str, int)) and str(value).strip()))
            for item_id in pinned:
                row = WORK.get_item(Key={'itemId': item_id}).get('Item')
                if not row or row.get('deletedAt'):
                    raise ValueError('A pinned item no longer exists. Refresh the pinned list and try again.')
            USERS.update_item(
                Key={'userId': str(profile['userId'])},
                UpdateExpression='SET #pins = :pins, #profileVersion = if_not_exists(#profileVersion, :zero) + :one',
                ExpressionAttributeNames={'#pins':'pinnedItemIds','#profileVersion':'profileVersion'},
                ExpressionAttributeValues={':pins':pinned,':zero':0,':one':1},
                ConditionExpression='attribute_exists(userId)',
            )
            latest = USERS.get_item(Key={'userId': str(profile['userId'])}, ConsistentRead=True).get('Item') or profile
            return response(200, {'user': public_team_user(latest, include_private=True)})
        if method=='PATCH' and path.startswith('/users/'):
            target_id = path.rsplit('/', 1)[-1]
            if not target_id or target_id == 'me':
                return response(404, {'message':'User profile not found.'})
            if not is_privilege_manager(profile):
                raise PermissionError('Only an Administrator or root can change user privileges.')
            if target_id == 'root':
                raise PermissionError('The root profile is database-managed and cannot be edited in the application.')
            target = USERS.get_item(Key={'userId': target_id}, ConsistentRead=True).get('Item')
            if not target or target.get('enabled', True) is False:
                return response(404, {'message':'User profile not found.'})
            if set(body) != {'privilege'}:
                raise ValueError('This route only allows changing another user\'s privilege.')
            updates = normalize_profile_updates(body, profile, target)
            user, events = commit_profile_update(profile, target, updates)
            return response(200, {'user': user, 'activityEvents': events})
        if method=='GET' and path=='/users':
            rows=scan_pages(USERS)
            users=[public_team_user(u) for u in rows if u.get('enabled',True)]
            version=cache_version(users)
            if qs.get('cacheMode')=='1' and qs.get('cacheVersion')==version:
                return response(200,{'notModified':True,'version':version})
            payload={'users':users}
            if qs.get('cacheMode')=='1':
                payload['version']=version
            return response(200,payload)
        if path=='/archive' and method=='GET':
            rows=all_pages(ARCHIVE,IndexName='GSI_ArchiveIndex',KeyConditionExpression=Key('archivePK').eq('ARCHIVE'),ScanIndexForward=False)
            item_type=qs.get('type','all')
            root_id=qs.get('rootParentId')
            search=qs.get('q','').lower()
            if item_type!='all':
                rows=[x for x in rows if x.get('type')==item_type]
            if root_id:
                rows=[x for x in rows if str(x.get('archiveRootId') or x.get('rootParentId') or x.get('itemId'))==root_id]
            if search:
                rows=[x for x in rows if search in json.dumps(x,ensure_ascii=False).lower()]
            offset=max(0,int(qs.get('offset',0)))
            limit=max(1,min(500,int(qs.get('limit',250))))
            total=len(rows)
            public_rows=[public_archive_item(x) for x in rows]
            version=cache_version(public_rows)
            if qs.get('cacheMode')=='1' and qs.get('cacheVersion')==version:
                return response(200,{'notModified':True,'version':version})
            payload={'items':public_rows[offset:offset+limit],'count':total,'nextOffset':offset+limit if offset+limit<total else None}
            if qs.get('cacheMode')=='1':
                payload['version']=version
            return response(200,payload)
        if path=='/archive/restore' and method=='POST':
            ids=body.get('itemIds')
            if not isinstance(ids,list) or not ids:
                raise ValueError('Select at least one archived item to restore.')
            ids=list(dict.fromkeys(str(x) for x in ids))
            if len(ids)>500:
                raise ValueError('Restore at most 500 items at a time.')
            archived=[]
            for item_id in ids:
                row=ARCHIVE.get_item(Key={'archiveId':item_id},ConsistentRead=True).get('Item')
                if not row:
                    raise ValueError('One or more selected archive items are no longer available. Refresh the archive and try again.')
                archived.append(row)
            selected={str(x.get('itemId')):x for x in archived}
            active_cache={}
            def active_parent(parent_id):
                if parent_id not in active_cache:
                    active_cache[parent_id]=WORK.get_item(Key={'itemId':parent_id},ConsistentRead=True).get('Item')
                row=active_cache[parent_id]
                return row if row and not row.get('deletedAt') else None
            for row in archived:
                parent_id=str(row.get('parentId') or '')
                if not parent_id:
                    continue
                parent=selected.get(parent_id) or active_parent(parent_id)
                if not parent:
                    raise ValueError(f'Restore the parent item together with "{row.get("name",row.get("itemId"))}", or restore the parent first.')
                if parent.get('type')=='job' and row.get('type')!='followup':
                    raise ValueError('Jobs can contain follow-ups only.')
                if parent.get('type')=='task' and row.get('type')!='followup':
                    raise ValueError('Tasks can contain follow-ups only.')
                if parent.get('type')=='project' and row.get('type') not in ('task','followup'):
                    raise ValueError('Projects can contain tasks and follow-ups only.')
            def restore_depth(row):
                depth=0
                parent_id=str(row.get('parentId') or '')
                seen=set()
                while parent_id in selected and parent_id not in seen:
                    seen.add(parent_id)
                    depth+=1
                    parent_id=str(selected[parent_id].get('parentId') or '')
                return depth
            ordered=sorted(archived,key=lambda x:(restore_depth(x),str(x.get('name',''))))
            selected_roots=[row for row in ordered if str(row.get('parentId') or '') not in selected]
            def selected_under(row, root_id):
                cursor=row
                seen=set()
                while cursor:
                    current_id=str(cursor.get('itemId') or '')
                    if current_id==str(root_id):
                        return True
                    if not current_id or current_id in seen:
                        break
                    seen.add(current_id)
                    cursor=selected.get(str(cursor.get('parentId') or ''))
                return False
            root_last_position=restore_root_completion_positions(ordered,selected_roots,selected_under)
            completed_root_ids=set()
            actor_id=profile['userId']
            at=now()
            restored_ids=[]
            restored_items=[]
            all_events=[]
            def summary_event(root_row, included_ids):
                root_item_id=str(root_row.get('itemId') or '')
                group=[row for row in ordered if str(row.get('itemId') or '') in included_ids and selected_under(row,root_item_id)]
                if not group:
                    return None
                desc_count=max(0,len(group)-1)
                item_type=str(root_row.get('type') or 'item')
                item_name=str(root_row.get('name') or '')
                root_id=str(root_row.get('rootParentId') or (root_item_id if item_type in ('project','job') else ''))
                root_record=selected.get(root_id) or active_parent(root_id) or {}
                root_name=str((root_record or {}).get('name') or root_row.get('archiveRootName') or (item_name if root_id==root_item_id else ''))
                root_type=str((root_record or {}).get('type') or root_row.get('archiveRootType') or (item_type if root_id==root_item_id else ''))
                ancestors=[]
                parent_id=str(root_row.get('parentId') or '')
                if parent_id:
                    ancestors.append(parent_id)
                if root_id and root_id not in ancestors:
                    ancestors.append(root_id)
                action=f'Restored {item_type}: {item_name}'
                return activity_item({'eventId':'evt_restore_'+uuid.uuid4().hex,'itemId':root_item_id,
                    'itemNameSnapshot':item_name,'itemTypeSnapshot':item_type,'rootParentId':root_id or root_item_id,
                    'rootParentName':root_name,'rootParentType':root_type,'rootTypeSnapshot':root_type,'parentId':parent_id or None,'ancestorIds':ancestors,
                    'actorUserId':actor_id,'action':action,'summary':action,'kind':'restore','at':at,
                    'bulkOperation':'restore-subtree' if desc_count else 'restore-item','affectedCount':len(group),
                    'affectedDescendantCount':desc_count})
            # Each item needs two actions (restore + archive delete). A root summary
            # is included with the chunk containing that root's last selected item.
            # With 30 items per chunk, each transaction uses at most 60 item actions
            # plus 30 summary-event actions, below DynamoDB's 100-action limit.
            chunk_size=30
            for start in range(0,len(ordered),chunk_size):
                chunk=ordered[start:start+chunk_size]
                writes=[]
                prepared=[]
                for archived_item in chunk:
                    item=dict(archived_item)
                    item_id=str(item['itemId'])
                    for key in ('archiveId','archiveRootId','archiveRootName','archiveRootType','archiveParentId','archiveParentName','archivedAt','archivedByUserId','archivePK','archiveSort','archiveRootPK','archiveRootSort','deletedAt'):
                        item.pop(key,None)
                    item['updatedAt']=at
                    item['updatedByUserId']=actor_id
                    item['version']=int(item.get('version',0))+1
                    item=index_work_item(item)
                    writes.extend([
                      {'Put':{'TableName':WORK.name,'Item':av_map(item),'ConditionExpression':'attribute_not_exists(#itemId)','ExpressionAttributeNames':{'#itemId':'itemId'}}},
                      {'Delete':{'TableName':ARCHIVE.name,'Key':av_map({'archiveId':item_id}),'ConditionExpression':'attribute_exists(#archiveId)','ExpressionAttributeNames':{'#archiveId':'archiveId'}}}
                    ])
                    prepared.append(item)
                chunk_end=start+len(chunk)
                included=set(restored_ids)
                included.update(str(x['itemId']) for x in prepared)
                chunk_events=[]
                chunk_root_ids=[]
                for root in selected_roots:
                    root_id=str(root.get('itemId') or '')
                    last_position=root_last_position.get(root_id)
                    if last_position is not None and start <= last_position < chunk_end:
                        audit_event=summary_event(root,included)
                        if audit_event is not None:
                            chunk_events.append(audit_event)
                            chunk_root_ids.append(root_id)
                for audit_event in chunk_events:
                    writes.append({'Put':{'TableName':ACTIVITY.name,'Item':av_map(audit_event),'ConditionExpression':'attribute_not_exists(#activityKey)','ExpressionAttributeNames':{'#activityKey':'activityKey'}}})
                try:
                    ddb.meta.client.transact_write_items(TransactItems=writes)
                except ClientError:
                    # This route is chunked for large restores. If a later chunk fails, emit one summary
                    # per successfully restored selection root, reflecting only items actually restored.
                    if restored_ids:
                        included=set(restored_ids)
                        partial=[]
                        for root in selected_roots:
                            root_id=str(root.get('itemId') or '')
                            if root_id in completed_root_ids:
                                continue
                            event=summary_event(root,included)
                            if event:
                                partial.append(event)
                        if partial:
                            with ACTIVITY.batch_writer() as batch:
                                for event in partial:
                                    batch.put_item(Item=event)
                            all_events.extend(public_event(e) for e in partial)
                    return response(409,{'message':'Some items may already have been restored. Refresh Archive to see the remaining items and retry.','restoredIds':restored_ids,'restoredItems':restored_items,'activityEvents':all_events})
                restored_ids.extend(str(x['itemId']) for x in prepared)
                restored_items.extend(public_item(x) for x in prepared)
                completed_root_ids.update(chunk_root_ids)
                all_events.extend(public_event(e) for e in chunk_events)
            return response(200,{'ok':True,'restoredIds':restored_ids,'restoredItems':restored_items,'activityEvents':all_events})
        if path=='/items/resolve' and method=='GET':
            requested = list(dict.fromkeys(value.strip() for value in str(qs.get('ids') or '').split(',') if value.strip()))
            if len(requested) > 100:
                raise ValueError('Resolve at most 100 item IDs at a time.')
            rows = []
            for item_id in requested:
                row = WORK.get_item(Key={'itemId': item_id}).get('Item')
                if row and not row.get('deletedAt'):
                    rows.append(public_item(row))
            return response(200, {'items': rows, 'count': len(rows)})
        if path=='/items' and method=='GET':
            # Cache-aware clients ask for a compact validator before re-downloading
            # the current collection. The returned version is based on the complete
            # filtered collection, not just the current page.
            if qs.get('cacheMode')=='1' and (qs.get('scope')=='top-level' or qs.get('rootParentId')):
                items=query_work_items_all(qs)
                version=cache_version(items)
                if qs.get('cacheVersion')==version:
                    return response(200,{'notModified':True,'version':version})
                if qs.get('scope')=='top-level' or 'limit' in qs or 'offset' in qs:
                    offset=max(0,int(qs.get('offset',0)))
                    limit=max(1,min(250,int(qs.get('limit',100))))
                    total=len(items)
                    return response(200,{'items':items[offset:offset+limit],'count':total,'nextOffset':offset+limit if offset+limit<total else None,'version':version})
                return response(200,{'items':items,'count':len(items),'nextOffset':None,'version':version})
            result=query_work_items(qs)
            return response(200,result)
        if path=='/items/assigned-to-me' and method=='GET':
            filtered={**qs,'assigneeUserId':profile['userId']}
            if qs.get('cacheMode')=='1':
                version=cache_version(query_work_items_all(filtered))
                if qs.get('cacheVersion')==version:
                    return response(200,{'notModified':True,'version':version})
                result=query_work_items(filtered);result['version']=version
                return response(200,result)
            return response(200,query_work_items(filtered))
        m=re.fullmatch(r'/items/([^/]+)/children',path)
        if m and method=='GET':
            filtered={**qs,'parentId':m.group(1)}
            if qs.get('cacheMode')=='1':
                version=cache_version(query_work_items_all(filtered))
                if qs.get('cacheVersion')==version:
                    return response(200,{'notModified':True,'version':version})
                result=query_work_items(filtered);result['version']=version
                return response(200,result)
            return response(200,query_work_items(filtered))
        m=re.fullmatch(r'/items/([^/]+)/activity',path)
        if m and method=='GET':
            item_id=m.group(1)
            item=WORK.get_item(Key={'itemId':item_id}).get('Item')
            if not item or item.get('deletedAt'):
                return response(404,{'message':'Item not found'})
            scope=qs.get('scope','item')
            if scope=='all' and item.get('type') in ('project','job'):
                rows=query_root_rows(item_id,include_root=True)
                item_ids=[str(row.get('itemId') or '') for row in rows]
                archived_rows=query_archived_history_rows(root_id=item_id)
                item_ids.extend(str(row.get('itemId') or row.get('archiveId') or '') for row in archived_rows)
            elif scope=='all' and item.get('type')=='task':
                rows=[item]+query_children_rows(item_id)
                item_ids=[str(row.get('itemId') or '') for row in rows]
                archived_rows=query_archived_history_rows(parent_id=item_id)
                item_ids.extend(str(row.get('itemId') or row.get('archiveId') or '') for row in archived_rows)
            else:
                item_ids=[item_id]
            item_ids=list(dict.fromkeys(value for value in item_ids if value))
            events=query_events_for_items(item_ids)
            search=str(qs.get('q') or '').lower()
            if search:
                events=[row for row in events if search in json.dumps(row,ensure_ascii=False,default=str).lower()]
            public_events=[public_event(row) for row in events]
            version=cache_version(public_events)
            if qs.get('cacheMode')=='1' and qs.get('cacheVersion')==version:
                return response(200,{'notModified':True,'version':version})
            payload={'events':public_events,'count':len(public_events)}
            if qs.get('cacheMode')=='1':
                payload['version']=version
            return response(200,payload)
        if path=='/items' and method=='POST':
            item=dict(body)
            events=item.pop('activityEvents',[]) or []
            item['itemId']=item.get('id') or item.get('itemId') or 'itm_'+uuid.uuid4().hex
            clean,actor=validate_item(event,item)
            normalized_events=build_audit_events(clean,profile,'create',events,at=clean.get('createdAt'))
            commit_item_with_events(clean,normalized_events,condition='create')
            return response(201,{'item':public_item(clean),'activityEvents':[public_event(e) for e in normalized_events]})
        m=re.fullmatch(r'/items/([^/]+)',path)
        if m and method=='PATCH':
            item_id=m.group(1)
            old=WORK.get_item(Key={'itemId':item_id}).get('Item')
            if not old or old.get('deletedAt'):
                return response(404,{'message':'Item not found'})
            update_body=dict(body)
            events=update_body.pop('activityEvents',[]) or []
            updated={**public_item(old),**update_body,'id':item_id,'itemId':item_id}
            updated.pop('version',None)
            clean,actor=validate_item(event,updated,old)
            expected=int(old.get('version',0))
            normalized_events=build_audit_events(clean,profile,'update',events,previous=old,at=clean.get('updatedAt'))
            try:
                commit_item_with_events(clean,normalized_events,condition='version',expected_version=expected)
            except ClientError as e:
                if e.response['Error']['Code']=='ConditionalCheckFailedException' or e.response.get('Error',{}).get('Code')=='TransactionCanceledException':
                    return response(409,{'message':'This item changed after you opened it. Refresh before saving.'})
                raise
            return response(200,{'item':public_item(clean),'activityEvents':[public_event(e) for e in normalized_events]})
        if m and method=='DELETE':
            item_id=m.group(1)
            old=WORK.get_item(Key={'itemId':item_id},ConsistentRead=True).get('Item')
            if not old or old.get('deletedAt'):
                return response(404,{'message':'Item not found'})
            supplied=body.get('activityEvents',[]) or []
            archived_at=now()
            actor_id=profile['userId']
            # Use the narrowest index needed for the requested subtree. A follow-up is a leaf,
            # so deleting one requires no hierarchy query. A task can contain only follow-ups,
            # which are read via its parent partition. A project/job uses one root-index query.
            item_type=str(old.get('type') or '')
            root_id=item_id if item_type in ('project','job') else str(old.get('rootParentId') or item_id)
            if item_type in ('project','job'):
                candidate_rows=query_descendant_rows(root_id)
            elif item_type=='task':
                candidate_rows=query_children_rows(item_id)
            else:
                candidate_rows=[]
            candidates={str(row.get('itemId')):row for row in candidate_rows if not row.get('deletedAt')}
            candidates[item_id]=old
            children_by_parent={}
            for row in candidates.values():
                parent_id=str(row.get('parentId') or '')
                if parent_id:
                    children_by_parent.setdefault(parent_id,[]).append(row)
            collected=[]
            seen=set()
            queue=[(old,0)]
            queue_pos=0
            while queue_pos<len(queue):
                row,depth=queue[queue_pos]
                queue_pos+=1
                child_id=str(row.get('itemId') or '')
                if not child_id or child_id in seen:
                    continue
                seen.add(child_id)
                collected.append((row,depth))
                queue.extend((child,depth+1) for child in children_by_parent.get(child_id,[]))
            collected.sort(key=lambda pair:(-pair[1],str(pair[0].get('itemId') or '')))
            # Resolve archive snapshots before deleting any parent, preserving original parent/root names.
            archive_lookup_cache={str(row.get('itemId') or ''):row for row,_ in collected}
            archive_rows=[make_archive_record(row,archived_at,actor_id,archive_lookup_cache) for row,_ in collected]
            expected_versions={str(row.get('itemId')):int(row.get('version',0)) for row,_ in collected}
            normalized_events=build_audit_events(old,profile,'delete',supplied,at=archived_at,affected_count=len(collected))
            completed=[]
            chunk_size=40
            try:
                for start in range(0,len(collected),chunk_size):
                    chunk=collected[start:start+chunk_size]
                    writes=[]
                    for row,_ in chunk:
                        row_id=str(row['itemId'])
                        archive_row=next(x for x in archive_rows if str(x.get('archiveId'))==row_id)
                        writes.extend([
                          {'Put':{'TableName':ARCHIVE.name,'Item':av_map(archive_row),'ConditionExpression':'attribute_not_exists(#archiveId)','ExpressionAttributeNames':{'#archiveId':'archiveId'}}},
                          {'Delete':{'TableName':WORK.name,'Key':av_map({'itemId':row_id}),'ConditionExpression':'#version = :expected','ExpressionAttributeNames':{'#version':'version'},'ExpressionAttributeValues':{':expected':SERIALIZER.serialize(expected_versions[row_id])}}}
                        ])
                    is_final=start+len(chunk)>=len(collected)
                    if is_final:
                        for event_row in normalized_events:
                            writes.append({'Put':{'TableName':ACTIVITY.name,'Item':av_map(event_row),'ConditionExpression':'attribute_not_exists(#activityKey)','ExpressionAttributeNames':{'#activityKey':'activityKey'}}})
                    ddb.meta.client.transact_write_items(TransactItems=writes)
                    completed.extend(chunk)
            except ClientError:
                # Compensate earlier chunks so a conflict doesn't leave half a subtree archived.
                rollback_ok=True
                try:
                    for start in range(0,len(completed),chunk_size):
                        chunk=completed[start:start+chunk_size]
                        rollback=[]
                        for row,_ in chunk:
                            row_id=str(row['itemId'])
                            archive_row=next(x for x in archive_rows if str(x.get('archiveId'))==row_id)
                            rollback.extend([
                              {'Put':{'TableName':WORK.name,'Item':av_map(row),'ConditionExpression':'attribute_not_exists(#itemId)','ExpressionAttributeNames':{'#itemId':'itemId'}}},
                              {'Delete':{'TableName':ARCHIVE.name,'Key':av_map({'archiveId':row_id}),'ConditionExpression':'attribute_exists(#archiveId)','ExpressionAttributeNames':{'#archiveId':'archiveId'}}}
                            ])
                        if rollback:
                            ddb.meta.client.transact_write_items(TransactItems=rollback)
                except ClientError:
                    rollback_ok=False
                message='The item changed while it was being archived. Refresh and retry.' if rollback_ok else 'The archive operation was interrupted; refresh the workspace and Archive to reconcile the saved state.'
                return response(409,{'message':message,'rolledBack':rollback_ok})
            return response(200,{'ok':True,'itemId':item_id,'archived':True,'archivedItemIds':[str(row.get('itemId')) for row,_ in collected],'activityEvents':[public_event(e) for e in normalized_events]})
        if path=='/activity' and method=='POST':
            return response(405,{'message':'Activity events must be written atomically with an item create, update, or delete.'})
        if path=='/activity' and method=='GET':
            # The existing Activity table has itemId + activityKey as its key and
            # no GSIs. Item-scoped history uses Query; app-wide history scans the
            # small table until a dedicated application timeline GSI is approved.
            if qs.get('scope') in ('application','global'):
                rows=scan_pages(ACTIVITY)
            elif qs.get('rootParentId'):
                rows=query_events_for_items([
                    str(row.get('itemId') or '')
                    for row in query_root_rows(qs['rootParentId'],include_root=True)
                ])
            elif qs.get('itemId'):
                rows=query_events_for_item(qs['itemId'])
            elif qs.get('parentId'):
                rows=query_events_for_items([
                    str(row.get('itemId') or '')
                    for row in query_children_rows(qs['parentId'])
                ])
            else:
                return response(400,{'message':'Provide scope=application, itemId, rootParentId, or parentId for an activity query.'})
            search=str(qs.get('q') or '').strip().lower()
            if search:
                rows=[row for row in rows if search in json.dumps(row,ensure_ascii=False,default=str).lower()]
            rows.sort(key=lambda row:(str(row.get('at') or ''),str(row.get('eventId') or '')),reverse=True)
            unique={str(row.get('eventId') or row.get('activityKey')):row for row in rows}
            events=sorted(unique.values(),key=lambda row:(str(row.get('at') or ''),str(row.get('eventId') or '')),reverse=True)
            public_events=[public_event(row) for row in events]
            version=cache_version(public_events)
            if qs.get('cacheMode')=='1' and qs.get('cacheVersion')==version:
                return response(200,{'notModified':True,'version':version})
            # Send the newest events in bounded pages. The client requests subsequent
            # pages only when its history scroll region reaches the end.
            offset=max(0,int(qs.get('offset',0)))
            limit=max(1,min(250,int(qs.get('limit',100))))
            next_offset=offset+limit if offset+limit<len(public_events) else None
            return response(200,{'events':public_events[offset:offset+limit],'count':len(public_events),'nextOffset':next_offset,'version':version})
        m=re.fullmatch(r'/activity/([^/]+)',path)
        if m and method in ('PATCH','DELETE'):
            return response(405,{'message':'Activity history is append-only and cannot be edited or deleted.'})
        return response(404,{'message':f'Unknown route: {method} {path}'})
    except PermissionError as exc:
        logger.warning(
            "request_forbidden",
            extra={"requestId": request_id, "method": method, "path": path},
        )
        return response(403, {"message": str(exc)})
    except ValueError as exc:
        return response(400, {"message": str(exc)})
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "Unknown")
        logger.error(
            "database_operation_failed",
            extra={
                "requestId": request_id,
                "method": method,
                "path": path,
                "errorCode": error_code,
            },
        )
        return response(500, {"message": "Database operation failed."})
    except Exception as exc:
        # Do not send exception strings, database details, or request data to the browser.
        logger.error(
            "unhandled_request_error",
            extra={
                "requestId": request_id,
                "method": method,
                "path": path,
                "errorType": type(exc).__name__,
            },
        )
        return response(500, {"message": "Internal server error."})
