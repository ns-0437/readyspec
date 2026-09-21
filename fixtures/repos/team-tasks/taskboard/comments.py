# EVALUATION FIXTURE - fictional code.
import re
from datetime import datetime

from .models import Comment, Task, User

MENTION = re.compile(r"@([A-Za-z0-9_]+)")


def parse_mentions(body: str) -> list[str]:
    """Usernames mentioned in the text, in order, without duplicates."""
    seen: list[str] = []
    for name in MENTION.findall(body):
        if name not in seen:
            seen.append(name)
    return seen


def add_comment(author: User, task: Task, body: str, now: datetime) -> Comment:
    """Stores the comment with its parsed mentions. It does NOT notify anyone."""
    comment = Comment(author=author.username, body=body, created_at=now, mentions=parse_mentions(body))
    task.comments.append(comment)
    return comment
