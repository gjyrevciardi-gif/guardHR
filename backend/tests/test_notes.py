"""The host's private working notes: autosaved during the call, visible only to the host who owns the call."""

from sqlalchemy import select

from app.database import SessionLocal
from app.models import InterviewSession


def notes_url(data: dict) -> str:
    return f"/api/sessions/{data['id']}/notes"


def test_host_saves_notes_and_reads_them_back(client, hr, new_session):
    data = new_session(hr)
    assert client.get(f"/api/sessions/{data['id']}", headers=hr).json()["host_notes"] is None
    text = "Kandidati u prezantua mirë.\nPyetje: eksperienca me Postgres."
    saved = client.put(notes_url(data), headers=hr, json={"notes": text})
    assert saved.status_code == 200 and saved.json()["saved_at"]
    assert client.get(f"/api/sessions/{data['id']}", headers=hr).json()["host_notes"] == text


def test_saving_again_replaces_and_empty_clears(client, hr, new_session):
    data = new_session(hr)
    client.put(notes_url(data), headers=hr, json={"notes": "first"})
    client.put(notes_url(data), headers=hr, json={"notes": "second"})
    assert client.get(f"/api/sessions/{data['id']}", headers=hr).json()["host_notes"] == "second"
    client.put(notes_url(data), headers=hr, json={"notes": ""})
    assert client.get(f"/api/sessions/{data['id']}", headers=hr).json()["host_notes"] is None


def test_another_host_cannot_read_or_write_the_notes(client, hr, other_hr, new_session):
    data = new_session(hr)
    client.put(notes_url(data), headers=hr, json={"notes": "private"})
    assert client.put(notes_url(data), headers=other_hr, json={"notes": "overwritten"}).status_code == 404
    assert client.get(f"/api/sessions/{data['id']}", headers=other_hr).status_code == 404
    with SessionLocal() as db:
        assert db.scalar(select(InterviewSession.host_notes).where(InterviewSession.id == data["id"])) == "private"


def test_notes_need_a_login(client, hr, new_session):
    data = new_session(hr)
    assert client.put(notes_url(data), json={"notes": "x"}).status_code == 401


def test_notes_never_reach_the_candidate_or_the_list(client, hr, new_session):
    data = new_session(hr)
    client.put(notes_url(data), headers=hr, json={"notes": "SECRET-NOTE"})
    token = data["public_token"]
    assert "SECRET-NOTE" not in client.get(f"/api/public/sessions/{token}").text
    assert "SECRET-NOTE" not in client.post(f"/api/public/sessions/{token}/consent", json={"accepted": True}).text
    listed = client.get("/api/sessions", headers=hr)
    assert "SECRET-NOTE" not in listed.text and listed.json()[0]["host_notes"] is None


def test_notes_have_a_size_limit_and_unknown_calls_are_404(client, hr, new_session):
    data = new_session(hr)
    assert client.put(notes_url(data), headers=hr, json={"notes": "x" * 10001}).status_code == 422
    assert client.put(notes_url(data), headers=hr, json={"notes": "x" * 10000}).status_code == 200
    assert client.put("/api/sessions/not-a-uuid/notes", headers=hr, json={"notes": "x"}).status_code == 404
    assert client.put("/api/sessions/00000000-0000-0000-0000-000000000000/notes", headers=hr, json={"notes": "x"}).status_code == 404


def test_deleting_the_call_deletes_the_notes(client, hr, new_session):
    data = new_session(hr)
    client.put(notes_url(data), headers=hr, json={"notes": "to be removed"})
    assert client.delete(f"/api/sessions/{data['id']}", headers=hr).status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(InterviewSession.id).where(InterviewSession.id == data["id"])) is None
