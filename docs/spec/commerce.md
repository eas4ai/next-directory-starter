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

## Payment lifecycle expansion

[COM-004] An administrator can define free, one-time, monthly, and annual publishing plans for each checkout mode with visible price, currency, duration, and placement terms; approved listings keep a free default publication path and a purchase retains the terms accepted by its owner after the plan changes.
Falsifier: A new approved listing is blocked from ordinary publication without a provider payment, a free plan starts a charge, a disabled or wrong-mode plan is offered, a recurring plan hides its billing period, or editing a plan changes an existing purchase's terms.
Mechanism: payment-foundation
Status: Agreed 2026-10-09

[COM-005] An administrator can configure Stripe, Paddle, and NOWPayments separately for test and live use through protected controls; provider secrets are encrypted at rest, never returned to a browser, and do not cross modes.
Falsifier: A non-administrator reads or changes a profile, a saved secret appears in database plaintext or a response, a test credential is used for live checkout, or a disabled provider is offered for a new purchase.
Mechanism: payment-foundation
Status: Agreed 2026-10-09

[COM-006] An approved listing's owner can start a server-priced hosted checkout with an enabled provider: Stripe and Paddle for eligible one-time or recurring plans, and the official NOWPayments Node SDK for one-time invoices only. An ambiguous retry must retain the same purchase instead of creating another payable attempt.
Falsifier: A draft or another owner's listing starts checkout, browser-supplied price or mode controls the provider request, a missing price mapping is borrowed from another mode, NOWPayments is offered for recurring billing, or a retry creates a second chargeable attempt.
Mechanism: payment-lifecycle
Status: Agreed 2026-10-09

[COM-007] The application authenticates Stripe, Paddle, and NOWPayments event payloads, correlates settled payment evidence to the exact provider, mode, purchase and immutable terms, and applies fulfillment once even after replay or interruption.
Falsifier: An unsigned, unsettled, partial, wrong-price, wrong-currency, wrong-mode, or unrelated event grants access; a browser return grants access; or duplicate delivery creates or extends an entitlement twice.
Mechanism: payment-lifecycle
Status: Agreed 2026-10-09

[COM-008] A paid entitlement follows verified renewal, cancellation, refund, dispute, and expiry outcomes without overriding moderation. A failed renewal adds no time; scheduled cancellation keeps paid time; full refund and open dispute suspend the affected access, while partial refund does not.
Falsifier: An unpaid renewal extends access, a scheduled cancellation removes already paid time, a full refund or open dispute leaves the affected paid benefit active, a partial refund revokes it, or a test-mode payment changes live public eligibility.
Mechanism: payment-lifecycle
Status: Agreed 2026-10-09

[COM-009] Owners can see their purchase and subscription status and request supported cancellation; an operator can reconcile bounded retained payment evidence and unresolved purchases without creating a new charge, including after a provider is disabled for new checkout.
Falsifier: An owner cannot tell pending from paid or canceled state, another owner can read or cancel the purchase, a missed event cannot be repaired from retained or authoritative evidence, a retry creates a new charge, or disabling checkout discards recovery material.
Mechanism: payment-lifecycle
Status: Agreed 2026-10-09

### Payment foundation operating rules

- Moderation approval keeps the existing ordinary free publication behavior.
  Choosing a free plan cannot call a payment provider. Paid terms may add
  featured placement or a bounded term without changing the approved content.
- A plan's billing mode and price are shown before an owner accepts it. Existing
  one-time purchases keep their recorded amount, currency, duration, and
  featured terms as plans are edited or disabled.
- Profiles are scoped to provider and test/live mode. A new profile starts
  disabled. Stripe and Paddle use mode-specific price identifiers; NOWPayments
  invoices use the local amount and currency and support one-time plans only.
  Saving a profile does not claim that a remote key or price was verified.
- The deployment supplies a separate encryption key. The admin UI never reads
  saved API or webhook secrets back. Blank replacement fields preserve secrets;
  disabling checkout preserves secrets needed by existing purchases. A stale
  settings edit cannot silently overwrite a newer save.
- An explicitly saved Stripe profile supersedes legacy environment-based
  one-time Checkout configuration. The legacy path stays available to existing
  installations until an explicit Stripe profile is saved. A disabled explicit
  profile cannot fall back to environment credentials.
- Owners do not see new Paddle, NOWPayments, or recurring checkout buttons until
  COM-006 through COM-009 supply verified checkout and fulfillment for them.
