"""Unit tests for pure API-boundary helpers; no AWS account is required."""

import base64
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("ITEMS_TABLE", "UnitTest-Items")
os.environ.setdefault("ACTIVITY_TABLE", "UnitTest-Activity")
os.environ.setdefault("USERS_TABLE", "UnitTest-Users")
os.environ.setdefault("ARCHIVE_TABLE", "UnitTest-Archive")
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
        self.assertEqual(payload, {"items": parents, "users": [{"id": "u1", "name": "Marwa", "nameArabic": "", "role": "Team Leader", "roleArabic": "", "icon": "user", "privilege": "Administrator", "enabled": True}]})
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
            "label": "Cloud Engineer", "labelArabic": "مهندس سحابة", "enabled": True,
        }
        profile = handler.public_team_user(row, include_private=True)
        self.assertEqual(profile["name"], "Zyad")
        self.assertEqual(profile["nameArabic"], "زياد")
        self.assertEqual(profile["role"], "Cloud Engineer")
        self.assertEqual(profile["roleArabic"], "مهندس سحابة")

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
        self.assertEqual(handler.normalize_profile_updates({"icon": "hard-hat"}, actor, target)["icon"], "hard-hat")
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


if __name__ == "__main__":
    unittest.main()
