"""Unit tests for pure API-boundary helpers; no AWS account is required."""

import base64
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from boto3.dynamodb.conditions import ConditionExpressionBuilder

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("ITEMS_TABLE", "UnitTest-Items")
os.environ.setdefault("ACTIVITY_TABLE", "UnitTest-Activity")
os.environ.setdefault("USERS_TABLE", "UnitTest-Users")
os.environ.setdefault("ARCHIVE_TABLE", "UnitTest-Archive")
os.environ.setdefault("REALTIME_TABLE", "UnitTest-Realtime")
os.environ.setdefault("WEBSOCKET_MANAGEMENT_ENDPOINT", "https://unit-test.execute-api.us-east-1.amazonaws.com/prod")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

import handler  # noqa: E402


class HandlerHelperTests(unittest.TestCase):
    def test_restore_summary_is_scheduled_after_the_last_selected_descendant(self):
        ordered = [
            {"itemId": "root-a"},
            {"itemId": "child-a"},
            {"itemId": "root-b"},
            {"itemId": "followup-a"},
        ]
        roots = [{"itemId": "root-a"}, {"itemId": "root-b"}]
        membership = {
            "root-a": {"root-a", "child-a", "followup-a"},
            "root-b": {"root-b"},
        }
        positions = handler.restore_root_completion_positions(
            ordered, roots,
            lambda row, root_id: row["itemId"] in membership[root_id],
        )
        self.assertEqual(positions, {"root-a": 3, "root-b": 2})
        first_chunk = [
            root["itemId"] for root in roots
            if 0 <= positions[root["itemId"]] < 3
        ]
        second_chunk = [
            root["itemId"] for root in roots
            if 3 <= positions[root["itemId"]] < 4
        ]
        self.assertEqual(first_chunk, ["root-b"])
        self.assertEqual(second_chunk, ["root-a"])

    def test_current_profile_resolves_a_single_enabled_cognito_subject_without_gsi(self):
        event = {
            "requestContext": {
                "authorizer": {
                    "jwt": {"claims": {"sub": "cognito-sub-u2"}}
                }
            }
        }
        profile = {
            "userId": "u2",
            "displayName": "Zyad",
            "cognitoSub": "cognito-sub-u2",
            "enabled": True,
        }
        with patch.object(handler, "scan_pages", return_value=[profile]) as scan:
            result = handler.current_profile(event)
        self.assertEqual(result, profile)
        scan.assert_called_once_with(handler.USERS)

    def test_current_profile_fails_closed_for_missing_duplicate_or_disabled_subject(self):
        event = {
            "requestContext": {
                "authorizer": {
                    "jwt": {"claims": {"sub": "cognito-sub-u2"}}
                }
            }
        }
        enabled = {"userId": "u2", "cognitoSub": "cognito-sub-u2", "enabled": True}
        disabled = {**enabled, "enabled": False}
        cases = [
            [],
            [enabled, {**enabled, "userId": "u3"}],
            [disabled],
        ]
        for rows in cases:
            with self.subTest(rows=rows):
                with patch.object(handler, "scan_pages", return_value=rows):
                    self.assertIsNone(handler.current_profile(event))

    def test_index_work_item_materializes_project_keys(self):
        row = handler.index_work_item(
            {
                "id": "project-1",
                "type": "project",
                "name": "Test project",
                "createdAt": "2026-10-14T10:00:00.000Z",
                "updatedAt": "2026-10-14T11:00:00.000Z",
            }
        )
        self.assertEqual(row["itemId"], "project-1")
        self.assertNotIn("id", row)
        self.assertEqual(row["workspaceKey"], "WORKSPACE")
        self.assertEqual(row["rootParentId"], "project-1")
        self.assertNotIn("listPK", row)
        self.assertNotIn("rootPK", row)

    def test_index_work_item_materializes_assignee_and_parent_keys(self):
        row = handler.index_work_item(
            {
                "id": "task-1",
                "type": "task",
                "parentId": "project-1",
                "rootParentId": "project-1",
                "ownerId": "u2",
                "createdAt": "2026-10-14T10:00:00.000Z",
                "updatedAt": "2026-10-14T11:00:00.000Z",
            }
        )
        self.assertEqual(row["parentId"], "project-1")
        self.assertEqual(row["assignedTo"], "u2")
        self.assertEqual(row["ownerId"], "u2")
        self.assertNotIn("listPK", row)
        self.assertNotIn("assigneePK", row)

    def test_activity_item_uses_existing_composite_primary_key(self):
        row = handler.activity_item(
            {
                "eventId": "evt-1",
                "itemId": "task-1",
                "parentId": "project-1",
                "rootParentId": "project-1",
                "at": "2026-10-14T11:00:00.000Z",
                "action": "Updated Status",
            }
        )
        self.assertEqual(row["itemId"], "task-1")
        self.assertEqual(row["activityKey"], "2026-10-14T11:00:00.000Z#evt-1")
        self.assertEqual(row["eventId"], "evt-1")
        self.assertNotIn("applicationPK", row)
        self.assertNotIn("itemPK", row)

    def test_activity_event_is_keyed_by_item_and_timestamped_activity_key(self):
        row = handler.activity_item({
            "eventId": "evt-two",
            "itemId": "item-1",
            "at": "2026-10-14T12:00:00.000Z",
            "action": "Updated item",
        })
        self.assertEqual(row["itemId"], "item-1")
        self.assertEqual(row["activityKey"], "2026-10-14T12:00:00.000Z#evt-two")
        self.assertNotIn("applicationSort", row)

    def test_public_item_does_not_leak_index_attributes(self):
        row = handler.public_item(
            {
                "itemId": "task-1",
                "type": "task",
                "createdByUserId": "u1",
                "updatedByUserId": "u2",
                "listPK": "PARENT#project-1",
                "updatedSort": "sort",
                "rootPK": "ROOT#project-1",
                "assigneePK": "USER#u2",
                "workspaceKey": "WORKSPACE",
                "assignedTo": "u2",
            }
        )
        self.assertEqual(row["id"], "task-1")
        self.assertEqual(row["createdBy"], "u1")
        self.assertEqual(row["updatedBy"], "u2")
        for key in ("itemId", "listPK", "updatedSort", "rootPK", "assigneePK", "workspaceKey", "assignedTo"):
            self.assertNotIn(key, row)

    def test_archive_record_strips_legacy_followup_status_and_due_date(self):
        root = {"itemId": "project-1", "type": "project", "name": "Project"}
        archived = handler.make_archive_record(
            {
                "itemId": "followup-legacy",
                "type": "followup",
                "name": "Legacy follow-up",
                "parentId": "project-1",
                "rootParentId": "project-1",
                "status": "completed",
                "dueDate": "2026-11-10",
            },
            "2026-11-07T00:00:00.000Z",
            "u1",
            row_cache={"project-1": root},
        )
        self.assertNotIn("status", archived)
        self.assertNotIn("dueDate", archived)

    def test_public_followup_omits_legacy_status_and_due_date(self):
        row = handler.public_item({
            "itemId": "followup-legacy",
            "type": "followup",
            "status": "completed",
            "dueDate": "2026-11-10",
            "name": "Legacy follow-up",
        })
        self.assertNotIn("status", row)
        self.assertNotIn("dueDate", row)
        self.assertEqual(row["type"], "followup")

    def test_body_of_decodes_base64_json(self):
        raw = base64.b64encode(json.dumps({"itemIds": ["one"]}).encode()).decode()
        self.assertEqual(handler.body_of({"body": raw, "isBase64Encoded": True}), {"itemIds": ["one"]})

    def test_body_of_marks_malformed_or_non_object_payload(self):
        self.assertTrue(handler.body_of({"body": "{"})["__invalid_json_body__"])
        self.assertTrue(handler.body_of({"body": "[1, 2]"})["__invalid_json_body__"])

    def test_unauthenticated_request_returns_401_before_database_access(self):
        result = handler.lambda_handler(
            {"rawPath": "/bootstrap", "requestContext": {"http": {"method": "GET"}}},
            SimpleNamespace(aws_request_id="unit-test-request"),
        )
        self.assertEqual(result["statusCode"], 401)
        self.assertEqual(json.loads(result["body"])["message"], "Unauthorized")

    def test_invalid_json_body_returns_400(self):
        result = handler.lambda_handler(
            {
                "rawPath": "/items",
                "requestContext": {"http": {"method": "POST"}},
                "body": "{not-json",
            },
            SimpleNamespace(aws_request_id="unit-test-request"),
        )
        self.assertEqual(result["statusCode"], 400)
        self.assertEqual(
            json.loads(result["body"])["message"],
            "Request body must be a valid JSON object.",
        )

    def test_authenticated_but_unmapped_profile_returns_403(self):
        event = {
            "rawPath": "/bootstrap",
            "requestContext": {
                "http": {"method": "GET"},
                "authorizer": {"jwt": {"claims": {"sub": "unmapped-sub"}}},
            },
        }
        with patch.object(handler, "current_profile", return_value=None):
            result = handler.lambda_handler(
                event, SimpleNamespace(aws_request_id="unit-test-request")
            )
        self.assertEqual(result["statusCode"], 403)
        self.assertIn("not mapped", json.loads(result["body"])["message"])

    def test_bootstrap_returns_only_top_level_items_and_profiles(self):
        event = {
            "rawPath": "/bootstrap",
            "requestContext": {
                "http": {"method": "GET"},
                "authorizer": {"jwt": {"claims": {"sub": "mapped-sub"}}},
            },
        }
        parents = [{"id": "project-1", "type": "project", "name": "Project Alpha"}]
        profiles = [{"userId": "u1", "displayName": "Marwa", "role": "Team Leader", "enabled": True}]
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler, "query_work_items_all", return_value=parents) as query_items,
            patch.object(handler, "scan_pages", return_value=profiles) as scan_users,
            patch.object(handler, "query_events_for_item") as query_activity,
        ):
            result = handler.lambda_handler(
                event, SimpleNamespace(aws_request_id="bootstrap-lazy-load-test")
            )

        self.assertEqual(result["statusCode"], 200)
        payload = json.loads(result["body"])
        self.assertEqual(payload, {"items": parents, "users": [{"id": "u1", "name": "Marwa", "nameArabic": "", "role": "Team Leader", "roleArabic": "", "icon": "profile-user", "privilege": "Administrator", "enabled": True}]})
        query_items.assert_called_once_with(
            {"scope": "top-level", "dateMode": "updated", "direction": "desc"}
        )
        scan_users.assert_called_once_with(handler.USERS)
        query_activity.assert_not_called()

    def test_item_history_reads_archived_descendant_events_only_on_popup_request(self):
        event = {
            "rawPath": "/items/project-1/activity",
            "queryStringParameters": {"scope": "all"},
            "requestContext": {
                "http": {"method": "GET"},
                "authorizer": {"jwt": {"claims": {"sub": "mapped-sub"}}},
            },
        }
        root = {"itemId": "project-1", "type": "project"}
        active_task = {"itemId": "task-active", "type": "task", "rootParentId": "project-1"}
        archived_task = {"itemId": "task-archived", "archiveId": "task-archived", "archiveRootId": "project-1"}
        archived_event = {
            "eventId": "evt-archived-delete",
            "itemId": "task-archived",
            "at": "2026-10-15T12:00:00.000Z",
            "action": "Deleted task",
            "kind": "delete",
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": root}),
            patch.object(handler, "query_root_rows", return_value=[root, active_task]),
            patch.object(handler, "query_archived_history_rows", return_value=[archived_task]) as query_archived,
            patch.object(handler, "query_events_for_items", return_value=[archived_event]) as query_events,
        ):
            result = handler.lambda_handler(
                event, SimpleNamespace(aws_request_id="on-demand-history-test")
            )

        self.assertEqual(result["statusCode"], 200)
        query_archived.assert_called_once_with(root_id="project-1")
        query_events.assert_called_once_with(["project-1", "task-active", "task-archived"])
        payload = json.loads(result["body"])
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["events"][0]["id"], "evt-archived-delete")

    def test_task_history_includes_archived_direct_followups_on_popup_request(self):
        event = {
            "rawPath": "/items/task-1/activity",
            "queryStringParameters": {"scope": "all"},
            "requestContext": {
                "http": {"method": "GET"},
                "authorizer": {"jwt": {"claims": {"sub": "mapped-sub"}}},
            },
        }
        task = {"itemId": "task-1", "type": "task", "rootParentId": "project-1"}
        active_followup = {"itemId": "followup-active", "type": "followup", "parentId": "task-1"}
        archived_followup = {"itemId": "followup-archived", "archiveId": "followup-archived", "archiveParentId": "task-1"}
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": task}),
            patch.object(handler, "query_children_rows", return_value=[active_followup]),
            patch.object(handler, "query_archived_history_rows", return_value=[archived_followup]) as query_archived,
            patch.object(handler, "query_events_for_items", return_value=[]) as query_events,
        ):
            result = handler.lambda_handler(
                event, SimpleNamespace(aws_request_id="on-demand-task-history-test")
            )

        self.assertEqual(result["statusCode"], 200)
        query_archived.assert_called_once_with(parent_id="task-1")
        query_events.assert_called_once_with(["task-1", "followup-active", "followup-archived"])

    def test_unhandled_exception_does_not_leak_exception_text(self):
        event = {
            "rawPath": "/bootstrap",
            "requestContext": {
                "http": {"method": "GET"},
                "authorizer": {"jwt": {"claims": {"sub": "test-sub"}}},
            },
        }
        with patch.object(handler, "current_profile", side_effect=RuntimeError("private-table-detail")):
            result = handler.lambda_handler(event, SimpleNamespace(aws_request_id="unit-test-request"))
        self.assertEqual(result["statusCode"], 500)
        self.assertNotIn("private-table-detail", result["body"])
        self.assertEqual(json.loads(result["body"])["message"], "Internal server error.")


    def test_public_team_user_separates_private_contact_and_defaults_first_admin(self):
        row = {
            "userId": "u1", "displayName": "Marwa", "displayNameArabic": "مروة", "role": "Team Leader", "roleArabic": "قائد الفريق",
            "phoneNumber": "+20 123", "email": "marwa@example.com",
            "preferences": {"lang": "ar", "theme": "light"},
            "pinnedItemIds": ["p1"], "cognitoSub": "private-subject",
        }
        public = handler.public_team_user(row)
        self.assertEqual(public["privilege"], "Administrator")
        for key in ("email", "phoneNumber", "pinnedItemIds", "cognitoSub"):
            self.assertNotIn(key, public)
        private = handler.public_team_user(row, include_private=True)
        self.assertEqual(private["email"], "marwa@example.com")
        self.assertEqual(private["nameArabic"], "مروة")
        self.assertEqual(private["roleArabic"], "قائد الفريق")
        self.assertEqual(private["pinnedItemIds"], ["p1"])

    def test_public_team_user_reads_legacy_arabic_profile_field_aliases(self):
        row = {
            "userId": "u2", "name": "Zyad", "nameArabic": "زياد",
            "label": "Cloud Engineer", "labelArabic": "مهندس سحابة", "icon": "user", "enabled": True,
        }
        profile = handler.public_team_user(row, include_private=True)
        self.assertEqual(profile["name"], "Zyad")
        self.assertEqual(profile["nameArabic"], "زياد")
        self.assertEqual(profile["role"], "Cloud Engineer")
        self.assertEqual(profile["roleArabic"], "مهندس سحابة")
        self.assertEqual(profile["icon"], "profile-user")

    def test_privilege_manager_bootstrap_and_explicit_demotion(self):
        self.assertTrue(handler.is_privilege_manager({"userId": "root"}))
        self.assertTrue(handler.is_privilege_manager({"userId": "u1"}))
        self.assertTrue(handler.is_privilege_manager({"userId": "u1", "privilege": "Administrator"}))
        self.assertFalse(handler.is_privilege_manager({"userId": "u1", "privilege": "User"}))
        self.assertFalse(handler.is_privilege_manager({"userId": "u2"}))
        self.assertFalse(handler.is_privilege_manager({"userId": "u2", "privilege": "Editor"}))

    def test_profile_update_validation_and_field_mapping(self):
        actor = {"userId": "u2", "privilege": "User"}
        target = {
            "userId": "u2", "displayName": "Zyad", "phoneNumber": "",
            "email": "", "role": "AWS Engineer", "icon": "terminal",
            "preferences": {"lang": "en", "theme": "dark"},
        }
        updates = handler.normalize_profile_updates({
            "name": "  Zyad Ibrahim  ", "nameArabic": " زياد إبراهيم ", "phoneNumber": "+20 123",
            "email": "zyad@example.com", "role": "Cloud Engineer", "roleArabic": "مهندس سحابة",
            "icon": "briefcase", "preferences": {"lang": "ar", "theme": "light"},
        }, actor, target)
        self.assertEqual(updates["displayName"], "Zyad Ibrahim")
        self.assertEqual(updates["displayNameArabic"], "زياد إبراهيم")
        self.assertEqual(updates["phoneNumber"], "+20 123")
        self.assertEqual(updates["email"], "zyad@example.com")
        self.assertEqual(updates["role"], "Cloud Engineer")
        self.assertEqual(updates["roleArabic"], "مهندس سحابة")
        self.assertEqual(updates["icon"], "briefcase")
        self.assertEqual(handler.normalize_profile_updates({"icon": "cowboy-hat"}, actor, target)["icon"], "cowboy-hat")
        self.assertEqual(handler.normalize_profile_updates({"icon": "profile-user"}, actor, target)["icon"], "profile-user")
        with self.assertRaises(ValueError):
            handler.normalize_profile_updates({"icon": "hard-hat"}, actor, target)
        for icon_value in ("networking", "systems", "communications-engineering", "engineer", "wave", "female-user"):
            self.assertEqual(handler.normalize_profile_updates({"icon": icon_value}, actor, target)["icon"], icon_value)
        self.assertEqual(updates["preferences"], {"lang": "ar", "theme": "light"})

    def test_profile_update_rejects_unauthorized_privilege_bad_email_and_root(self):
        target = {"userId": "u2", "displayName": "Zyad"}
        with self.assertRaises(PermissionError):
            handler.normalize_profile_updates(
                {"privilege": "Administrator"},
                {"userId": "u2", "privilege": "User"}, target,
            )
        with self.assertRaises(ValueError):
            handler.normalize_profile_updates(
                {"email": "not-an-email"},
                {"userId": "u2", "privilege": "User"}, target,
            )
        with self.assertRaises(PermissionError):
            handler.normalize_profile_updates(
                {"name": "Changed"}, {"userId": "root"},
                {"userId": "root", "displayName": "root"},
            )
        with self.assertRaises(ValueError):
            handler.normalize_profile_updates(
                {"privilege": "Superuser"}, {"userId": "root"}, target,
            )

    def test_profile_activity_is_global_and_has_change_action(self):
        event = handler.profile_audit_event(
            {"userId": "u1"}, {"userId": "u2", "displayName": "Zyad"},
            "Updated profile name", at="2026-10-28T10:00:00.000Z",
        )
        self.assertEqual(event["actorUserId"], "u1")
        self.assertEqual(event["itemId"], "PROFILE#u2")
        self.assertEqual(event["rootParentId"], "USER_PROFILES")
        self.assertEqual(event["rootParentName"], "User profiles")
        self.assertEqual(event["action"], "Updated profile name")





