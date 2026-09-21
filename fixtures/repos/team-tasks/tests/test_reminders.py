# EVALUATION FIXTURE - fictional code (pytest style; never executed by ReadySpec).
from datetime import datetime, timedelta

from taskboard.models import Task, User
from taskboard.reminders import REMINDER_HOURS_BEFORE, is_due_for_reminder, send_due_reminders


def test_reminder_window_uses_constant():
    due = datetime(2026, 1, 2, 12, 0)
    task = Task(id=1, title="t", creator="a", assignee="a", due_at=due)
    assert not is_due_for_reminder(task, due - timedelta(hours=REMINDER_HOURS_BEFORE + 1))
    assert is_due_for_reminder(task, due - timedelta(hours=REMINDER_HOURS_BEFORE))


def test_reminder_sent_once():
    due = datetime(2026, 1, 2, 12, 0)
    task = Task(id=1, title="t", creator="a", assignee="a", due_at=due)
    users = {"a": User(username="a", email="a@demo.invalid")}
    assert send_due_reminders([task], users, due - timedelta(hours=1)) == 1
    assert send_due_reminders([task], users, due - timedelta(hours=1)) == 0
