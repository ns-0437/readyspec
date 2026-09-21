# EVALUATION FIXTURE - fictional code.
import csv
import io

from .models import User


def users_to_csv(users: list[User]) -> str:
    """CSV of users (username, email, role). Tasks are not exported anywhere yet."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["username", "email", "role"])
    for u in users:
        writer.writerow([u.username, u.email, u.role])
    return out.getvalue()
