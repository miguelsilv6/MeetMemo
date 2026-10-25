"""
Cue points against a real PostgreSQL database: an audio's owner marks
instants with notes, changes and removes them; another user sees none of it;
an audio holds at most 200; a cue point id only works through its own audio;
and deleting the audio deletes its cue points.

Skipped unless MEETMEMO_TEST_DATABASE_URL points at a disposable database (the
database is reset first; see test_tokens_integration).
"""
import uuid as uuid_lib
from contextlib import asynccontextmanager

import pytest

from tests.test_tokens_integration import (
    ADMIN_PASSWORD,
    HEADERS,
    TEST_DATABASE_URL,
    _load,
    _reset_database,
    _settings,
)

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="MEETMEMO_TEST_DATABASE_URL not set"
)


def test_cue_points_against_real_postgres(monkeypatch, tmp_path):
    # pylint: disable=import-outside-toplevel,too-many-locals,too-many-statements
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _reset_database()
    settings = _settings(tmp_path)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)

    import database
    from admin_auth import hash_password
    from repositories.admin_repository import AdminRepository
    from repositories.cue_point_repository import CuePointRepository
    from repositories.user_repository import UserRepository
    from services.user_service import UserService

    routers = {name: _load(name) for name in ("auth", "cue_points")}

    @asynccontextmanager
    async def lifespan(_app):
        await database.init_database()
        await database.ensure_projects_schema()
        await database.ensure_users_schema()
        await database.ensure_tokens_schema()
        await database.ensure_cue_points_schema()
        await database.ensure_cue_points_schema()  # idempotent on an existing schema
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

    with TestClient(app) as client:

        def run(coro):
            async def call():
                return await coro

            return client.portal.call(call)

        def login(username, password):
            response = client.post("/api/v1/auth/login", headers=HEADERS,
                                   json={"username": username, "password": password})
            assert response.status_code == 200, response.text
            cookies = dict(response.cookies.items())
            client.cookies.clear()
            return {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()), **HEADERS}

        users = {}
        for name in ("ana", "bruno"):
            created = run(UserService(settings).create(name, name.title(), f"{name} password 1"))
            run(UserRepository().set_password(
                str(created["uuid"]), hash_password(f"{name} password 1"), must_change=False))
            users[name] = str(created["uuid"])
        ana = login("ana", "ana password 1")
        bruno = login("bruno", "bruno password 1")
        admin = login("admin", ADMIN_PASSWORD)

        def new_job(file_name):
            job_uuid = str(uuid_lib.uuid4())
            run(database.add_job(job_uuid, file_name, 200, f"h-{job_uuid}",
                                 user_uuid=users["ana"]))
            return job_uuid

        job = new_job("call.wav")
        other = new_job("other.wav")
        base = f"/api/v1/jobs/{job}/cue-points"

        # --- The owner marks instants, in any order; they come back in time order
        assert client.get(base, headers=ana).json() == []
        late = client.post(base, headers=ana, json={"position_seconds": 75.5,
                                                    "note": "  menciona a morada  "})
        assert late.status_code == 201, late.text
        assert late.json()["note"] == "menciona a morada"
        assert late.json()["created_by"] == "ana"
        early = client.post(base, headers=ana, json={"position_seconds": 12.25})
        assert (early.status_code, early.json()["note"]) == (201, "")
        listed = client.get(base, headers=ana).json()
        assert [(c["position_seconds"], c["note"]) for c in listed] == [
            (12.25, ""), (75.5, "menciona a morada")]

        # --- Notes change; the change is dated ----------------------------------
        cue = early.json()["id"]
        changed = client.patch(f"{base}/{cue}", headers=ana, json={"note": "pede dinheiro"})
        assert changed.status_code == 200
        assert changed.json()["note"] == "pede dinheiro"
        assert changed.json()["updated_at"] >= changed.json()["created_at"]

        # --- Invalid input is refused --------------------------------------------
        for body in ({"position_seconds": -1}, {"position_seconds": 10, "note": "x" * 501},
                     {"note": "sem instante"}):
            assert client.post(base, headers=ana, json=body).status_code == 422
        assert client.patch(f"{base}/0", headers=ana, json={"note": "x"}).status_code == 422

        # --- Another user sees and changes nothing; the administrator sees all ---
        assert client.get(base, headers=bruno).status_code == 404
        assert client.post(base, headers=bruno,
                           json={"position_seconds": 1}).status_code == 404
        assert client.delete(f"{base}/{cue}", headers=bruno).status_code == 404
        assert len(client.get(base, headers=admin).json()) == 2

        # --- A cue point id only works through its own audio ----------------------
        other_base = f"/api/v1/jobs/{other}/cue-points"
        assert client.patch(f"{other_base}/{cue}", headers=ana,
                            json={"note": "x"}).status_code == 404
        assert client.delete(f"{other_base}/{cue}", headers=ana).status_code == 404
        assert client.get(other_base, headers=ana).json() == []

        # --- Removing ------------------------------------------------------------
        assert client.delete(f"{base}/{cue}", headers=ana).status_code == 204
        assert client.delete(f"{base}/{cue}", headers=ana).status_code == 404
        assert [c["note"] for c in client.get(base, headers=ana).json()] == [
            "menciona a morada"]

        # --- An audio holds at most 200 --------------------------------------------
        for i in range(199):
            run(CuePointRepository().create(other, float(i), "", "ana"))
        assert client.post(other_base, headers=ana,
                           json={"position_seconds": 500}).status_code == 201
        full = client.post(other_base, headers=ana, json={"position_seconds": 501})
        assert full.status_code == 409

        # --- Deleting the audio deletes its cue points ---------------------------
        run(database.delete_job(other))

        async def remaining():
            async with database.get_db() as conn:
                return await conn.fetchval(
                    "SELECT COUNT(*) FROM cue_points WHERE job_uuid = $1", other)

        assert run(remaining()) == 0
        assert len(client.get(base, headers=ana).json()) == 1
