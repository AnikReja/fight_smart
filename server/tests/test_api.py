import pytest
from fastapi.testclient import TestClient

from fightsmart_api.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db"))


VIDEO = {"file_name": "round3.mp4", "size": 51759665, "last_modified": 1700000000000}
DATA = {
    "tags": [
        {"id": "a", "time": 1.5, "label": "Jab", "note": "", "fighter": "you", "outcome": "landed"},
        {"id": "b", "time": 2.0, "label": "Cross", "note": "hands low", "fighter": "you"},
        {"id": "c", "time": 0.5, "label": "Slip", "note": ""},
    ],
    "reviews": {"you:a:b": "confirmed"},
    "rounds": [{"id": "r1", "start": 0, "end": 180}, {"id": "r2", "start": 240}],
}


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True, "version": "1"}


def test_session_crud_and_counts(client):
    s = client.post("/api/sessions", json={"name": "Thursday sparring", "date": "2026-11-19", "opponent": "Ayan"})
    assert s.status_code == 201
    sid = s.json()["id"]
    assert s.json()["kind"] == "sparring"

    v = client.post("/api/videos", json={**VIDEO, "session_id": sid}).json()
    client.put(f"/api/videos/{v['id']}/data", json=DATA)

    listed = client.get("/api/sessions").json()
    assert listed[0]["video_count"] == 1 and listed[0]["tag_count"] == 3

    patched = client.patch(f"/api/sessions/{sid}", json={"notes": "worked the jab"}).json()
    assert patched["notes"] == "worked the jab" and patched["name"] == "Thursday sparring"

    detail = client.get(f"/api/sessions/{sid}").json()
    assert [x["tag_count"] for x in detail["videos"]] == [3]

    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert client.get(f"/api/sessions/{sid}").status_code == 404
    # Deleting a session keeps its videos and their data, just unassigned.
    kept = client.get(f"/api/videos/{v['id']}/data").json()
    assert len(kept["tags"]) == 3
    assert client.get("/api/videos").json()[0]["session_id"] is None


def test_register_video_is_idempotent(client):
    first = client.post("/api/videos", json=VIDEO)
    again = client.post("/api/videos", json={**VIDEO, "duration": 268.8})
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert again.json()["duration"] == 268.8
    other = client.post("/api/videos", json={**VIDEO, "size": 1})
    assert other.json()["id"] != first.json()["id"]


def test_save_and_load_round_trip_matches_app_format(client):
    vid = client.post("/api/videos", json=VIDEO).json()["id"]
    assert client.put(f"/api/videos/{vid}/data", json=DATA).json() == {"tags": 3, "rounds": 2, "reviews": 1}
    loaded = client.get(f"/api/videos/{vid}/data").json()
    assert [t["id"] for t in loaded["tags"]] == ["c", "a", "b"]  # sorted by time
    assert loaded["tags"][0] == {"id": "c", "time": 0.5, "label": "Slip", "note": ""}  # no null fields
    assert loaded["rounds"][1] == {"id": "r2", "start": 240.0}
    assert loaded["reviews"] == {"you:a:b": "confirmed"}

    # PUT replaces: deleted items disappear.
    client.put(f"/api/videos/{vid}/data", json={"tags": DATA["tags"][:1], "reviews": {}, "rounds": []})
    loaded = client.get(f"/api/videos/{vid}/data").json()
    assert len(loaded["tags"]) == 1 and loaded["rounds"] == [] and loaded["reviews"] == {}


def test_same_tag_ids_in_two_videos_do_not_collide(client):
    v1 = client.post("/api/videos", json=VIDEO).json()["id"]
    v2 = client.post("/api/videos", json={**VIDEO, "file_name": "copy.mp4"}).json()["id"]
    assert client.put(f"/api/videos/{v1}/data", json=DATA).status_code == 200
    assert client.put(f"/api/videos/{v2}/data", json=DATA).status_code == 200


@pytest.mark.parametrize("bad", [
    {"tags": [{"id": "a", "time": -1, "label": "Jab"}]},
    {"tags": [{"id": "a", "time": 1, "label": "Jab", "fighter": "referee"}]},
    {"tags": [{"id": "a:b", "time": 1, "label": "Jab"}]},
    {"tags": [{"id": "a", "time": 1, "label": "Jab"}, {"id": "a", "time": 2, "label": "Jab"}]},
    {"rounds": [{"id": "r", "start": 10, "end": 5}]},
    {"reviews": {"you:a:b": "maybe"}},
])
def test_invalid_data_is_rejected_and_nothing_is_saved(client, bad):
    vid = client.post("/api/videos", json=VIDEO).json()["id"]
    client.put(f"/api/videos/{vid}/data", json=DATA)
    assert client.put(f"/api/videos/{vid}/data", json=bad).status_code == 422
    assert len(client.get(f"/api/videos/{vid}/data").json()["tags"]) == 3  # previous data untouched


def test_assigning_videos_and_not_found_errors(client):
    sid = client.post("/api/sessions", json={"name": "Scouting: Ayan", "kind": "scouting"}).json()["id"]
    vid = client.post("/api/videos", json=VIDEO).json()["id"]
    assert client.patch(f"/api/videos/{vid}", json={"session_id": sid}).json()["session_id"] == sid
    assert [v["id"] for v in client.get(f"/api/videos?session_id={sid}").json()] == [vid]
    assert client.patch(f"/api/videos/{vid}", json={"clear_session": True}).json()["session_id"] is None
    assert client.patch(f"/api/videos/{vid}", json={"session_id": 999}).status_code == 422
    assert client.get("/api/videos/999/data").status_code == 404
    assert client.post("/api/sessions", json={"name": ""}).status_code == 422
    assert client.post("/api/sessions", json={"name": "x", "date": "19/11/2026"}).status_code == 422


def test_data_survives_restart(tmp_path):
    path = tmp_path / "persist.db"
    c1 = TestClient(create_app(path))
    vid = c1.post("/api/videos", json=VIDEO).json()["id"]
    c1.put(f"/api/videos/{vid}/data", json=DATA)
    c2 = TestClient(create_app(path))  # a fresh server process on the same file
    assert len(c2.get(f"/api/videos/{vid}/data").json()["tags"]) == 3
