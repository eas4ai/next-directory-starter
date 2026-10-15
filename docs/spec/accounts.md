# Account access

Prefix: ACC

[ACC-001] A public account must prove control of its email address through a single-use, expiring verification link sent by the configured mail service before it can sign in or act as a listing owner; documented host provisioning still creates a usable first administrator.
Falsifier: An unverified new account obtains a protected session or submits a listing, a reused or expired link verifies an account, or the documented first administrator cannot sign in after the change.
Mechanism: account-access
Status: Agreed 2026-10-09

[ACC-002] An account holder can request a password-reset link and set a new password through a single-use, expiring token without revealing whether the requested email exists; completing reset invalidates the old password and existing sessions.
Falsifier: The request response reveals account existence, a used or expired token resets a password, or the old password or session still works after reset.
Mechanism: account-access
Status: Agreed 2026-10-09

[ACC-003] An existing verified account can request a Better Auth magic link and sign in through that single-use, expiring link without a password; requesting a link does not create an account.
Falsifier: A link request creates an unknown account, an invalid or reused link establishes a session, or a valid link for a verified account cannot sign in.
Mechanism: account-access
Status: Agreed 2026-10-09

[ACC-004] An authorized administrator can suspend and reinstate an account with an audit record; suspension blocks new and existing sessions and protected actions, removes that account's listings from public surfaces, and cannot remove the last active administrator.
Falsifier: A suspended account completes a protected request using an existing session, its listing remains public, an unauthorized account changes suspension, or the final active administrator can be suspended.
Mechanism: account-access
Status: Agreed 2026-10-09
