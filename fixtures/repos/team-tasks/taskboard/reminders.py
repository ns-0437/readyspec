# EVALUATION FIXTURE - fictional code.
from datetime import datetime, timedelta

from .models import Task, User
from .notifications import notify

# NOTE: docs/design.md says reminders go out 24 hours before the due date.
REMINDER_HOURS_BEFORE = 12


def is_due_for_reminder(task: Task, now: datetime) -> bool:
    if task.status != "open" or task.due_at is None or task.reminder_sent:
        return False
    return now >= task.due_at - timedelta(hours=REMINDER_HOURS_BEFORE)


def send_due_reminders(tasks: list[Task], users: dict[str, User], now: datetime) -> int:
    """Sends one reminder per task to its assignee. All datetimes are naive and assumed to be UTC."""
    sent = 0
    for task in tasks:
        if not is_due_for_reminder(task, now) or task.assignee is None:
            continue
        assignee = users.get(task.assignee)
        if assignee is None:
            continue
        notify(assignee, f"'{task.title}' is due soon")
        task.reminder_sent = True
        sent += 1
    return sent
