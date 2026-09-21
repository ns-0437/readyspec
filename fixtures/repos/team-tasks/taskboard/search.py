# EVALUATION FIXTURE - fictional code. Unrelated to reminders and permissions on purpose.
from .models import Task


def search_tasks(tasks: list[Task], query: str) -> list[Task]:
    q = query.lower()
    return [t for t in tasks if q in t.title.lower()]
