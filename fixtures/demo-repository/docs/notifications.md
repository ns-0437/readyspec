# Notifications (DEMO FIXTURE)

Notifications are created by feature code and delivered by `dispatchNotification`.

- Categories: `security`, `billing`, `product`, `marketing`.
- **Security alerts are always delivered** and cannot be switched off.
- All categories are **on by default** for new users.
- **Quiet hours:** users can configure quiet hours in their **local timezone**; no
  notification is sent to a user during their quiet hours except security alerts.
- Failed sends are retried up to three times by the retry queue.
- Users on a digest schedule receive suppressed product/marketing notifications in a digest.
