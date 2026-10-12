# Owner notifications

Prefix: NOTIFY

[NOTIFY-001] A moderation decision or verified payment state change records one durable notification for the affected owner in the same database transaction as the state change. The owner can read their latest 20 notifications in their private workspace; another owner cannot read them.
Falsifier: An approved submission or settled payment has no owner notification, replay creates duplicates, a failed notification insert commits the domain change anyway, or another owner reads the message.
Mechanism: content-notifications
Status: Agreed 2026-10-09

[NOTIFY-002] A bounded worker delivers retained owner notifications through the configured Resend sender with retry and visible failure state. Restarting or a transient send failure does not discard an intent; exhausted intents can be retried explicitly without sending a new payment or moderation action.
Falsifier: A provider error loses an intent, a restart duplicates a successfully acknowledged send, unbounded attempts continue, one worker drains beyond its limit, or an email exposes provider credentials or raw webhook payloads.
Mechanism: content-notifications
Status: Agreed 2026-10-09
