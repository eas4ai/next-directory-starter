# Commerce

Prefix: COM

[COM-001] The operator defines publishing plans whose price, duration, and placement terms are visible before an owner buys one.
Falsifier: An owner reaches payment without seeing the plan's price or publication duration.
Mechanism: commerce-plans
Status: Agreed 2026-10-09

[COM-002] The application grants or ends a paid publication entitlement from verified payment events without double-applying repeated events.
Falsifier: Replaying a valid payment event creates two entitlements, or an unverified event activates a listing.
Mechanism: commerce-payments
Status: Agreed 2026-10-09

[COM-003] The application labels currently paid featured listings and displays them in separate featured positions without changing ordinary directory result order.
Falsifier: An expired plan remains featured, a featured listing lacks its label, or featured status changes normal search order.
Mechanism: commerce-featured
Status: Agreed 2026-10-09
