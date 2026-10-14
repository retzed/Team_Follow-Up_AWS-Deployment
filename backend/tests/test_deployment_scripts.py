"""Offline validation tests for deployment and data-migration helpers."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

import migrate_activity_application_index as activity_migration  # noqa: E402
import seed_user_profiles as manual_seed  # noqa: E402
import seed_user_profiles_from_cognito as cognito_seed  # noqa: E402


def valid_rows():
    return [
        {
            "userId": user_id,
            "displayName": name,
            "role": role,
            "cognitoSub": f"cognito-sub-{user_id}",
            "enabled": True,
        }
        for user_id, (name, role) in manual_seed.EXPECTED.items()
    ]


class ManualProfileSeederTests(unittest.TestCase):
    def test_normalizes_six_profiles_in_expected_order(self):
        normalized = manual_seed.normalize_profiles(list(reversed(valid_rows())))
        self.assertEqual([row["userId"] for row in normalized], list(manual_seed.EXPECTED))
        self.assertEqual(len({row["cognitoSub"] for row in normalized}), 6)

    def test_rejects_duplicate_or_missing_team_ids(self):
        rows = valid_rows()
        rows[-1]["userId"] = rows[0]["userId"]
        with self.assertRaisesRegex(ValueError, "exactly once"):
            manual_seed.normalize_profiles(rows)

    def test_rejects_non_object_rows_and_non_array_input(self):
        with self.assertRaisesRegex(ValueError, "array"):
            manual_seed.normalize_profiles({})
        rows = valid_rows()
        rows[0] = None
        with self.assertRaisesRegex(ValueError, "six profile objects"):
            manual_seed.normalize_profiles(rows)

    def test_rejects_placeholder_and_duplicate_cognito_subjects(self):
        rows = valid_rows()
        rows[0]["cognitoSub"] = "REPLACE_WITH_COGNITO_SUB"
        with self.assertRaisesRegex(ValueError, "no real cognitoSub"):
            manual_seed.normalize_profiles(rows)
        rows = valid_rows()
        rows[1]["cognitoSub"] = rows[0]["cognitoSub"]
        with self.assertRaisesRegex(ValueError, "unique Cognito sub"):
            manual_seed.normalize_profiles(rows)

    def test_rejects_non_boolean_enabled_values(self):
        rows = valid_rows()
        rows[0]["enabled"] = "false"
        with self.assertRaisesRegex(ValueError, "must be true or false"):
            manual_seed.normalize_profiles(rows)

    def test_loads_json_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mapping.json"
            path.write_text(json.dumps(valid_rows()), encoding="utf-8")
            self.assertEqual(len(manual_seed.load_profiles(path)), 6)


class FakePaginator:
    def __init__(self, users):
        self.users = users

    def paginate(self, **kwargs):
        self.kwargs = kwargs
        yield {"Users": self.users}


class FakeCognito:
    def __init__(self, users):
        self.paginator = FakePaginator(users)

    def get_paginator(self, operation):
        if operation != "list_users":
            raise AssertionError(f"Unexpected Cognito operation: {operation}")
        return self.paginator


def cognito_users():
    users = []
    for user_id, (name, role) in manual_seed.EXPECTED.items():
        users.append({
            "Username": f"login-{user_id}",
            "Enabled": user_id != "u6",
            "Attributes": [
                {"Name": "custom:teamUserId", "Value": user_id},
                {"Name": "sub", "Value": f"subject-{user_id}"},
            ],
        })
    return users


class CognitoProfileSeederTests(unittest.TestCase):
    def test_resolves_ids_and_preserves_enabled_flag(self):
        mapped = cognito_seed.list_team_users(FakeCognito(cognito_users()), "pool-id")
        self.assertEqual(set(mapped), set(manual_seed.EXPECTED))
        self.assertEqual(mapped["u2"]["cognitoSub"], "subject-u2")
        self.assertFalse(mapped["u6"]["enabled"])
        self.assertEqual(mapped["u1"]["displayName"], "Marwa")

    def test_rejects_duplicate_team_id(self):
        users = cognito_users()
        users.append(users[0])
        with self.assertRaisesRegex(ValueError, "More than one Cognito account"):
            cognito_seed.list_team_users(FakeCognito(users), "pool-id")

    def test_rejects_unsupported_team_id(self):
        users = cognito_users()
        users[0]["Attributes"][0]["Value"] = "u99"
        with self.assertRaisesRegex(ValueError, "unsupported custom:teamUserId"):
            cognito_seed.list_team_users(FakeCognito(users), "pool-id")

    def test_rejects_missing_team_member_or_missing_sub(self):
        users = cognito_users()[:-1]
        with self.assertRaisesRegex(ValueError, "No Cognito user was found"):
            cognito_seed.list_team_users(FakeCognito(users), "pool-id")
        users = cognito_users()
        users[0]["Attributes"] = [a for a in users[0]["Attributes"] if a["Name"] != "sub"]
        with self.assertRaisesRegex(ValueError, "has no sub attribute"):
            cognito_seed.list_team_users(FakeCognito(users), "pool-id")


class ActivityIndexMigrationTests(unittest.TestCase):
    def test_returns_expected_application_index_keys(self):
        result = activity_migration.application_index_values(
            {"eventId": "evt-1", "at": "2026-10-14T10:00:00.000Z"}
        )
        self.assertEqual(result, {
            "applicationPK": "APPLICATION",
            "applicationSort": "2026-10-14T10:00:00.000Z#evt-1",
        })

    def test_skips_rows_that_are_already_correctly_indexed(self):
        self.assertIsNone(activity_migration.application_index_values({
            "eventId": "evt-1",
            "at": "2026-10-14T10:00:00.000Z",
            "applicationPK": "APPLICATION",
            "applicationSort": "2026-10-14T10:00:00.000Z#evt-1",
        }))

    def test_fails_loudly_when_timestamp_is_missing(self):
        with self.assertRaisesRegex(ValueError, "missing its timestamp"):
            activity_migration.application_index_values({"eventId": "evt-1"})


if __name__ == "__main__":
    unittest.main()
