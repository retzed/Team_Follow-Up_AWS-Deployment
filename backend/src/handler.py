"""Team Follow-Up API handler.

API Gateway validates the Cognito JWT before this function runs. The handler then
maps the verified Cognito ``sub`` to an enabled team profile and treats that profile
as the source of truth for creator, editor, assignee, and activity actor identity.
"""

import base64
import json
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
        writes.append({'Put': {'TableName': ACTIVITY.name, 'Item': av_map(event), 'ConditionExpression': 'attribute_not_exists(#eventId)', 'ExpressionAttributeNames': {'#eventId': 'eventId'}}})
    ddb.meta.client.transact_write_items(TransactItems=writes)

ddb = boto3.resource('dynamodb')
WORK = ddb.Table(os.environ['WORK_ITEMS_TABLE'])
ACTIVITY = ddb.Table(os.environ['ACTIVITY_TABLE'])
USERS = ddb.Table(os.environ['USER_PROFILES_TABLE'])
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
    items=[]
    result=table.query(**kwargs)
    items.extend(result.get('Items',[]))
    while result.get('LastEvaluatedKey'):
        kwargs['ExclusiveStartKey']=result['LastEvaluatedKey']
        result=table.query(**kwargs)
        items.extend(result.get('Items',[]))
    return items
def scan_pages(table, **kwargs):
    items=[]
    result=table.scan(**kwargs)
    items.extend(result.get('Items',[]))
    while result.get('LastEvaluatedKey'):
        kwargs['ExclusiveStartKey']=result['LastEvaluatedKey']
        result=table.scan(**kwargs)
        items.extend(result.get('Items',[]))
    return items


def get_identity(event):
    try:
        return event['requestContext']['authorizer']['jwt']['claims']
    except Exception:
        return {}
def current_profile(event):
    sub=get_identity(event).get('sub')
    if not sub:
        return None
    rows=all_pages(USERS, IndexName='GSI_CognitoSub', KeyConditionExpression=Key('cognitoSub').eq(sub), Limit=1)
    return rows[0] if rows and rows[0].get('enabled',True) else None

# ---------------------------------------------------------------------------
# Work-item and audit-event data contracts
# ---------------------------------------------------------------------------
def index_work_item(x):
    x=dict(x)
    item_id=str(x.get('itemId') or x.get('id') or '')
    if not item_id:
        raise ValueError('itemId is required')
    x.pop('id',None)
    x['itemId']=item_id
    x['createdByUserId']=x.get('createdByUserId') or x.get('createdBy') or ''
    x['updatedByUserId']=x.get('updatedByUserId') or x.get('updatedBy') or ''
    x.pop('activityEvents',None)
    top=x.get('type') in ('project','job')
    root=item_id if top else (x.get('rootParentId') or x.get('parentId') or '')
    x['listPK']='TOP_LEVEL' if top else 'PARENT#'+str(x.get('parentId') or '')
    x['updatedSort']=str(x.get('updatedAt') or now())+'#'+item_id
    x['createdSort']=str(x.get('createdAt') or now())+'#'+item_id
    x['rootPK']='ROOT#'+str(root)
    x['rootUpdatedSort']=str(x.get('updatedAt') or now())+'#'+item_id
    if x.get('ownerId'):
        x['assigneePK']='USER#'+str(x['ownerId'])
        x['assigneeUpdatedSort']=str(x.get('updatedAt') or now())+'#'+item_id
        x['assigneeCreatedSort']=str(x.get('createdAt') or now())+'#'+item_id
    else:
        for k in ('assigneePK','assigneeUpdatedSort','assigneeCreatedSort'):
            x.pop(k,None)
    return x


def activity_item(e):
    x=dict(e)
    event_id=str(x.get('eventId') or x.get('id') or uuid.uuid4().hex)
    x.pop('id',None)
    x['eventId']=event_id
    x['actorUserId']=x.get('actorUserId') or x.get('userId') or ''
    x['itemNameSnapshot']=x.get('itemNameSnapshot') or x.get('itemName') or ''
    x['itemTypeSnapshot']=x.get('itemTypeSnapshot') or x.get('itemType') or ''
    x.pop('userId',None)
    x.pop('itemName',None)
    x.pop('itemType',None)
    stamp=str(x.get('at') or now())+'#'+event_id
    x['itemPK']='ITEM#'+str(x.get('itemId') or '')
    x['itemSort']=stamp
    x['applicationPK']='APPLICATION'
    x['applicationSort']=stamp
    x['rootPK']='ROOT#'+str(x.get('rootParentId') or '')
    x['rootSort']=stamp
    if x.get('parentId'):
        x['parentPK']='PARENT#'+str(x['parentId'])
        x['parentSort']=str(x.get('at') or now())+'#'+event_id
    else:
        x.pop('parentPK',None)
        x.pop('parentSort',None)
    return x


