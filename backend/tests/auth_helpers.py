"""Sign a test app's requests in, for router tests that are not about access."""
import access

REQUEST_HEADERS = {"X-MeetMemo-Request": "1"}


def sign_in(app, principal=None):
    """Every request of `app` is made by `principal` (the administrator by default)."""
    principal = principal or access.Principal(username="admin", is_admin=True)
    app.dependency_overrides[access.get_session_principal] = lambda: principal
    return principal
