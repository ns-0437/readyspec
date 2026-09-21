# EVALUATION FIXTURE - fictional code (pytest style; never executed by ReadySpec).
import pytest

from taskboard.models import User
from taskboard.notifications import SENT
from taskboard.tasks import assign_task, create_task


def test_assign_replaces_assignee_and_notifies():
    a = User(username="a", email="a@demo.invalid")
    b = User(username="b", email="b@demo.invalid")
    task = create_task(a, "write docs")
    assign_task(a, task, b)
    assert task.assignee == "b"
    assert ("b", "You were assigned 'write docs'") in SENT


def test_outsider_cannot_assign():
    a = User(username="a", email="a@demo.invalid")
    z = User(username="z", email="z@demo.invalid")
    task = create_task(a, "x")
    with pytest.raises(PermissionError):
        assign_task(z, task, z)
