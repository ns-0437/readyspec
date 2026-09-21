# EVALUATION FIXTURE - fictional code.
from .models import User

SENT: list[tuple[str, str]] = []


def notify(user: User, message: str) -> None:
    """Records a notification for an active user; inactive users are silently skipped."""
    if not user.active:
        return
    SENT.append((user.username, message))
