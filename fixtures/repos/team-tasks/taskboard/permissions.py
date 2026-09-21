# EVALUATION FIXTURE - fictional code.
from .models import Task, User


def is_admin(user: User) -> bool:
    return user.role == "admin"


def can_edit_task(user: User, task: Task) -> bool:
    """Assignee, creator or an admin may edit. There is a single assignee per task."""
    return is_admin(user) or user.username in (task.assignee, task.creator)


def can_view_task(user: User, task: Task) -> bool:
    """Every active user can view every task; there are no private tasks."""
    return user.active
