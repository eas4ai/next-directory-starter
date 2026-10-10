# Publishing

Prefix: PUB

[PUB-001] The application lets an owner sign in and edit only listings that the owner controls.
Falsifier: One owner can change another owner's listing through a direct request.
Mechanism: publishing-access
Status: Agreed 2026-10-09

[PUB-002] The application lets an owner save a private draft and submit it for moderator review.
Falsifier: An unauthenticated visitor can fetch a draft, or a submitted draft does not enter the review queue.
Mechanism: publishing-submission
Status: Agreed 2026-10-09

[PUB-003] The application lets a moderator approve or reject a submission with a recorded reason.
Falsifier: A rejection saves no reason, or an approval leaves the listing absent from public pages.
Mechanism: publishing-review
Status: Agreed 2026-10-09

[PUB-004] The application keeps the approved version public while an owner's proposed edits await review.
Falsifier: Saving an unapproved edit changes the public detail page or removes the approved version.
Mechanism: publishing-revisions
Status: Agreed 2026-10-09

[PUB-005] The application lets a moderator suspend a published listing immediately.
Falsifier: A suspended listing still appears in public search or its detail page.
Mechanism: publishing-suspension
Status: Agreed 2026-10-09
