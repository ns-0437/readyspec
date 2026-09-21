# EVALUATION FIXTURE - fictional code.
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class User:
    username: str
    email: str
    role: str = "member"  # "member" or "admin"
    active: bool = True


@dataclass
class Comment:
    author: str
    body: str
    created_at: datetime
    mentions: list[str] = field(default_factory=list)


@dataclass
class Task:
    id: int
    title: str
    creator: str
    assignee: Optional[str] = None
    due_at: Optional[datetime] = None
    status: str = "open"  # "open", "done", "archived"
    reminder_sent: bool = False
    comments: list[Comment] = field(default_factory=list)