def public_item(x):
    y=dict(x)
    y['id']=y.get('itemId')
    y.pop('itemId',None)
    y['createdBy']=y.get('createdByUserId') or y.get('createdBy','')
    y['updatedBy']=y.get('updatedByUserId') or y.get('updatedBy','')
    for k in ('createdByUserId','updatedByUserId','listPK','updatedSort','createdSort','rootPK','rootUpdatedSort','assigneePK','assigneeUpdatedSort','assigneeCreatedSort','deletedAt'):
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
    for key in ('id','deletedAt','listPK','updatedSort','createdSort','rootPK','rootUpdatedSort','assigneePK','assigneeUpdatedSort','assigneeCreatedSort'):
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
    for k in ('actorUserId','itemNameSnapshot','itemTypeSnapshot','itemPK','itemSort','applicationPK','applicationSort','rootPK','rootSort','parentPK','parentSort'):
        y.pop(k,None)
    return y

# ---------------------------------------------------------------------------
# Server-side business validation and audit construction
# ---------------------------------------------------------------------------
def validate_item(event, item, previous=None):
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
                  'assigneeUpdatedSort','assigneeCreatedSort','deletedAt'):
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
            children=all_pages(WORK,IndexName='GSI_ListUpdated',KeyConditionExpression=Key('listPK').eq('PARENT#'+item_id))
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
            nested=all_pages(WORK,IndexName='GSI_ListUpdated',KeyConditionExpression=Key('listPK').eq('PARENT#'+item_id))
            if any(not c.get('deletedAt') for c in nested):
                raise ValueError('A task containing follow-ups cannot be converted to a follow-up.')
    else:
        raise ValueError('Item type must be project, job, task, or followup.')
    return index_work_item(item),profile


def add_activity(item, actor, action, kind='update', when=None):
    at=when or now()
    eid='evt_'+uuid.uuid4().hex
    e={'eventId':eid,'itemId':item['itemId'],'itemNameSnapshot':item.get('name',''),'itemTypeSnapshot':item.get('type',''),'rootParentId':item.get('rootParentId') or item['itemId'],'parentId':item.get('parentId'),'ancestorIds':item.get('ancestorIds',[]),'actorUserId':actor.get('userId',''),'action':action,'summary':action,'kind':kind,'at':at}
    ACTIVITY.put_item(Item=activity_item(e))


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
def query_work_items(qs):
    if qs.get('scope')=='top-level':
        index='GSI_ListUpdated' if qs.get('dateMode','updated')=='updated' else 'GSI_ListCreated'
        sort_key='createdSort' if index=='GSI_ListCreated' else 'updatedSort'
        rows=all_pages(WORK,IndexName=index,KeyConditionExpression=Key('listPK').eq('TOP_LEVEL'),ScanIndexForward=(qs.get('direction')=='asc'))
    elif qs.get('parentId'):
        index='GSI_ListUpdated' if qs.get('dateMode','updated')=='updated' else 'GSI_ListCreated'
        sort_key='createdSort' if index=='GSI_ListCreated' else 'updatedSort'
        rows=all_pages(WORK,IndexName=index,KeyConditionExpression=Key('listPK').eq('PARENT#'+qs['parentId']),ScanIndexForward=(qs.get('direction')=='asc'))
    elif qs.get('rootParentId'):
        rows=all_pages(WORK,IndexName='GSI_RootUpdated',KeyConditionExpression=Key('rootPK').eq('ROOT#'+qs['rootParentId']),ScanIndexForward=(qs.get('direction')=='asc'))
    elif qs.get('assigneeUserId'):
        index='GSI_AssignedUpdated' if qs.get('dateMode','updated')=='updated' else 'GSI_AssignedCreated'
        rows=all_pages(WORK,IndexName=index,KeyConditionExpression=Key('assigneePK').eq('USER#'+qs['assigneeUserId']),ScanIndexForward=(qs.get('direction')=='asc'))
    else:
        raise ValueError('Choose a supported indexed work-item query.')
    rows=[x for x in rows if not x.get('deletedAt')]
    # Optional filters are intentionally applied only after an indexed query; choose key conditions where practical.
    for key in ('type','priority'):
        value=qs.get(key)
        if value and value!='all':
            rows=[x for x in rows if x.get(key)==value]
    status=qs.get('status')
    if status and status!='all':
        rows=[x for x in rows if (x.get('status')!='completed' if status=='not-completed' else x.get('status')==status)]
    search=qs.get('q','').lower()
    if search:
        rows=[x for x in rows if search in str(x.get('name','')).lower() or search in str(x.get('description','')).lower()]
    start=qs.get('from')
    end=qs.get('to')
    date_field='updatedAt' if qs.get('dateMode','updated')=='updated' else 'createdAt'
    if start:
        rows=[x for x in rows if str(x.get(date_field,''))[:10]>=start]
    if end:
        rows=[x for x in rows if str(x.get(date_field,''))[:10]<=end]
    offset=max(0,int(qs.get('offset',0)))
    limit=max(1,min(250,int(qs.get('limit',100))))
    total=len(rows)
    return {'items':[public_item(x) for x in rows[offset:offset+limit]],'count':total,'nextOffset':offset+limit if offset+limit<total else None}



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

