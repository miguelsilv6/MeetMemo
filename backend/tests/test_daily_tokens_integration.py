"""
Daily tokens end to end against a real PostgreSQL database: uploads spend the
day's quota first and the extra balance after it, the quota is full again the
next day and never accumulates, refunds go back where the token came from
(the quota only while it is still the same day), the panel's default applies
to users without their own quota, and concurrent uploads never overspend.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import asyncio
import json
import uuid as uuid_lib
from contextlib import asynccontextmanager

import pytest

from tests.test_tokens_integration import (
    ADMIN_HEADERS,
    ADMIN_PASSWORD,
    HEADERS,
    PASSWORD,
    TEST_DATABASE_URL,
    _load,
    _reset_database,
    _settings,
)

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)


def test_daily_tokens_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.job_repository import JobRepository
    from repositories.user_repository import UserRepository
    from services.audio_service import AudioService

    routers = {name: _load(name) for name in ("auth", "admin", "projects")}

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        # An unknown zone falls back to Lisbon; a valid one replaces it.
        await database.ensure_tokens_schema("Not/AZone")
        await database.ensure_tokens_schema("UTC")
        await database.require_owners()
        await database.ensure_admin_schema()
        await AdminRepository().create_credentials_if_missing(
            "admin", hash_password(ADMIN_PASSWORD)
        )
        yield
        await database.close_database()

    app = FastAPI(lifespan=lifespan)
    for module in routers.values():
        app.include_router(module.router, prefix="/api/v1")
        if hasattr(module, "get_settings"):
            app.dependency_overrides[module.get_settings] = lambda: settings
    app.dependency_overrides[routers["projects"].get_audio_service] = (
        lambda: AudioService(settings, JobRepository())
    )

    with TestClient(app) as client:

        def run(coro):
            async def call():
                return await coro

            return client.portal.call(call)

        async def sql(query, *args):
            async with database.get_db() as conn:
                return await conn.fetchval(query, *args)

        def cookie_of(response, name):
            token = response.cookies.get(name)
            client.cookies.clear()
            assert token
            return {"Cookie": f"{name}={token}"}

        # The quota is dated in the configured zone.
        assert run(sql("SELECT tokens_today() = (NOW() AT TIME ZONE 'UTC')::date"))

        admin = cookie_of(client.post(
            "/api/v1/admin/login", json={"username": "admin", "password": ADMIN_PASSWORD},
            headers=ADMIN_HEADERS,
        ), "meetmemo_admin")
        admin_headers = {**admin, **ADMIN_HEADERS}

        # --- Ana: her own quota of 2 a day and 1 extra token -------------------
        created = client.post("/api/v1/admin/users", headers=admin_headers, json={
            "username": "ana", "display_name": "Ana", "password": "temporary password",
            "initial_tokens": 1, "daily_token_quota": 2,
        }).json()
        ana_uuid = str(created["uuid"])
        assert (created["daily_token_quota"], created["daily_quota"], created["daily_used"]) == (
            2, 2, 0
        )
        run(UserRepository().set_password(ana_uuid, hash_password(PASSWORD), must_change=False))
        ana = cookie_of(client.post("/api/v1/auth/login", headers=HEADERS,
                                    json={"username": "ana", "password": PASSWORD}),
                        "meetmemo_session")
        ana_headers = {**ana, **HEADERS}

        def tokens():
            me = client.get("/api/v1/auth/me", headers=ana).json()
            return me["daily_used"], me["daily_quota"], me["token_balance"]

        def ledger():
            return client.get(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin).json()

        assert tokens() == (0, 2, 1)
        me_admin = client.get("/api/v1/auth/me", headers=admin).json()
        assert (me_admin["daily_quota"], me_admin["daily_used"]) == (None, None)

        pid = client.post("/api/v1/projects", json={"name": "Caso"},
                          headers=ana_headers).json()["uuid"]

        def upload(name, content):
            response = client.post(
                f"/api/v1/projects/{pid}/audios", headers=ana_headers,
                files=[("files", (name, content, "audio/wav"))],
            )
            assert response.status_code == 200, response.text
            return response.json()["results"][0]

        # --- The day's quota first, then the extra balance, then nothing -------
        first = upload("a.wav", b"RIFF-a")
        assert (first["status"], tokens()) == ("queued", (1, 2, 1))
        second = upload("b.wav", b"RIFF-b")
        assert tokens() == (2, 2, 1)
        third = upload("c.wav", b"RIFF-c")
        assert tokens() == (2, 2, 0)
        assert upload("d.wav", b"RIFF-d")["status"] == "no_tokens"
        pools = [(t["reason"], t["pool"]) for t in reversed(ledger()["transactions"])]
        assert pools == [("grant", "balance"), ("charge", "daily"), ("charge", "daily"),
                         ("charge", "balance")]

        # --- Refunds go back where the token came from --------------------------
        run(database.update_workflow_state(third["uuid"], "error", 0))
        assert tokens() == (2, 2, 1)
        run(database.update_workflow_state(second["uuid"], "error", 0))
        assert tokens() == (1, 2, 1)

        # --- A new day: the quota is full again and never accumulates -----------
        run(sql("UPDATE users SET daily_tokens_day = daily_tokens_day - 1 WHERE uuid = $1",
                ana_uuid))
        assert tokens() == (0, 2, 1)
        # Yesterday's daily token is not given back once the quota renewed...
        run(database.update_workflow_state(first["uuid"], "error", 0))
        assert tokens() == (0, 2, 1)
        assert not [t for t in ledger()["transactions"]
                    if t["reason"] == "refund" and t["job_uuid"] == first["uuid"]]
        # ...and the new day's uploads start from the full quota.
        upload("e.wav", b"RIFF-e")
        assert tokens() == (1, 2, 1)

        # The extra balance still adds up to its ledger rows.
        data = ledger()
        extra = [t for t in data["transactions"] if t["pool"] == "balance"]
        assert sum(t["delta"] for t in extra) == data["token_balance"] == 1
        assert all(t["quota_day"] for t in data["transactions"] if t["pool"] == "daily")

        # --- The panel's default applies to users without their own quota -------
        def set_default(value):
            run(sql(
                """INSERT INTO runtime_settings (id, data) VALUES (1, $1::jsonb)
                   ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data""",
                json.dumps({"default_daily_tokens": value}),
            ))

        set_default(5)
        assert tokens() == (1, 2, 1)  # her own quota wins
        response = client.put(f"/api/v1/admin/users/{ana_uuid}/daily-quota",
                              headers=admin_headers, json={"daily_token_quota": None})
        assert response.status_code == 200
        assert response.json()["daily_token_quota"] is None
        assert tokens() == (1, 5, 1)
        set_default(0)
        assert tokens() == (1, 0, 1)
        users = client.get("/api/v1/admin/users", headers=admin).json()
        assert users[0]["daily_quota"] == 0 and users[0]["daily_token_quota"] is None

        # 0 turns the quota off for that account, whatever the default.
        set_default(5)
        client.put(f"/api/v1/admin/users/{ana_uuid}/daily-quota",
                   headers=admin_headers, json={"daily_token_quota": 0})
        assert tokens() == (1, 0, 1)
        # Out of range or missing values are refused.
        for bad in ({"daily_token_quota": -1}, {"daily_token_quota": 10001}, {}):
            assert client.put(f"/api/v1/admin/users/{ana_uuid}/daily-quota",
                              headers=admin_headers, json=bad).status_code == 422
        audit = client.get("/api/v1/admin/audit", headers=admin).json()
        changes = [(e["old_value"], e["new_value"]) for e in audit
                   if e["setting_key"] == "user_daily_tokens"]
        assert changes == [(None, 0), (2, None), (None, 2)]

        # --- Concurrent uploads never overspend the quota -----------------------
        client.put(f"/api/v1/admin/users/{ana_uuid}/daily-quota",
                   headers=admin_headers, json={"daily_token_quota": 2})
        client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                    json={"delta": -1})
        assert tokens() == (1, 2, 0)

        async def race():
            async def one(i):
                try:
                    await database.add_job(str(uuid_lib.uuid4()), f"r{i}.wav", 202, f"h{i}",
                                           user_uuid=ana_uuid, charge=True)
                    return "ok"
                except database.InsufficientTokensError:
                    return "refused"
            return sorted(await asyncio.gather(*(one(i) for i in range(5))))

        assert run(race()) == ["ok", "refused", "refused", "refused", "refused"]
        assert tokens() == (2, 2, 0)
        assert run(sql("SELECT daily_tokens_used FROM users WHERE uuid = $1", ana_uuid)) == 2

        # A single upload checks quota plus balance before storing the file.
        from access import tokens_available
        assert tokens_available({"daily_quota": 2, "daily_used": 2, "token_balance": 0}) == 0
        assert tokens_available({"daily_quota": 3, "daily_used": 1, "token_balance": 4}) == 6
        assert tokens_available(None) == 0
