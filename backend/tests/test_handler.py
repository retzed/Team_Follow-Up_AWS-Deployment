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
os.environ.setdefault("WORK_ITEMS_TABLE", "UnitTest-WorkItems")
os.environ.setdefault("ACTIVITY_TABLE", "UnitTest-ActivityEvents")
os.environ.setdefault("USER_PROFILES_TABLE", "UnitTest-UserProfiles")
os.environ.setdefault("ARCHIVE_TABLE", "UnitTest-Archive")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

import handler  # noqa: E402


class HandlerHelperTests(unittest.TestCase):
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
        self.assertEqual(row["listPK"], "TOP_LEVEL")
        self.assertEqual(row["rootPK"], "ROOT#project-1")
        self.assertTrue(row["updatedSort"].startswith("2026-10-14T11:00:00.000Z#"))

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
        self.assertEqual(row["listPK"], "PARENT#project-1")
        self.assertEqual(row["rootPK"], "ROOT#project-1")
        self.assertEqual(row["assigneePK"], "USER#u2")
        self.assertIn("assigneeCreatedSort", row)

    def test_activity_item_populates_all_timeline_indexes(self):
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
        self.assertEqual(row["itemPK"], "ITEM#task-1")
        self.assertEqual(row["applicationPK"], "APPLICATION")
        self.assertEqual(row["rootPK"], "ROOT#project-1")
        self.assertEqual(row["parentPK"], "PARENT#project-1")
        self.assertTrue(row["applicationSort"].endswith("#evt-1"))

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
            }
        )
        self.assertEqual(row["id"], "task-1")
        self.assertEqual(row["createdBy"], "u1")
        self.assertEqual(row["updatedBy"], "u2")
        for key in ("itemId", "listPK", "updatedSort", "rootPK", "assigneePK"):
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


if __name__ == "__main__":
    unittest.main()