# ---------------------------------------------------------------------------
# API Gateway HTTP API entry point
# ---------------------------------------------------------------------------
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
            parents=query_work_items_all({'scope':'top-level','dateMode':'updated','direction':'desc'})
            items=list(parents)
            for p in parents:
                items.extend(query_work_items_all({'rootParentId':p['id'],'dateMode':'updated','direction':'desc'}))
            # De-duplicate by ID after root and parent indexed queries.
            by_id={x['id']:x for x in items}
            items=list(by_id.values())
            activities=[]
            for p in parents:
                ev=all_pages(ACTIVITY,IndexName='GSI_RootTimeline',KeyConditionExpression=Key('rootPK').eq('ROOT#'+p['id']),ScanIndexForward=False)
                activities.extend(public_event(e) for e in ev)
            user_rows=scan_pages(USERS)
            users=[{'id':u['userId'],'name':u.get('displayName',''),'role':u.get('role','AWS Engineer')} for u in user_rows if u.get('enabled',True)]
            return response(200,{'items':items,'activity':activities,'users':users})
        if method=='GET' and path=='/users':
            rows=scan_pages(USERS)
            return response(200,{'users':[{'id':u['userId'],'name':u.get('displayName',''),'role':u.get('role','AWS Engineer')} for u in rows if u.get('enabled',True)]})
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
            return response(200,{'items':[public_archive_item(x) for x in rows[offset:offset+limit]],'count':total,'nextOffset':offset+limit if offset+limit<total else None})
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
            # Two writes per restored item; grouped audit records are written in the final chunk,
            # keeping each DynamoDB transaction below its 100-action limit.
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
                is_final=start+len(chunk)>=len(ordered)
                chunk_events=[]
                if is_final:
                    included=set(str(x['itemId']) for x in ordered)
                    chunk_events=[event for root in selected_roots if (event:=summary_event(root,included)) is not None]
                    for event in chunk_events:
                        writes.append({'Put':{'TableName':ACTIVITY.name,'Item':av_map(event),'ConditionExpression':'attribute_not_exists(#eventId)','ExpressionAttributeNames':{'#eventId':'eventId'}}})
                try:
                    ddb.meta.client.transact_write_items(TransactItems=writes)
                except ClientError:
                    # This route is chunked for large restores. If a later chunk fails, emit one summary
                    # per successfully restored selection root, reflecting only items actually restored.
                    if restored_ids:
                        included=set(restored_ids)
                        partial=[]
                        for root in selected_roots:
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
                all_events.extend(public_event(e) for e in chunk_events)
            return response(200,{'ok':True,'restoredIds':restored_ids,'restoredItems':restored_items,'activityEvents':all_events})
        if path=='/items' and method=='GET':
            if qs.get('scope')=='top-level':
                result=query_work_items(qs)
            else:
                result=query_work_items(qs)
            return response(200,result)
        if path=='/items/assigned-to-me' and method=='GET':
            result=query_work_items({**qs,'assigneeUserId':profile['userId']})
            return response(200,result)
        m=re.fullmatch(r'/items/([^/]+)/children',path)
        if m and method=='GET':
            return response(200,query_work_items({**qs,'parentId':m.group(1)}))
        m=re.fullmatch(r'/items/([^/]+)/activity',path)
        if m and method=='GET':
            item_id=m.group(1)
            item=WORK.get_item(Key={'itemId':item_id}).get('Item')
            if not item:
                return response(404,{'message':'Item not found'})
            scope=qs.get('scope','item')
            if scope=='all' and item.get('type') in ('project','job'):
                rows=all_pages(ACTIVITY,IndexName='GSI_RootTimeline',KeyConditionExpression=Key('rootPK').eq('ROOT#'+item_id),ScanIndexForward=False)
            elif scope=='all' and item.get('type')=='task':
                rows=all_pages(ACTIVITY,IndexName='GSI_ParentTimeline',KeyConditionExpression=Key('parentPK').eq('PARENT#'+item_id),ScanIndexForward=False)
                rows+=all_pages(ACTIVITY,IndexName='GSI_ItemTimeline',KeyConditionExpression=Key('itemPK').eq('ITEM#'+item_id),ScanIndexForward=False)
            else:
                rows=all_pages(ACTIVITY,IndexName='GSI_ItemTimeline',KeyConditionExpression=Key('itemPK').eq('ITEM#'+item_id),ScanIndexForward=False)
            search=qs.get('q','').lower()
            if search:
                rows=[e for e in rows if search in json.dumps(e,ensure_ascii=False).lower()]
            unique={e['eventId']:e for e in rows}
            rows=sorted(unique.values(),key=lambda e:e.get('at',''),reverse=True)
            return response(200,{'events':[public_event(e) for e in rows],'count':len(rows)})
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
                candidate_rows=all_pages(WORK,IndexName='GSI_RootUpdated',KeyConditionExpression=Key('rootPK').eq('ROOT#'+root_id))
            elif item_type=='task':
                candidate_rows=all_pages(WORK,IndexName='GSI_ListUpdated',KeyConditionExpression=Key('listPK').eq('PARENT#'+item_id))
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
                            writes.append({'Put':{'TableName':ACTIVITY.name,'Item':av_map(event_row),'ConditionExpression':'attribute_not_exists(#eventId)','ExpressionAttributeNames':{'#eventId':'eventId'}}})
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
            # Application history is a first-class indexed timeline, not an unfiltered table scan.
            if qs.get('scope') in ('application','global'):
                rows=all_pages(ACTIVITY,IndexName='GSI_ApplicationTimeline',KeyConditionExpression=Key('applicationPK').eq('APPLICATION'),ScanIndexForward=False)
            elif qs.get('rootParentId'):
                rows=all_pages(ACTIVITY,IndexName='GSI_RootTimeline',KeyConditionExpression=Key('rootPK').eq('ROOT#'+qs['rootParentId']),ScanIndexForward=False)
            elif qs.get('itemId'):
                rows=all_pages(ACTIVITY,IndexName='GSI_ItemTimeline',KeyConditionExpression=Key('itemPK').eq('ITEM#'+qs['itemId']),ScanIndexForward=False)
            elif qs.get('parentId'):
                rows=all_pages(ACTIVITY,IndexName='GSI_ParentTimeline',KeyConditionExpression=Key('parentPK').eq('PARENT#'+qs['parentId']),ScanIndexForward=False)
            else:
                return response(400,{'message':'Provide scope=application, itemId, rootParentId, or parentId for an indexed activity query.'})
            search=str(qs.get('q') or '').strip().lower()
            if search:
                rows=[e for e in rows if search in json.dumps(e,ensure_ascii=False,default=str).lower()]
            rows.sort(key=lambda e:(str(e.get('at') or ''),str(e.get('eventId') or '')),reverse=True)
            return response(200,{'events':[public_event(e) for e in rows],'count':len(rows)})
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
