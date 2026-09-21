# EVALUATION FIXTURE - fictional code (pytest style; never executed by ReadySpec).
from taskboard.models import Task, User
from taskboard.permissions import can_edit_task


def test_assignee_creator_and_admin_can_edit():
    task = Task(id=1, title="t", creator="c", assignee="a")
    assert can_edit_task(User(username="a", email="x"), task)
    assert can_edit_task(User(username="c", email="x"), task)
    assert can_edit_task(User(username="z", email="x", role="admin"), task)
    assert not can_edit_task(User(username="z", email="x"), task)
