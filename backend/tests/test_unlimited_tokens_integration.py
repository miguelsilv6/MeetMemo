"""
Unlimited tokens against a real PostgreSQL database: the administrator marks
an account as unlimited, its uploads are then never charged (nor refunded)
whatever its balance and quota, which stay as they were and count again once
the mark is removed; only the administrator can change it, and each change is
in the audit trail.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database, e.g.
    MEETMEMO_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/meetmemo_test
The database is reset (all MeetMemo tables dropped) before the test runs.
"""
import math
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


def test_unlimited_tokens_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from access import tokens_available
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
        await database.ensure_tokens_schema("UTC")
        await database.ensure_tokens_schema("UTC")  # idempotent
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

        def cookie_of(response, name):
            token = response.cookies.get(name)
            client.cookies.clear()
            assert token
            return {"Cookie": f"{name}={token}"}

        admin = cookie_of(client.post(
            "/api/v1/admin/login", json={"username": "admin", "password": ADMIN_PASSWORD},
            headers=ADMIN_HEADERS,
        ), "meetmemo_admin")
        admin_headers = {**admin, **ADMIN_HEADERS}

        # --- Ana: no daily quota and 1 extra token ------------------------------
        created = client.post("/api/v1/admin/users", headers=admin_headers, json={
            "username": "ana", "display_name": "Ana", "password": "temporary password",
            "initial_tokens": 1,
        }).json()
        ana_uuid = str(created["uuid"])
        assert created["unlimited_tokens"] is False
        run(UserRepository().set_password(ana_uuid, hash_password(PASSWORD), must_change=False))
        ana = cookie_of(client.post("/api/v1/auth/login", headers=HEADERS,
                                    json={"username": "ana", "password": PASSWORD}),
                        "meetmemo_session")
        ana_headers = {**ana, **HEADERS}

        def me():
            return client.get("/api/v1/auth/me", headers=ana).json()

        def ledger():
            return client.get(f"/api/v1/admin/users/{ana_uuid}/tokens",
                              headers=admin).json()["transactions"]

        def set_unlimited(value, headers=admin_headers):
            return client.put(f"/api/v1/admin/users/{ana_uuid}/unlimited-tokens",
                              headers=headers, json={"unlimited_tokens": value})

        assert me()["unlimited_tokens"] is False
        assert client.get("/api/v1/auth/me", headers=admin).json()["unlimited_tokens"] is None

        pid = client.post("/api/v1/projects", json={"name": "Caso"},
                          headers=ana_headers).json()["uuid"]

        def upload(name):
            response = client.post(
                f"/api/v1/projects/{pid}/audios", headers=ana_headers,
                files=[("files", (name, f"RIFF-{name}".encode(), "audio/wav"))],
            )
            assert response.status_code == 200, response.text
            return response.json()["results"][0]

        upload("a.wav")
        assert me()["token_balance"] == 0
        assert upload("b.wav")["status"] == "no_tokens"

        # --- Only the administrator marks an account as unlimited --------------
        assert set_unlimited(True, ana_headers).status_code in (401, 403)
        assert client.put(f"/api/v1/admin/users/{uuid_lib.uuid4()}/unlimited-tokens",
                          headers=admin_headers,
                          json={"unlimited_tokens": True}).status_code == 404
        assert client.put(f"/api/v1/admin/users/{ana_uuid}/unlimited-tokens",
                          headers=admin_headers, json={}).status_code == 422
        response = set_unlimited(True)
        assert response.status_code == 200, response.text
        assert response.json()["unlimited_tokens"] is True
        assert me()["unlimited_tokens"] is True
        listed = client.get("/api/v1/admin/users", headers=admin).json()
        assert listed[0]["unlimited_tokens"] is True

        # --- Unlimited: uploads go through with no token and no charge ---------
        charges_before = len(ledger())
        results = [upload(f"u{i}.wav") for i in range(3)]
        assert [r["status"] for r in results] == ["queued"] * 3
        job = str(uuid_lib.uuid4())
        run(database.add_job(job, "single.wav", 202, "h-single", user_uuid=ana_uuid,
                             charge=True))
        assert (me()["token_balance"], len(ledger())) == (0, charges_before)
        assert tokens_available(run(UserRepository().get(ana_uuid))) == math.inf
        # A failure has nothing to give back.
        run(database.update_workflow_state(results[0]["uuid"], "error", 0))
        run(database.update_workflow_state(job, "error", 0))
        assert (me()["token_balance"], len(ledger())) == (0, charges_before)

        # Asking again changes nothing (and is not audited twice).
        assert set_unlimited(True).status_code == 200

        # --- Removing it: the balance counts again ------------------------------
        client.post(f"/api/v1/admin/users/{ana_uuid}/tokens", headers=admin_headers,
                    json={"delta": 1})
        assert set_unlimited(False).json()["unlimited_tokens"] is False
        assert upload("c.wav")["status"] == "queued"
        assert me()["token_balance"] == 0
        assert upload("d.wav")["status"] == "no_tokens"
        assert ledger()[0]["reason"] == "charge"

        audit = client.get("/api/v1/admin/audit", headers=admin).json()
        toggles = [(e["setting_key"], e["new_value"]) for e in audit
                   if e["setting_key"].startswith("user_unlimited")]
        assert toggles == [("user_unlimited_off", "ana"), ("user_unlimited_on", "ana")]