class RealtimeDeliveryTests(unittest.TestCase):
    def test_item_activity_and_outbox_are_committed_in_one_transaction(self):
        item = {
            "itemId": "task-1", "type": "task", "name": "Task One",
            "parentId": "project-1", "rootParentId": "project-1",
            "ownerId": "u2", "version": 2,
        }
        activity = {
            "itemId": "task-1", "activityKey": "2026-11-02T00:00:00.000Z#event-1",
            "eventId": "event-1", "userId": "u1", "action": "Updated task",
        }
        with patch.object(handler, "query_children_rows", return_value=[]):
            change = handler.make_realtime_change(item, change_kind="updated")
        with patch.object(handler.ddb.meta.client, "transact_write_items") as transact:
            handler.commit_item_with_events(item, [activity], condition="version", expected_version=1, change_event=change)
        writes = transact.call_args.kwargs["TransactItems"]
        self.assertEqual(len(writes), 3, "item, audit event, and compact change outbox are committed together")
        self.assertEqual(writes[0]["Put"]["TableName"], handler.WORK.name)
        self.assertEqual(writes[1]["Put"]["TableName"], handler.ACTIVITY.name)
        self.assertEqual(writes[2]["Put"]["TableName"], handler.REALTIME_TABLE.name)
        self.assertEqual(writes[2]["Put"]["Item"]["partitionKey"], {"S": "CHANGE"})
        self.assertNotIn("name", writes[2]["Put"]["Item"])

    def test_change_record_contains_only_targeted_refresh_metadata(self):
        previous = {
            "itemId": "task-1", "type": "task", "parentId": "project-old",
            "rootParentId": "project-old", "ownerId": "u2", "version": 3,
            "name": "Private old title", "description": "Private old description",
        }
        updated = {
            "itemId": "task-1", "type": "task", "parentId": "project-new",
            "rootParentId": "project-new", "ownerId": "u3", "version": 4,
            "name": "Private new title", "description": "Private new description",
        }
        with patch.object(handler, "query_children_rows", return_value=[]):
            change = handler.make_realtime_change(updated, previous=previous, change_kind="updated")
        public = handler.public_realtime_change(change)

        self.assertEqual(public["type"], "items.changed")
        self.assertEqual(public["itemId"], "task-1")
        self.assertEqual(public["itemIds"], ["task-1"])
        self.assertEqual(public["itemType"], "task")
        self.assertEqual(public["parentId"], "project-new")
        self.assertEqual(set(public["rootParentIds"]), {"project-old", "project-new"})
        self.assertEqual(set(public["parentIds"]), {"project-old", "project-new"})
        self.assertEqual(set(public["assigneeIds"]), {"u2", "u3"})
        self.assertEqual(public["version"], 4)
        self.assertEqual(public["changeKind"], "updated")
        self.assertTrue(public["cursor"])
        cursor_timestamp = change["sortKey"].split("#", 1)[0]
        self.assertEqual(len(cursor_timestamp.rsplit(".", 1)[1].rstrip("Z")), 6, "durable cursors retain microsecond precision")
        serialized = json.dumps(public)
        self.assertNotIn("Private", serialized)
        self.assertNotIn("description", public)
        self.assertLessEqual(change["expiresAt"] - handler.epoch_seconds(), handler.REALTIME_CHANGE_RETENTION_SECONDS)

    def test_make_realtime_change_includes_all_users_marker(self):
        item = {
            "itemId": "task-all", "type": "task", "parentId": "project-1",
            "rootParentId": "project-1", "assigneeMode": "all",
            "assigneeIds": ["u1", "u2"],
        }
        with patch.object(handler, "query_children_rows", return_value=[]):
            change = handler.public_realtime_change(handler.make_realtime_change(item))
        self.assertEqual(set(change["assigneeIds"]), {"u1", "u2", "ALL_USERS"})

    def test_subtree_delete_change_includes_affected_roots_and_assignees(self):
        root = {"itemId": "project-1", "type": "project", "rootParentId": "project-1", "ownerId": "u1"}
        task = {"itemId": "task-1", "type": "task", "parentId": "project-1", "rootParentId": "project-1", "ownerId": "u2"}
        followup = {"itemId": "followup-1", "type": "followup", "parentId": "task-1", "rootParentId": "project-1", "ownerId": "u3"}
        change = handler.public_realtime_change(handler.make_realtime_change(
            root, affected_items=[root, task, followup], change_kind="deleted", deleted=True,
        ))
        self.assertTrue(change["deleted"])
        self.assertEqual(change["itemId"], "project-1", "the change must retain the deleted hierarchy root, not the last descendant visited")
        self.assertEqual(set(change["itemIds"]), {"project-1", "task-1", "followup-1"})
        self.assertEqual(change["rootParentIds"], ["project-1"])
        self.assertEqual(set(change["parentIds"]), {"project-1", "task-1"})
        self.assertEqual(set(change["assigneeIds"]), {"u1", "u2", "u3"})

    def test_task_delete_change_includes_task_and_its_followups(self):
        task = {
            "itemId": "task-1", "type": "task", "parentId": "project-1",
            "rootParentId": "project-1", "ownerId": "u2",
        }
        followup = {
            "itemId": "followup-1", "type": "followup", "parentId": "task-1",
            "rootParentId": "project-1", "ownerId": "u3",
        }
        change = handler.public_realtime_change(handler.make_realtime_change(
            task, previous=task, affected_items=[followup],
            change_kind="deleted", deleted=True,
        ))
        self.assertEqual(change["itemId"], "task-1")
        self.assertEqual(set(change["itemIds"]), {"task-1", "followup-1"})
        self.assertTrue(change["deleted"])

    def test_change_outbox_put_uses_durable_change_partition(self):
        change = {
            "partitionKey": "CHANGE", "sortKey": "2026-11-02T00:00:00.000Z#chg-1",
            "changeId": "chg-1", "expiresAt": 1793577600,
        }
        put = handler.realtime_change_put(change)["Put"]
        self.assertEqual(put["TableName"], handler.REALTIME_TABLE.name)
        self.assertEqual(put["Item"]["partitionKey"], {"S": "CHANGE"})
        self.assertEqual(put["Item"]["changeId"], {"S": "chg-1"})
        self.assertIn("attribute_not_exists(#partitionKey)", put["ConditionExpression"])

    def test_change_query_uses_exclusive_cursor_and_returns_next_cursor(self):
        rows = [
            {"sortKey": "cursor-2", "changeId": "chg-2", "changeType": "items.changed", "itemId": "task-2"},
            {"sortKey": "cursor-3", "changeId": "chg-3", "changeType": "items.changed", "itemId": "task-3"},
        ]
        with patch.object(handler.REALTIME_TABLE, "query", return_value={
            "Items": rows, "LastEvaluatedKey": {"partitionKey": "CHANGE", "sortKey": "cursor-3"},
        }) as query_changes:
            result = handler.query_realtime_changes("cursor-1", 999)
        self.assertEqual([row["changeId"] for row in result["changes"]], ["chg-2", "chg-3"])
        self.assertEqual(result["nextCursor"], "cursor-3")
        self.assertTrue(result["hasMore"])
        query = query_changes.call_args.kwargs
        self.assertEqual(query["Limit"], handler.REALTIME_PAGE_SIZE)
        self.assertTrue(query["ConsistentRead"])
        built = ConditionExpressionBuilder().build_expression(query["KeyConditionExpression"], is_key_condition=True)
        self.assertIn(">", built.condition_expression)
        self.assertIn("cursor-1", built.attribute_value_placeholders.values())

    def test_change_query_with_empty_cursor_includes_first_outbox_event(self):
        rows = [{
            "sortKey": "2026-11-02T00:00:00.000Z#chg-first",
            "changeId": "chg-first",
            "changeType": "items.changed",
            "itemId": "task-first",
        }]
        with patch.object(handler.REALTIME_TABLE, "query", return_value={"Items": rows}) as query_changes:
            result = handler.query_realtime_changes("", 100)
        self.assertEqual([row["changeId"] for row in result["changes"]], ["chg-first"])
        self.assertEqual(result["nextCursor"], rows[0]["sortKey"])
        self.assertFalse(result["hasMore"])
        built = ConditionExpressionBuilder().build_expression(query_changes.call_args.kwargs["KeyConditionExpression"], is_key_condition=True)
        self.assertIn(">", built.condition_expression)
        self.assertIn("", built.attribute_value_placeholders.values())

    def test_ticket_creation_stores_only_hash_and_short_expiry(self):
        profile = {"userId": "u2"}
        with patch.object(handler.REALTIME_TABLE, "put_item") as put_ticket, \
             patch.object(handler, "latest_realtime_cursor", return_value="cursor-current"), \
             patch.object(handler, "epoch_seconds", return_value=1000):
            result = handler.create_realtime_ticket(profile)
        payload = json.loads(result["body"])
        self.assertEqual(result["statusCode"], 201)
        self.assertEqual(payload["expiresIn"], handler.REALTIME_TICKET_SECONDS)
        self.assertEqual(payload["cursor"], "cursor-current")
        item = put_ticket.call_args.kwargs["Item"]
        self.assertEqual(item["userId"], "u2")
        self.assertEqual(item["expiresAt"], 1000 + handler.REALTIME_TICKET_SECONDS)
        self.assertTrue(item["partitionKey"].startswith("TICKET#"))
        self.assertNotIn(payload["ticket"], item["partitionKey"])
        self.assertNotIn("ticket", item)

    def test_websocket_connect_consumes_single_use_ticket_transactionally(self):
        connection_event = {
            "requestContext": {"routeKey": "$connect", "connectionId": "connection-1"},
            "queryStringParameters": {"ticket": "opaque-single-use-ticket"},
        }
        ticket = {"userId": "u3", "expiresAt": handler.epoch_seconds() + 20}
        with patch.object(handler.REALTIME_TABLE, "get_item", return_value={"Item": ticket}) as get_ticket, \
             patch.object(handler.ddb.meta.client, "transact_write_items") as transact:
            result = handler.websocket_handler(connection_event)
        self.assertEqual(result["statusCode"], 200)
        get_ticket.assert_called_once()
        transaction = transact.call_args.kwargs["TransactItems"]
        self.assertEqual(len(transaction), 2)
        self.assertEqual(transaction[0]["Delete"]["TableName"], handler.REALTIME_TABLE.name)
        self.assertEqual(transaction[1]["Put"]["Item"]["connectionId"], {"S": "connection-1"})
        self.assertEqual(transaction[1]["Put"]["Item"]["userId"], {"S": "u3"})

    def test_websocket_connect_rejects_expired_or_missing_ticket(self):
        connection_event = {
            "requestContext": {"routeKey": "$connect", "connectionId": "connection-1"},
            "queryStringParameters": {"ticket": "expired-ticket"},
        }
        with patch.object(handler.REALTIME_TABLE, "get_item", return_value={"Item": {
            "userId": "u3", "expiresAt": handler.epoch_seconds() - 1,
        }}), patch.object(handler.ddb.meta.client, "transact_write_items") as transact:
            result = handler.websocket_handler(connection_event)
        self.assertEqual(result["statusCode"], 401)
        transact.assert_not_called()

    def test_websocket_ping_extends_connection_and_disconnect_removes_it(self):
        with patch.object(handler.REALTIME_TABLE, "update_item") as update, \
             patch.object(handler.REALTIME_TABLE, "delete_item") as delete, \
             patch.object(handler, "epoch_seconds", return_value=2000):
            ping = handler.websocket_handler({
                "requestContext": {"routeKey": "$default", "connectionId": "connection-7"},
                "body": json.dumps({"action": "ping"}),
            })
            disconnect = handler.websocket_handler({
                "requestContext": {"routeKey": "$disconnect", "connectionId": "connection-7"},
            })
        self.assertEqual(ping["statusCode"], 200)
        self.assertEqual(update.call_args.kwargs["ExpressionAttributeValues"][":expiresAt"], 2000 + handler.REALTIME_CONNECTION_TTL_SECONDS)
        self.assertEqual(disconnect["statusCode"], 200)
        self.assertEqual(delete.call_args.kwargs["Key"], {"partitionKey": "CONNECTION", "sortKey": "connection-7"})

    def test_change_publish_fans_out_only_compact_metadata_and_cleans_gone_connections(self):
        connections = [
            {"connectionId": "live-1", "expiresAt": handler.epoch_seconds() + 100},
            {"connectionId": "gone-1", "expiresAt": handler.epoch_seconds() + 100},
        ]
        management = SimpleNamespace(post_to_connection=unittest.mock.Mock(side_effect=[
            None,
            handler.ClientError({"Error": {"Code": "GoneException"}}, "PostToConnection"),
        ]))
        change = {
            "changeId": "chg-1", "sortKey": "cursor-1", "changeType": "items.changed",
            "changeKind": "updated", "itemId": "task-1", "rootParentIds": ["project-1"],
            "topLevelIds": [], "parentIds": ["project-1"], "assigneeIds": ["u2"],
            "deleted": False, "version": 4, "occurredAt": "2026-11-02T00:00:00.000Z",
        }
        with patch.object(handler, "all_pages", return_value=connections), \
             patch.object(handler.boto3, "client", return_value=management), \
             patch.object(handler.REALTIME_TABLE, "delete_item") as delete:
            handler.publish_realtime_change(change)
        self.assertEqual(management.post_to_connection.call_count, 2)
        message = json.loads(management.post_to_connection.call_args_list[0].kwargs["Data"])
        self.assertEqual(message["changeId"], "chg-1")
        self.assertEqual(message["assigneeIds"], ["u2"])
        self.assertNotIn("name", message)
        self.assertEqual(delete.call_count, 1)
        self.assertEqual(delete.call_args.kwargs["Key"]["sortKey"], "gone-1")

    def test_realtime_ticket_route_requires_authenticated_team_profile(self):
        event = {
            "rawPath": "/realtime/ticket",
            "requestContext": {
                "http": {"method": "POST"},
                "authorizer": {"jwt": {"claims": {"sub": "mapped-sub"}}},
            },
            "body": "{}",
        }
        with patch.object(handler, "current_profile", return_value={"userId": "u2"}) as profile_lookup, \
             patch.object(handler, "create_realtime_ticket", return_value=handler.response(201, {"ticket": "x"})) as create_ticket:
            result = handler.lambda_handler(event, SimpleNamespace(aws_request_id="realtime-ticket-test"))
        self.assertEqual(result["statusCode"], 201)
        profile_lookup.assert_called_once_with(event)
        create_ticket.assert_called_once_with({"userId": "u2"})

