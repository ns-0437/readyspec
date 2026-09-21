# EVALUATION FIXTURE - fictional code.
from datetime import datetime
from typing import Optional

from .models import Task, User
from .notifications import notify
from .permissions import can_edit_task

_TASKS: dict[int, Task] = {}
_NEXT_ID = 1


def create_task(creator: User, title: str, due_at: Optional[datetime] = None) -> Task:
    global _NEXT_ID
    task = Task(id=_NEXT_ID, title=title, creator=creator.username, assignee=creator.username, due_at=due_at)
    _TASKS[task.id] = task
    _NEXT_ID += 1
    return task


def assign_task(actor: User, task: Task, assignee: User) -> Task:
    """Replaces the single assignee and tells the new assignee."""
    if not can_edit_task(actor, task):
        raise PermissionError("cannot edit task")
    task.assignee = assignee.username
    task.reminder_sent = False
    notify(assignee, f"You were assigned '{task.title}'")
    return task


def complete_task(actor: User, task: Task) -> Task:
    if not can_edit_task(actor, task):
        raise PermissionError("cannot edit task")
    task.status = "done"
    return task


def archive_task(actor: User, task: Task) -> Task:
    if not can_edit_task(actor, task):
        raise PermissionError("cannot edit task")
    task.status = "archived"
    return task


def tasks_for(username: str) -> list[Task]:
    return [t for t in _TASKS.values() if t.assignee == username and t.status == "open"]