class CurrentPasswordVerificationTests(unittest.TestCase):
    claims = {"sub": "cognito-sub-u2"}
    profile = {"userId": "u2", "cognitoSub": "cognito-sub-u2", "enabled": True}
    username = "zyad@example.com"

    def call_verifier(self, body, cognito):
        with patch.object(handler, "COGNITO_USER_POOL_ID", "us-east-1_testpool"), \
             patch.object(handler, "COGNITO_CLIENT_ID", "public-test-client"), \
             patch.object(handler, "COGNITO_IDP", cognito):
            return handler.verify_current_password(body, self.claims, self.profile)

    @staticmethod
    def make_client_error(code):
        return handler.ClientError(
            {"Error": {"Code": code, "Message": "test response"}},
            "AdminInitiateAuth",
        )

    def test_valid_password_returns_boolean_only_and_binds_to_current_cognito_subject(self):
        cognito = SimpleNamespace()
        cognito.admin_get_user = unittest.mock.Mock(return_value={
            "Enabled": True,
            "UserAttributes": [{"Name": "sub", "Value": "cognito-sub-u2"}],
        })
        cognito.admin_initiate_auth = unittest.mock.Mock(return_value={
            "AuthenticationResult": {
                "AccessToken": "must-not-be-returned",
                "IdToken": "must-not-be-returned",
                "RefreshToken": "must-not-be-returned",
            },
        })

        result = self.call_verifier(
            {"username": self.username, "password": "correct-test-password"},
            cognito,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"]), {"valid": True})
        self.assertNotIn("must-not-be-returned", result["body"])
        cognito.admin_get_user.assert_called_once_with(
            UserPoolId="us-east-1_testpool", Username=self.username,
        )
        cognito.admin_initiate_auth.assert_called_once_with(
            UserPoolId="us-east-1_testpool",
            ClientId="public-test-client",
            AuthFlow="ADMIN_USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": self.username, "PASSWORD": "correct-test-password"},
        )

    def test_incorrect_password_returns_false_without_exposing_cognito_error(self):
        cognito = SimpleNamespace()
        cognito.admin_get_user = unittest.mock.Mock(return_value={
            "Enabled": True,
            "UserAttributes": [{"Name": "sub", "Value": "cognito-sub-u2"}],
        })
        cognito.admin_initiate_auth = unittest.mock.Mock(
            side_effect=self.make_client_error("NotAuthorizedException"),
        )

        result = self.call_verifier(
            {"username": self.username, "password": "wrong-test-password"},
            cognito,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"]), {"valid": False})
        self.assertNotIn("wrong-test-password", result["body"])
        self.assertNotIn("test response", result["body"])

    def test_username_mapped_to_another_subject_is_rejected_before_auth_attempt(self):
        cognito = SimpleNamespace()
        cognito.admin_get_user = unittest.mock.Mock(return_value={
            "Enabled": True,
            "UserAttributes": [{"Name": "sub", "Value": "somebody-else"}],
        })
        cognito.admin_initiate_auth = unittest.mock.Mock()

        result = self.call_verifier(
            {"username": self.username, "password": "any-test-password"},
            cognito,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"]), {"valid": False})
        cognito.admin_initiate_auth.assert_not_called()

    def test_malformed_request_is_rejected_without_cognito_calls(self):
        cognito = SimpleNamespace()
        cognito.admin_get_user = unittest.mock.Mock()
        cognito.admin_initiate_auth = unittest.mock.Mock()

        result = self.call_verifier(
            {"username": self.username, "password": "candidate", "extra": "not allowed"},
            cognito,
        )

        self.assertEqual(result["statusCode"], 400)
        cognito.admin_get_user.assert_not_called()
        cognito.admin_initiate_auth.assert_not_called()

    def test_disabled_or_unmapped_user_is_rejected_without_auth_attempt(self):
        cognito = SimpleNamespace()
        cognito.admin_get_user = unittest.mock.Mock(return_value={
            "Enabled": False,
            "UserAttributes": [{"Name": "sub", "Value": "cognito-sub-u2"}],
        })
        cognito.admin_initiate_auth = unittest.mock.Mock()

        result = self.call_verifier(
            {"username": self.username, "password": "candidate"},
            cognito,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"]), {"valid": False})
        cognito.admin_initiate_auth.assert_not_called()


class PinTransactionTests(unittest.TestCase):
    def test_pin_update_uses_transaction_scoped_users_write(self):
        profile = {"userId": "u2", "displayName": "Zyad", "cognitoSub": "cognito-sub-u2", "enabled": True}
        event = {
            "requestContext": {
                "http": {"method": "PATCH"},
                "authorizer": {"jwt": {"claims": {"sub": "cognito-sub-u2"}}},
            },
            "rawPath": "/users/me/pins",
            "body": json.dumps({"itemIds": ["project-1"]}),
        }
        with patch.object(handler, "current_profile", return_value=profile), \
             patch.object(handler.WORK, "get_item", return_value={"Item": {"itemId": "project-1"}}), \
             patch.object(handler.USERS, "get_item", return_value={"Item": {**profile, "pinnedItemIds": ["project-1"]}}), \
             patch.object(handler.ddb.meta.client, "transact_write_items") as transact:
            result = handler.lambda_handler(event, SimpleNamespace(aws_request_id="pin-test"))

        self.assertEqual(result["statusCode"], 200)
        payload = json.loads(result["body"])
        self.assertEqual(payload["user"]["pinnedItemIds"], ["project-1"])
        transact.assert_called_once()
        writes = transact.call_args.kwargs["TransactItems"]
        self.assertEqual(len(writes), 1)
        update = writes[0]["Update"]
        self.assertEqual(update["TableName"], handler.USERS.name)
        self.assertEqual(update["Key"], {"userId": {"S": "u2"}})
        self.assertEqual(update["ConditionExpression"], "attribute_exists(#userId)")
        self.assertEqual(update["ExpressionAttributeValues"][":pins"], {"L": [{"S": "project-1"}]})



class RealtimeAssigneeCoverageTests(unittest.TestCase):
    def test_project_metadata_update_targets_all_descendant_assignees(self):
        previous = {"itemId": "project-1", "type": "project", "name": "Old", "ownerId": "u1"}
        updated = {"itemId": "project-1", "type": "project", "name": "New", "ownerId": "u2"}
        descendants = [
            {"itemId": "task-1", "type": "task", "parentId": "project-1", "rootParentId": "project-1", "ownerId": "u3"},
            {"itemId": "followup-1", "type": "followup", "parentId": "task-1", "rootParentId": "project-1", "ownerId": "u4"},
        ]
        with patch.object(handler, "query_descendant_rows", return_value=descendants) as query:
            change = handler.make_realtime_change(updated, previous=previous, change_kind="updated")
        query.assert_called_once_with("project-1")
        self.assertEqual(set(change["assigneeIds"]), {"u1", "u2", "u3", "u4"})
        self.assertEqual(change["rootParentIds"], ["project-1"])

    def test_task_metadata_update_targets_assignees_of_its_followups(self):
        previous = {"itemId": "task-1", "type": "task", "parentId": "project-1", "rootParentId": "project-1", "ownerId": "u2"}
        updated = {**previous, "ownerId": "u3"}
        followups = [
            {"itemId": "followup-1", "type": "followup", "parentId": "task-1", "rootParentId": "project-1", "ownerId": "u4"},
        ]
        with patch.object(handler, "query_children_rows", return_value=followups) as query:
            change = handler.make_realtime_change(updated, previous=previous, change_kind="updated")
        query.assert_called_once_with("task-1")
        self.assertEqual(set(change["assigneeIds"]), {"u2", "u3", "u4"})


class ItemNameUniquenessTests(unittest.TestCase):
    def test_name_normalization_is_case_and_whitespace_insensitive(self):
        self.assertEqual(
            handler.normalize_item_name("  Network   Upgrade "),
            handler.normalize_item_name("network upgrade"),
        )
        self.assertEqual(
            handler.normalize_item_name("ＡＰＩ"),
            handler.normalize_item_name("api"),
        )

    def test_active_item_of_another_type_blocks_duplicate_name(self):
        active = {"itemId": "project-1", "type": "project", "name": "Network Upgrade"}
        with patch.object(handler, "scan_pages", side_effect=lambda table, **kwargs: [active] if table is handler.WORK else []), \
             patch.object(handler.REALTIME_TABLE, "get_item", return_value={}):
            with self.assertRaisesRegex(ValueError, "unique across Projects"):
                handler.item_name_write_operations({
                    "itemId": "task-2", "type": "task", "name": " network   upgrade ",
                })

    def test_archived_item_also_reserves_its_name(self):
        archived = {"archiveId": "followup-1", "type": "followup", "name": "Prepare Release"}
        with patch.object(handler, "scan_pages", side_effect=lambda table, **kwargs: [archived] if table is handler.ARCHIVE else []), \
             patch.object(handler.REALTIME_TABLE, "get_item", return_value={}):
            with self.assertRaisesRegex(ValueError, "unique across Projects"):
                handler.item_name_write_operations({
                    "itemId": "job-2", "type": "job", "name": "prepare release",
                })

    def test_name_reservation_is_conditional_and_can_be_released_on_rename(self):
        old = {"itemId": "task-1", "name": "Old Name"}
        def lookup(**kwargs):
            key = kwargs["Key"]
            if key["partitionKey"] == "ITEM_NAME#old name":
                return {"Item": {"itemId": "task-1"}}
            return {}
        with patch.object(handler, "scan_pages", return_value=[]), \
             patch.object(handler.REALTIME_TABLE, "get_item", side_effect=lookup):
            writes = handler.item_name_write_operations(
                {"itemId": "task-1", "name": "New Name"}, previous=old,
            )
        self.assertEqual(len(writes), 2)
        reservation = writes[0]["Put"]
        self.assertEqual(reservation["TableName"], handler.REALTIME_TABLE.name)
        self.assertEqual(reservation["Item"]["partitionKey"]["S"], "ITEM_NAME#new name")
        self.assertIn("attribute_not_exists(#partitionKey)", reservation["ConditionExpression"])
        self.assertIn("#itemId = :itemId", reservation["ConditionExpression"])
        self.assertEqual(writes[1]["Delete"]["Key"]["partitionKey"], {"S": "ITEM_NAME#old name"})

    def test_completed_registry_marker_avoids_repeated_full_table_scans(self):
        def lookup(**kwargs):
            if kwargs["Key"]["partitionKey"] == "ITEM_NAME_REGISTRY":
                return {"Item": {"version": 1}}
            return {}
        with patch.object(handler, "scan_pages") as scan, \
             patch.object(handler.REALTIME_TABLE, "get_item", side_effect=lookup):
            writes = handler.item_name_write_operations({
                "itemId": "task-1", "name": "Already Registered",
            })
        scan.assert_not_called()
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["Put"]["Item"]["partitionKey"]["S"], "ITEM_NAME#already registered")

    def test_commit_keeps_name_reservation_in_the_same_atomic_transaction(self):
        name_write = {"Put": {
            "TableName": handler.REALTIME_TABLE.name,
            "Item": handler.av_map({"partitionKey": "ITEM_NAME#task", "sortKey": "NAME", "itemId": "task-1"}),
            "ConditionExpression": "attribute_not_exists(#partitionKey)",
        }}
        with patch.object(handler.ddb.meta.client, "transact_write_items") as transact:
            handler.commit_item_with_events(
                {"itemId": "task-1", "name": "Task"},
                [], condition="create", name_writes=[name_write],
            )
        writes = transact.call_args.kwargs["TransactItems"]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[1]["Put"]["TableName"], handler.REALTIME_TABLE.name)





class MultiAssigneeTests(unittest.TestCase):
    def test_item_assignee_ids_preserves_multi_assignment_and_filters_root(self):
        self.assertEqual(
            handler.item_assignee_ids({
                "type": "task",
                "ownerId": "u1",
                "assigneeIds": ["u2", "root", "ROOT", "u3", "u2"],
            }),
            ["u2", "u3"],
        )
        self.assertEqual(
            handler.item_assignee_ids({"type": "project", "ownerId": "u4"}),
            ["u4"],
        )
        self.assertEqual(
            handler.item_assignee_ids({
                "type": "followup",
                "assigneeIds": ["u2", "u3"],
            }),
            ["u2", "u3"],
        )

    def test_index_work_item_keeps_first_assignee_in_legacy_owner_index(self):
        row = handler.index_work_item({
            "id": "task-multi",
            "type": "task",
            "parentId": "project-1",
            "ownerId": "u2",
            "assigneeIds": ["u2", "u3"],
            "updatedAt": "2026-11-06T08:00:00.000Z",
        })
        self.assertEqual(row["assigneeIds"], ["u2", "u3"])
        self.assertEqual(row["ownerId"], "u2")
        self.assertEqual(row["assignedTo"], "u2")

    def test_assignment_index_writes_one_durable_lookup_per_assignee(self):
        writes = handler.assignment_index_operations({
            "itemId": "task-multi",
            "type": "task",
            "ownerId": "u2",
            "assigneeIds": ["u2", "u3"],
            "updatedAt": "2026-11-06T08:00:00.000Z",
        })
        self.assertEqual(len(writes), 2)
        self.assertEqual(
            {write["Put"]["Item"]["partitionKey"]["S"] for write in writes},
            {"ASSIGNEE#u2", "ASSIGNEE#u3"},
        )
        self.assertTrue(all(write["Put"]["TableName"] == handler.REALTIME_TABLE.name for write in writes))
        self.assertTrue(all(write["Put"]["Item"]["sortKey"]["S"].endswith("#task-multi") for write in writes))

    def test_followup_assignment_index_writes_one_lookup_per_assignee(self):
        writes = handler.assignment_index_operations({
            "itemId": "followup-multi",
            "type": "followup",
            "assigneeMode": "selected",
            "ownerId": "u2",
            "assigneeIds": ["u2", "u3"],
            "updatedAt": "2026-11-06T08:00:00.000Z",
        })
        self.assertEqual(len(writes), 2)
        self.assertEqual(
            {write["Put"]["Item"]["partitionKey"]["S"] for write in writes},
            {"ASSIGNEE#u2", "ASSIGNEE#u3"},
        )

    def test_all_users_assignment_index_uses_global_marker_and_removes_it_on_mode_change(self):
        all_users = {
            "itemId": "task-all", "type": "task", "assigneeMode": "all",
            "assigneeIds": ["u1", "u2", "u3"], "ownerId": "u1",
            "updatedAt": "2026-11-06T08:00:00.000Z",
        }
        writes = handler.assignment_index_operations(all_users)
        self.assertEqual(len(writes), 1)
        marker = writes[0]["Put"]["Item"]
        self.assertEqual(marker["partitionKey"], {"S": "ASSIGNEE#ALL_USERS"})
        self.assertEqual(marker["itemId"], {"S": "task-all"})

        selected = {**all_users, "assigneeMode": "selected", "assigneeIds": ["u2"],
                    "ownerId": "u2", "updatedAt": "2026-11-06T08:05:00.000Z"}
        changes = handler.assignment_index_operations(selected, previous=all_users)
        deleted = [row["Delete"]["Key"] for row in changes if "Delete" in row]
        inserted = [row["Put"]["Item"] for row in changes if "Put" in row]
        self.assertEqual(deleted[0]["partitionKey"], {"S": "ASSIGNEE#ALL_USERS"})
        self.assertEqual(inserted[0]["partitionKey"], {"S": "ASSIGNEE#u2"})
        self.assertEqual(handler.item_assignee_ids({"assigneeMode": "none", "ownerId": "u2"}), [])

    def test_assignment_index_update_moves_old_and_new_assignee_keys_atomically(self):
        previous = {
            "itemId": "task-multi",
            "type": "task",
            "ownerId": "u2",
            "assigneeIds": ["u2"],
            "updatedAt": "2026-11-06T08:00:00.000Z",
        }
        updated = {
            **previous,
            "ownerId": "u2",
            "assigneeIds": ["u2", "u3"],
            "updatedAt": "2026-11-06T08:05:00.000Z",
        }
        writes = handler.assignment_index_operations(updated, previous=previous)
        self.assertEqual(len(writes), 3)
        deleted = [write["Delete"]["Key"] for write in writes if "Delete" in write]
        inserted = [write["Put"]["Item"] for write in writes if "Put" in write]
        self.assertEqual(deleted[0]["partitionKey"], {"S": "ASSIGNEE#u2"})
        self.assertEqual(
            {row["partitionKey"]["S"] for row in inserted},
            {"ASSIGNEE#u2", "ASSIGNEE#u3"},
        )

    def test_assigned_query_unions_legacy_primary_index_and_secondary_assignee_records(self):
        primary = {
            "itemId": "task-primary", "type": "task", "name": "Primary",
            "ownerId": "u2", "assigneeIds": ["u2"], "status": "not-started",
            "createdAt": "2026-11-06T07:00:00.000Z", "updatedAt": "2026-11-06T08:00:00.000Z",
        }
        secondary = {
            "itemId": "task-secondary", "type": "task", "name": "Secondary",
            "ownerId": "u1", "assigneeIds": ["u1", "u2"], "status": "in-progress",
            "createdAt": "2026-11-06T07:00:00.000Z", "updatedAt": "2026-11-06T08:05:00.000Z",
        }
        assignment = {"itemId": "task-secondary", "partitionKey": "ASSIGNEE#u2", "sortKey": "2026-11-06T08:05:00.000Z#task-secondary"}
        all_assignment = {"itemId": "task-all", "partitionKey": "ASSIGNEE#ALL_USERS", "sortKey": "2026-11-06T08:10:00.000Z#task-all"}
        all_item = {
            "itemId": "task-all", "type": "task", "name": "All users",
            "ownerId": "u1", "assigneeIds": ["u1", "u2"], "assigneeMode": "all",
            "status": "not-started", "createdAt": "2026-11-06T07:00:00.000Z",
            "updatedAt": "2026-11-06T08:10:00.000Z",
        }
        with (
            patch.object(handler, "all_pages", side_effect=[[primary], [assignment], [all_assignment]]),
            patch.object(handler.WORK, "get_item", side_effect=[{"Item": secondary}, {"Item": all_item}]),
        ):
            result = handler.query_work_items({"assigneeUserId": "u2"})
        self.assertEqual({item["id"] for item in result["items"]}, {"task-primary", "task-secondary", "task-all"})
        self.assertEqual(result["count"], 3)

    def test_status_filters_exclude_followups_without_status(self):
        rows = [
            {"itemId": "task-completed", "type": "task", "name": "Completed task", "status": "completed"},
            {"itemId": "task-open", "type": "task", "name": "Open task", "status": "in-progress"},
            # Legacy records may still carry status; they must not enter status-filtered results.
            {"itemId": "followup-legacy", "type": "followup", "name": "Legacy follow-up", "status": "completed"},
        ]
        with patch.object(handler, "query_children_rows", return_value=rows):
            completed = handler.query_work_items({"parentId": "project-1", "status": "completed"})
            not_completed = handler.query_work_items({"parentId": "project-1", "status": "not-completed"})
        self.assertEqual({item["id"] for item in completed["items"]}, {"task-completed"})
        self.assertEqual({item["id"] for item in not_completed["items"]}, {"task-open"})

    def test_validate_item_strips_legacy_status_and_due_date_from_followups(self):
        parent = {
            "itemId": "project-fields",
            "type": "project",
            "createdByUserId": "u1",
            "rootParentId": "project-fields",
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", return_value={"Item": {"userId": "u2", "enabled": True}}),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-fields",
                "type": "followup",
                "parentId": "project-fields",
                "name": "Follow-up without workflow fields",
                "assigneeMode": "selected",
                "assigneeIds": ["u2"],
                "status": "completed",
                "dueDate": "2026-11-12",
            })
        self.assertNotIn("status", item)
        self.assertNotIn("dueDate", item)

    def test_followup_to_task_conversion_restores_task_workflow_fields(self):
        parent = {
            "itemId": "project-conversion",
            "type": "project",
            "createdByUserId": "u1",
            "rootParentId": "project-conversion",
        }
        previous = {
            "itemId": "followup-conversion",
            "type": "followup",
            "parentId": "project-conversion",
            "rootParentId": "project-conversion",
            "name": "Converted work",
            "assigneeMode": "selected",
            "assigneeIds": ["u2"],
            "ownerId": "u2",
            "createdByUserId": "u1",
            "createdAt": "2026-11-06T08:00:00.000Z",
            "version": 1,
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", return_value={"Item": {"userId": "u2", "enabled": True}}),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-conversion",
                "type": "task",
                "parentId": "project-conversion",
                "name": "Converted work",
                "assigneeMode": "selected",
                "assigneeIds": ["u2"],
                "status": "in-progress",
                "dueDate": "2026-11-13",
            }, previous=previous)
        self.assertEqual(item["type"], "task")
        self.assertEqual(item["status"], "in-progress")
        self.assertEqual(item["dueDate"], "2026-11-13")

    def test_validate_item_allows_multiple_assignees_for_parent_items(self):
        def user_lookup(**kwargs):
            user_id = kwargs["Key"]["userId"]
            return {"Item": {"userId": user_id, "enabled": True}}
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.USERS, "get_item", side_effect=user_lookup),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "project-multi", "type": "project", "name": "Multi",
                "assigneeIds": ["u2", "u3"],
            })
        self.assertEqual(item["assigneeIds"], ["u2", "u3"])
        self.assertEqual(item["ownerId"], "u2")

    def test_due_date_queries_sort_earliest_first_and_exclude_followups(self):
        rows = [
            {"itemId": "task-later", "type": "task", "name": "Later", "dueDate": "2026-11-12"},
            {"itemId": "followup-legacy", "type": "followup", "name": "Legacy", "dueDate": "2026-11-09"},
            {"itemId": "task-near", "type": "task", "name": "Near", "dueDate": "2026-11-10"},
            {"itemId": "task-no-due", "type": "task", "name": "No due date"},
        ]
        with patch.object(handler, "query_children_rows", return_value=rows):
            result = handler.query_work_items({
                "parentId": "project-1",
                "dateMode": "due",
                "direction": "asc",
                "from": "2026-11-10",
                "to": "2026-11-12",
            })
        self.assertEqual([item["id"] for item in result["items"]], ["task-near", "task-later"])
        self.assertEqual(result["count"], 2)

    def test_validate_item_allows_none_for_projects_jobs_and_tasks(self):
        with patch.object(handler, "current_profile", return_value={"userId": "u1"}):
            item, _ = handler.validate_item({}, {
                "itemId": "project-none", "type": "project", "name": "Unassigned project",
                "assigneeMode": "none", "assigneeIds": [],
            })
        self.assertEqual(item["assigneeMode"], "none")
        self.assertEqual(item["assigneeIds"], [])
        self.assertIsNone(item["ownerId"])

    def test_validate_item_allows_none_assignees_for_followups(self):
        parent = {
            "itemId": "project-followup-none",
            "type": "project",
            "createdByUserId": "u1",
            "rootParentId": "project-followup-none",
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-none",
                "type": "followup",
                "parentId": "project-followup-none",
                "name": "Unassigned follow-up",
                "assigneeMode": "none",
                "assigneeIds": [],
            })
        self.assertEqual(item["assigneeMode"], "none")
        self.assertEqual(item["assigneeIds"], [])
        self.assertIsNone(item["ownerId"])

    def test_parent_with_active_children_cannot_be_set_to_not_started(self):
        previous = {
            "itemId": "project-has-child",
            "type": "project",
            "name": "Parent with child",
            "status": "in-progress",
            "createdByUserId": "u1",
            "createdAt": "2026-11-07T10:00:00.000Z",
            "version": 2,
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler, "has_active_children", return_value=True),
        ):
            with self.assertRaisesRegex(ValueError, "cannot have Not started status"):
                handler.validate_item({}, {
                    "itemId": "project-has-child",
                    "type": "project",
                    "name": "Parent with child",
                    "status": "not-started",
                }, previous=previous)

    def test_child_creation_prepares_atomic_parent_activation(self):
        parent = {
            "itemId": "task-parent",
            "type": "task",
            "status": "not-started",
            "version": 4,
            "rootParentId": "project-root",
        }
        audit = [{"eventId": "parent-status-event"}]
        change = {"changeId": "parent-status-change"}
        realtime_write = {"Put": {"TableName": "UnitTest-Realtime"}}
        with (
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler, "index_work_item", side_effect=lambda row: row),
            patch.object(handler, "build_audit_events", return_value=audit),
            patch.object(handler, "make_realtime_change", return_value=change),
            patch.object(handler, "realtime_change_put", return_value=realtime_write),
        ):
            result = handler.prepare_parent_activation_for_child(
                "task-parent", {"userId": "u1"}, "2026-11-07T12:00:00.000Z"
            )
        self.assertEqual(result["item"]["status"], "in-progress")
        self.assertEqual(result["item"]["version"], 5)
        self.assertEqual(result["events"], audit)
        self.assertEqual(result["change"], change)
        self.assertEqual(len(result["extra_writes"]), 3)
        self.assertIs(result["extra_writes"][-1], realtime_write)

    def test_validate_item_resolves_all_users_from_enabled_team_roster(self):
        roster = [
            {"userId": "u2", "enabled": True},
            {"userId": "u3", "enabled": True},
            {"userId": "u4", "enabled": False},
            {"userId": "root", "enabled": True, "role": "Root"},
        ]
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler, "scan_pages", return_value=roster),
            patch.object(handler.USERS, "get_item", side_effect=lambda **kwargs: {
                "Item": {"userId": kwargs["Key"]["userId"], "enabled": True}
            }),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "project-all", "type": "project", "name": "All team",
                "assigneeMode": "all", "assigneeIds": [],
            })
        self.assertEqual(item["assigneeMode"], "all")
        self.assertEqual(item["assigneeIds"], ["u2", "u3"])
        self.assertEqual(item["ownerId"], "u2")

    def test_followup_all_users_mode_resolves_enabled_team_roster(self):
        parent = {
            "itemId": "project-all",
            "type": "project",
            "createdByUserId": "u1",
            "rootParentId": "project-all",
        }
        roster = [
            {"userId": "u2", "enabled": True},
            {"userId": "u3", "enabled": True},
            {"userId": "u4", "enabled": False},
            {"userId": "root", "enabled": True, "role": "Root"},
        ]
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler, "scan_pages", return_value=roster),
            patch.object(handler.USERS, "get_item", side_effect=lambda **kwargs: {
                "Item": {"userId": kwargs["Key"]["userId"], "enabled": True}
            }),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-all", "type": "followup",
                "parentId": "project-all", "name": "All team follow-up",
                "assigneeMode": "all", "assigneeIds": [],
            })
        self.assertEqual(item["assigneeMode"], "all")
        self.assertEqual(item["assigneeIds"], ["u2", "u3"])
        self.assertEqual(item["ownerId"], "u2")

    def test_new_followup_defaults_to_creator_of_its_immediate_parent(self):
        parent = {
            "itemId": "project-creator",
            "type": "project",
            "createdByUserId": "u2",
            "rootParentId": "project-creator",
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", return_value={"Item": {"userId": "u2", "enabled": True}}),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-default",
                "type": "followup",
                "parentId": "project-creator",
                "name": "Follow-up",
            })
        self.assertEqual(item["assigneeIds"], ["u2"])
        self.assertEqual(item["ownerId"], "u2")
        self.assertEqual(item["assigneeMode"], "selected")

    def test_followup_allows_multiple_assignees_and_root_assignment_is_rejected(self):
        parent = {
            "itemId": "project-creator",
            "type": "project",
            "createdByUserId": "u2",
            "rootParentId": "project-creator",
        }

        def user_lookup(**kwargs):
            user_id = kwargs["Key"]["userId"]
            return {"Item": {"userId": user_id, "enabled": True}}

        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", side_effect=user_lookup),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-many", "type": "followup",
                "parentId": "project-creator", "name": "Follow-up",
                "assigneeMode": "selected", "assigneeIds": ["u2", "u3"],
            })
        self.assertEqual(item["assigneeIds"], ["u2", "u3"])
        self.assertEqual(item["ownerId"], "u2")
        self.assertEqual(item["assigneeMode"], "selected")
        with patch.object(handler, "current_profile", return_value={"userId": "u1"}):
            with self.assertRaisesRegex(ValueError, "root/system"):
                handler.validate_item({}, {
                    "itemId": "project-root-assignment", "type": "project",
                    "name": "Root assignment", "assigneeIds": ["root"],
                })

    def test_followup_edit_preserves_multiple_assignees_when_primary_changes(self):
        parent = {
            "itemId": "project-edit",
            "type": "project",
            "createdByUserId": "u1",
            "rootParentId": "project-edit",
        }
        previous = {
            "itemId": "followup-edit",
            "type": "followup",
            "parentId": "project-edit",
            "rootParentId": "project-edit",
            "name": "Existing follow-up",
            "status": "not-started",
            "priority": "medium",
            "assigneeMode": "selected",
            "assigneeIds": ["u2", "u3"],
            "ownerId": "u2",
            "createdByUserId": "u1",
            "createdAt": "2026-11-06T08:00:00.000Z",
            "version": 1,
        }

        def user_lookup(**kwargs):
            user_id = kwargs["Key"]["userId"]
            return {"Item": {"userId": user_id, "enabled": True}}

        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", side_effect=user_lookup),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-edit",
                "type": "followup",
                "parentId": "project-edit",
                "name": "Existing follow-up",
                # Older clients may still submit these legacy fields; the API
                # must strip them rather than persist them on a Follow-up.
                "status": "completed",
                "dueDate": "2026-11-10",
                "assigneeMode": "selected",
                "assigneeIds": ["u3", "u4"],
                "ownerId": "u3",
            }, previous=previous)

        self.assertEqual(item["assigneeIds"], ["u3", "u4"])
        self.assertEqual(item["ownerId"], "u3")
        self.assertEqual(item["assigneeMode"], "selected")
        self.assertNotIn("status", item)
        self.assertNotIn("dueDate", item)


    def test_validate_item_allows_multiple_assignees_for_tasks(self):
        parent = {
            "itemId": "project-tasks",
            "type": "project",
            "rootParentId": "project-tasks",
        }

        def user_lookup(**kwargs):
            user_id = kwargs["Key"]["userId"]
            return {"Item": {"userId": user_id, "enabled": True}}

        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", side_effect=user_lookup),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "task-multi",
                "type": "task",
                "parentId": "project-tasks",
                "name": "Task with multiple owners",
                "assigneeIds": ["u2", "u3"],
            })
        self.assertEqual(item["assigneeIds"], ["u2", "u3"])
        self.assertEqual(item["ownerId"], "u2")

    def test_new_followup_defaults_to_creator_of_task_parent(self):
        task = {
            "itemId": "task-parent",
            "type": "task",
            "parentId": "project-root",
            "rootParentId": "project-root",
            "createdByUserId": "u3",
        }
        project = {
            "itemId": "project-root",
            "type": "project",
            "rootParentId": "project-root",
        }

        def work_lookup(**kwargs):
            parent_id = kwargs["Key"]["itemId"]
            return {"Item": task if parent_id == "task-parent" else project}

        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", side_effect=work_lookup),
            patch.object(handler.USERS, "get_item", return_value={"Item": {"userId": "u3", "enabled": True}}),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-under-task",
                "type": "followup",
                "parentId": "task-parent",
                "name": "Follow-up under Task",
            })
        self.assertEqual(item["assigneeIds"], ["u3"])
        self.assertEqual(item["ownerId"], "u3")
        self.assertEqual(item["assigneeMode"], "selected")

    def test_new_followup_defaults_to_creator_of_job_parent(self):
        parent = {
            "itemId": "job-creator",
            "type": "job",
            "createdByUserId": "u4",
            "rootParentId": "job-creator",
        }
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.WORK, "get_item", return_value={"Item": parent}),
            patch.object(handler.USERS, "get_item", return_value={"Item": {"userId": "u4", "enabled": True}}),
        ):
            item, _ = handler.validate_item({}, {
                "itemId": "followup-under-job",
                "type": "followup",
                "parentId": "job-creator",
                "name": "Follow-up under Job",
            })
        self.assertEqual(item["assigneeIds"], ["u4"])
        self.assertEqual(item["ownerId"], "u4")
        self.assertEqual(item["assigneeMode"], "selected")

    def test_validate_item_rejects_system_role_even_when_id_is_not_root(self):
        with (
            patch.object(handler, "current_profile", return_value={"userId": "u1"}),
            patch.object(handler.USERS, "get_item", return_value={
                "Item": {"userId": "root-team-profile", "role": "Root", "enabled": True}
            }),
        ):
            with self.assertRaisesRegex(ValueError, "root/system"):
                handler.validate_item({}, {
                    "itemId": "project-root-role",
                    "type": "project",
                    "name": "Cannot assign system profile",
                    "assigneeIds": ["root-team-profile"],
                })



if __name__ == "__main__":
    unittest.main()
