# BookSimple Data Dictionary

This document explains every application record stored in Azure Cosmos DB in
plain language. A business owner should not need to inspect raw Cosmos
documents; this dictionary exists so every record has a clear purpose, owner,
retention period and privacy classification.

## Reading a Cosmos Document

Every application document contains these technical fields:

| Field | Meaning |
| --- | --- |
| `id` | Identifier used to retrieve the document |
| `partitionKey` | Technical routing value used by the current authentication containers |
| `type` | Plain discriminator identifying the record kind |
| `schemaVersion` | Version used for safe future migrations |
| `ttl` | Optional number of seconds before Cosmos automatically expires the record |

Cosmos adds fields beginning with `_`, including `_rid`, `_self`, `_etag`,
`_attachments` and `_ts`. They are Azure metadata, not business information
created by BookSimple.

Hashes, generated IDs and encrypted values are intentionally not
human-readable. Raw secrets, passwords and session tokens are never stored.

## Current Containers

| Container | Human description | Partitioning | Contents |
| --- | --- | --- | --- |
| `auth-control` | Account, company and authentication control records | Account hash for account records; business ID for company records | Users, businesses, invitations, hashed one-time tokens, notification delivery, reservations, audits and setup state |
| `auth-sessions` | Active and revoked sign-in sessions | Account hash | Hashed session verifiers |
| `auth-throttles` | Temporary abuse-prevention counters | Hashed rate-limit scope | Request counts for a short time window |
| `customers` | Tenant-owned Customer records | `/tenantId` | Active, archived and anonymized Customers |
| `services` | Tenant-owned bookable Service records | `/tenantId` | Active and inactive Services |
| `conversations` | Tenant-owned Conversation threads | `/tenantId`, then `/conversationId` | Conversation summaries and separate Messages |
| `channel-identities` | Tenant-owned communication contact identities | `/tenantId` | Normalized channel addresses and optional Customer links |
| `bookings` | Tenant-owned Booking records | `/tenantId` | Customer and Service references, UTC times, timezone, snapshots and status |
| `booking-confirmations` | Tenant-owned Booking confirmation attempts | `/tenantId` | Booking, Customer, Conversation and Message references with delivery outcome |
| `payments` | Tenant-owned internal Payment records | `/tenantId` | Booking references, minor-unit amounts, provider references and lifecycle status; never card details |
| `reminders` | Tenant-owned Booking reminder records | `/tenantId` | Booking references, UTC schedules, channel labels, processing leases, attempts, Conversation/Message references and delivery results |

The authentication containers use `/partitionKey` because they contain several
technical record types with different routing needs. Future business domains
will not copy this pattern automatically.

## Current Record Dictionary

| Record type | Human purpose | Principal stored data | Owner | Retention | Shown in product |
| --- | --- | --- | --- | --- | --- |
| `user` | Registered account and authorization state | Name, email, password hash, verification state, roles, optional company membership and application | Account holder; platform controls authorization | Active account lifetime; anonymized deletion tombstone for 1 year | Yes |
| `email-index` | Enforces one active account per normalized email | Normalized email and user ID | Account system | Active account lifetime; deleted atomically when the account is anonymized | No |
| `business` | Company tenant and basic profile | Name, status, member count, timezone, country, currency, default deposit percentage, default reminder rules and non-secret Stripe connected-account references | Company tenant | Company lifetime until an approved business-retention process exists | Yes |
| `business-invitation` | Allows one email to join one company | Invitee email, staff role, status, inviter ID, hashed secret and expiry | Company tenant | Pending for 30 days; accepted or revoked for 90 days; link valid for 7 days | Yes, while pending |
| `membership-reservation` | Prevents duplicate internal usernames and maintains member counts during cross-document updates | User ID, internal username, role and operation ID | Company tenant | Active for membership lifetime; released for 30 days | No |
| `email-verification` | One-time email verification | User ID, hashed token, authorization version and expiry | Account holder | 24 hours | No |
| `password-reset` | One-time password reset | User ID, hashed token, authorization version and expiry | Account holder | 1 hour | No |
| `notification` | Reliable email delivery and retry state | Event, status and encrypted payload while delivery is pending or failed | Account or company workflow | Pending or failed for 30 days; sent metadata for 90 days; payload removed after successful delivery | No |
| `session` | Keeps a user signed in | User ID, hashed session verifier, authorization version and expiry | Account holder | Maximum 7 days | No |
| `rate-limit` | Prevents automated abuse | Window start and request count under a hashed scope | Platform security | Current rate-limit window plus a short expiry margin | No |
| `platform-admin-audit` | Records a privileged operation from start to completion | Actor ID, action, affected user or tenant, outcome and timestamps | Platform | 1 year | Not yet |
| `affected-account-audit` | Commits an affected-account change and its audit together | Actor ID, action, affected user or tenant and timestamp | Platform | 1 year | Not yet |
| `deleted-user-tombstone` | Preserves a minimal anonymized deletion history when an email is reused | Former user ID and deletion timestamps | Platform | 1 year | No |
| `platform-bootstrap-lock` | Permanently prevents a second first-platform-administrator bootstrap | Selected user ID, setup-token hash and completion state | Platform security | Permanent | No |
| `payment` | Tracks a provider-safe payment request and its result | Booking ID, type, minor-unit amount, currency, status, provider reference and timestamps | Company tenant | Durable financial history until an approved retention policy exists | Yes |
| `booking-confirmation` | Controls one confirmation attempt per confirmed Booking | Booking, Customer, Conversation and Message references, channel, status and safe failure category | Company tenant | Durable Booking history until an approved retention policy exists | Through the linked Conversation |
| `reminder` | Schedules and tracks one Booking reminder | Booking ID, channel, offset, UTC schedule, timezone, lifecycle status, attempts, processing lease, provider and optional Conversation/Message references | Company tenant | Durable Booking history until an approved retention policy exists | Yes |

Conversation Message records may additionally retain a non-secret messaging
provider name, external message ID, provider event ID, provider-attempt time,
sent time and safe failure category. These values support delivery correlation,
visible failure handling and idempotency; raw provider webhook payloads and
credentials are not stored in Message documents. Email Channel Identity
records may retain a random opaque inbound route key. It identifies no tenant
or Conversation without a server-side lookup.

## Retention Rules

Retention values are centralized in
`src/server/data-retention.ts`. Containers have TTL enabled with no default
expiry, so only records with an explicit `ttl` expire.

The migration command is deliberately dry-run by default:

```powershell
npm run migrate:data-retention
```

After reviewing its counts, apply the policy with:

```powershell
npm run migrate:data-retention -- --apply
```

The migration never prints document contents, email addresses, credentials or
secrets.

## Approved Future Domain Boundaries

Major business domains use dedicated containers rather than expanding
`auth-control` into an everything container.

| Domain | Planned container | Partition key | Status |
| --- | --- | --- | --- |
| Customers | `customers` | `/tenantId` | Implemented and provisioned |
| Services | `services` | `/tenantId` | Implemented and provisioned |
| Conversations and messages | `conversations` | `/tenantId`, then `/conversationId` | Implemented and provisioned |
| Channel identities | `channel-identities` | `/tenantId` | Implemented and provisioned |
| Bookings | `bookings` | `/tenantId` | Implemented and provisioned |
| Booking confirmations | `booking-confirmations` | `/tenantId` | Implemented for Stage 16 |
| Payments | `payments` | `/tenantId` | Approved for Stage 11 |
| Reminders | `reminders` | `/tenantId` | Implemented and provisioned for Stage 12 |

## Approved Stripe Connect Business Fields

Each Business may store separate test and live Stripe Connect OAuth references:

```json
{
  "stripeConnect": {
    "test": {
      "accountId": "acct_test_reference",
      "connectionMethod": "OAUTH",
      "createdAt": "2026-11-17T19:10:00.000Z"
    },
    "live": {
      "accountId": "acct_live_reference",
      "connectionMethod": "OAUTH",
      "createdAt": "2026-11-17T19:20:00.000Z"
    }
  }
}
```

- Connected-account IDs are provider references, not credentials.
- Test and live references are separate so changing the platform key mode never
  routes live money to a test account or reuses a test authorization in
  production.
- Secret API keys, webhook signing secrets, OAuth access or refresh tokens,
  authorization URLs and Checkout URLs are never stored in Business documents.
- Only company administrators can start the single-use OAuth connection flow.
- The current capability/readiness state is retrieved from Stripe and is not
  trusted solely from a stale local flag.

## Approved Customer Document

Stage 6 uses the dedicated `customers` container partitioned by `/tenantId`.
The container has no default TTL because active, archived and anonymized
customer identities are durable business records.

```json
{
  "id": "customer-guid",
  "tenantId": "business-guid",
  "type": "customer",
  "schemaVersion": 1,
  "name": "Alex Smith",
  "searchName": "alex smith",
  "email": "alex@example.com",
  "phone": "+441234567890",
  "status": "active",
  "createdAt": "2026-11-17T15:00:00.000Z",
  "updatedAt": "2026-11-17T15:00:00.000Z"
}
```

Customer decisions:

- `tenantId` is both the ownership boundary and Cosmos partition key.
- Name is required; email and phone are optional.
- Email is stored lowercase and trimmed when provided.
- Phone is stored as 7 to 15 digits with an optional leading `+`; spaces,
  brackets, hyphens and other display punctuation are removed.
- Duplicate email or phone values are allowed because people can legitimately
  share contact details.
- Create and edit screens warn about possible duplicates within the same
  tenant; they do not silently merge or block them.
- Normal deletion archives the customer.
- Permanent erasure anonymizes personal fields while retaining the customer ID,
  tenant ID, status and timestamps needed by future booking or conversation
  references.
- Active company users can create, search, view, edit and archive Customers.
  Permanent erasure requires the `company_admin` role.
- Customer records never contain authentication state, provider secrets,
  payment-card information, complete bookings or complete conversations.

## Customer Access Patterns

| Operation | Partition scope |
| --- | --- |
| List customers for the active company | One `tenantId` partition |
| Search customers by name, email or phone | One `tenantId` partition |
| Read a customer by ID | Point read using customer ID and server-resolved `tenantId` |
| Create or update a customer | One `tenantId` partition |
| Archive or anonymize a customer | One `tenantId` partition |
| Platform-wide customer search | Not part of Stage 6 |

The server derives `tenantId` from the authenticated membership. A browser
value is never accepted as proof of tenant ownership.

## Approved Service Document

Stage 7 uses a dedicated `services` container partitioned by `/tenantId`.
The container has no default TTL because active and inactive Services are
durable business configuration.

```json
{
  "id": "service-guid",
  "tenantId": "business-guid",
  "type": "service",
  "schemaVersion": 1,
  "name": "Initial consultation",
  "searchName": "initial consultation",
  "description": "A general introductory appointment.",
  "durationMinutes": 60,
  "priceMinor": 2550,
  "currency": "GBP",
  "active": true,
  "createdAt": "2026-11-17T16:45:00.000Z",
  "updatedAt": "2026-11-17T16:45:00.000Z"
}
```

Service decisions:

- `tenantId` is both the ownership boundary and immutable Cosmos partition key.
- Name is required and description is optional.
- Duration is stored as a positive safe integer number of minutes.
- Price is stored as a non-negative safe integer in the currency's minor unit;
  `2550` represents `25.50` for a two-decimal currency.
- Currency is an uppercase three-letter ISO currency code. New Services default
  to the active Business currency, while the stored value remains explicit.
- Zero-priced Services are allowed.
- Service names are not globally unique. Different businesses may offer
  identically named Services without sharing or exposing their Service records.
- Normal lifecycle management uses `active`; records are deactivated rather
  than physically deleted.
- All active company users can create, search, view, edit, activate and
  deactivate Services belonging to their own Business.
- Service records never contain customer data, payment-card details,
  authentication state or provider secrets.

## Service Access Patterns

| Operation | Partition scope |
| --- | --- |
| List Services for the active company | One `tenantId` partition |
| Search Services by name or description | One `tenantId` partition |
| Read a Service by ID | Point read using Service ID and server-resolved `tenantId` |
| Create or update a Service | One `tenantId` partition |
| Activate or deactivate a Service | One `tenantId` partition |
| Platform-wide Service search | Not part of Stage 7 |

The server derives `tenantId` from authenticated membership for every Service
operation. No Service API accepts a browser tenant ID as proof of ownership.

## Approved Conversation Document

Stage 8 uses a dedicated `conversations` container with hierarchical partition
paths `/tenantId` and `/conversationId`.

```json
{
  "id": "conversation-guid",
  "tenantId": "business-guid",
  "conversationId": "conversation-guid",
  "type": "conversation",
  "schemaVersion": 1,
  "channelIdentityId": "identity-hash",
  "customerId": "optional-customer-guid",
  "contactLabel": "Alex or channel address",
  "channel": "WHATSAPP",
  "messageCount": 3,
  "lastMessagePreview": "Is Friday available?",
  "lastMessageDirection": "INBOUND",
  "lastMessageAt": "2026-11-17T17:00:00.000Z",
  "createdAt": "2026-11-17T16:55:00.000Z",
  "updatedAt": "2026-11-17T17:00:00.000Z"
}
```

Conversation decisions:

- `tenantId` is the authorization boundary and first hierarchical key level.
- `conversationId` is the second key level and groups one Conversation with its
  unbounded Message documents.
- `customerId` is optional while a channel contact is unresolved.
- The Conversation stores only a bounded last-message preview and summary
  fields needed by the inbox; message history is not embedded.
- All active company users can view and work with Conversations in their own
  tenant.
- Stage 8 records have no default TTL. Production communication retention and
  export policy must be approved before real provider data is connected.

## Approved Message Document

```json
{
  "id": "message-guid",
  "tenantId": "business-guid",
  "conversationId": "conversation-guid",
  "type": "message",
  "schemaVersion": 1,
  "customerId": "optional-customer-guid",
  "direction": "INBOUND",
  "channel": "WHATSAPP",
  "body": "Is Friday available?",
  "deliveryStatus": "RECEIVED",
  "createdAt": "2026-11-17T17:00:00.000Z"
}
```

Message decisions:

- Messages are separate documents because history is unbounded.
- Direction is `INBOUND` or `OUTBOUND`.
- Channel is `WHATSAPP`, `FACEBOOK`, `SMS` or `EMAIL`.
- Development replies use `LOCAL_ONLY`. Postmark Email replies use `PENDING`,
  `SENT` or `FAILED`; `SENT` means accepted by Postmark, not final delivery.
- Message creation and Conversation summary replacement use one transactional
  batch inside the full hierarchical partition.
- Message bodies are sensitive communication content. They are protected by
  tenant authorization and Cosmos encryption at rest, but not field encrypted.
  Synthetic data only is allowed until production retention and security review.

## Approved Channel Identity Document

Stage 8 uses `channel-identities`, partitioned by `/tenantId`, for exact
tenant-local contact matching.

```json
{
  "id": "identity-hash",
  "tenantId": "business-guid",
  "type": "channel-identity",
  "schemaVersion": 1,
  "channel": "WHATSAPP",
  "normalizedAddress": "+441234567890",
  "displayLabel": "+44 1234 567890",
  "conversationId": "conversation-guid",
  "inboundRouteKey": "optional-random-opaque-email-route",
  "customerId": "optional-customer-guid",
  "createdAt": "2026-11-17T16:55:00.000Z",
  "updatedAt": "2026-11-17T16:55:00.000Z"
}
```

Channel identity decisions:

- The ID is deterministic from channel plus normalized address, allowing one
  current identity per channel address and tenant without storing the address
  in the partition key.
- Email is lowercase and trimmed; WhatsApp and SMS use canonical phone values;
  Facebook uses a bounded provider-neutral identifier during local development.
- Email identities receive an opaque 256-bit inbound route only when a real
  Postmark reply needs one. The route is unique by entropy and is never treated
  as authorization without sender and document validation.
- Exactly one Customer match may link automatically. Multiple exact Customer
  matches remain unresolved for staff selection.
- No match offers Customer creation with known fields prefilled.
- Name similarity never links a Customer automatically.

## Conversation Access Patterns

| Operation | Partition scope |
| --- | --- |
| List tenant Conversations | Hierarchical prefix containing `tenantId` |
| Read a Conversation | Full key containing `tenantId` and `conversationId` |
| Read or append Messages | Full key containing `tenantId` and `conversationId` |
| Match a channel identity | Point read using deterministic ID and server-resolved `tenantId` |
| Resolve to a Customer | Tenant-scoped Customer point read and guarded cross-container updates |
| Platform-wide message search | Not part of Stage 8 |

## Approved Booking Document

Stage 9 uses a dedicated `bookings` container partitioned by `/tenantId`.
Bookings are durable business records and have no default TTL.

```json
{
  "id": "booking-guid",
  "tenantId": "business-guid",
  "type": "booking",
  "schemaVersion": 1,
  "customerId": "customer-guid",
  "serviceId": "service-guid",
  "conversationId": "optional-conversation-guid",
  "startAt": "2026-11-20T14:30:00.000Z",
  "endAt": "2026-11-20T15:30:00.000Z",
  "timeZone": "Europe/London",
  "durationMinutes": 60,
  "status": "PENDING",
  "totalAmountMinor": 2550,
  "currency": "GBP",
  "defaultDepositPercentage": 25,
  "appliedDepositPercentage": 25,
  "depositAmountMinor": 638,
  "depositOverridden": false,
  "createdAt": "2026-11-17T17:30:00.000Z",
  "updatedAt": "2026-11-17T17:30:00.000Z"
}
```

Booking decisions:

- `tenantId` is both the ownership boundary and immutable Cosmos partition key.
- `customerId` and `serviceId` are references validated by tenant-scoped point
  reads. Cosmos does not enforce foreign keys.
- `conversationId` is optional and records the tenant-owned Conversation from
  which a Booking was created.
- `startAt` and `endAt` are UTC ISO instants. `timeZone` preserves the tenant
  timezone used to interpret and display the local booking time.
- `durationMinutes`, `totalAmountMinor` and `currency` are copied from the
  selected Service when booked. Later Service edits do not silently rewrite an
  existing Booking's agreed duration or price.
- New Bookings start as `PENDING`. Explicit statuses are `PENDING`,
  `AWAITING_DEPOSIT`, `CONFIRMED`, `COMPLETED`, `CANCELLED` and `NO_SHOW`.
- `defaultDepositPercentage` snapshots the Business policy in force at
  creation. `appliedDepositPercentage` is the percentage used for this Booking.
- `depositAmountMinor` uses integer minor units and round-half-up calculation.
  For example, 25% of 2550 minor units is 637.5 and stores as 638.
- `depositOverridden` distinguishes policy terms from a Booking-specific
  override. An override also stores `depositOverriddenByUserId`, the
  human-readable `depositOverriddenByUsername` snapshot and
  `depositOverriddenAt`; these fields are absent when no override applies.
- Changing the Business default never recalculates historic Bookings. Changing
  a non-terminal Booking's Service recalculates the amount using that Booking's
  already-applied percentage.
- Company administrators configure the Business default. Any active company
  user who can manage Bookings may set or clear an individual override.
- Cancellation changes status to `CANCELLED`; Bookings are not physically
  deleted.
- Deposit policy, payment state, assigned staff, resources, locations, notes,
  recurrence and availability conflict detection are not part of Stage 9.
- Booking records contain Customer and Conversation references but do not copy
  Customer names, email addresses, phone numbers or message content.

## Booking Access Patterns

| Operation | Partition scope |
| --- | --- |
| List Bookings for the active company | One `tenantId` partition |
| Filter by Customer or status | One `tenantId` partition |
| Read a Booking by ID | Point read using Booking ID and server-resolved `tenantId` |
| Create or update a Booking | One `tenantId` partition after same-tenant reference checks |
| Cancel or change status | ETag-protected replacement in one `tenantId` partition |
| Override Booking deposit | ETag-protected replacement with authenticated user attribution |
| Create from a Conversation | Full Conversation key plus same-tenant Customer validation |
| Platform-wide Booking search | Not part of Stage 9 |

Legacy Stage 9 Booking documents are migrated to schema version 2 with an
explicit 0% default and applied deposit, zero minor-unit deposit amount and no
override. This avoids inventing a historic obligation that did not previously
exist.

## Approved Booking Confirmation Document

Stage 16 stores one durable confirmation record per Booking in the dedicated
`booking-confirmations` container partitioned by `/tenantId`.

```json
{
  "id": "booking-confirmation-booking-guid",
  "tenantId": "business-guid",
  "type": "booking-confirmation",
  "schemaVersion": 1,
  "bookingId": "booking-guid",
  "customerId": "customer-guid",
  "status": "SENT",
  "conversationId": "conversation-guid",
  "messageId": "deterministic-message-guid",
  "channel": "EMAIL",
  "messageDeliveryStatus": "SENT",
  "createdAt": "2026-11-19T16:00:00.000Z",
  "updatedAt": "2026-11-19T16:00:01.000Z"
}
```

The deterministic confirmation ID is the idempotency gate. Only the process
that creates it may dispatch the confirmation; concurrent or repeated
confirmation transitions return the existing record. The linked outbound
Message remains the customer-visible communication and retains provider
delivery state.

Routing first reuses the Booking's originating Conversation when its channel
is supported by the configured provider. Otherwise, the system creates or
reuses the Customer's exact Email Conversation. If neither route is available,
the Booking remains confirmed and the confirmation records
`FAILED`/`NO_SUPPORTED_CONTACT`. Provider failures record `FAILED`/`DELIVERY`
and remain visible through the linked failed outbound Message.

## Approved Payment Document

Payment records remain separate from Bookings and never store payment-card or
bank-account details.

```json
{
  "id": "deposit-11111111-1111-4111-8111-111111111111",
  "tenantId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "type": "payment",
  "schemaVersion": 1,
  "bookingId": "11111111-1111-4111-8111-111111111111",
  "paymentType": "DEPOSIT",
  "amountMinor": 638,
  "currency": "GBP",
  "status": "PENDING",
  "provider": "MOCK_TEST",
  "simulated": true,
  "livemode": false,
  "externalPaymentId": "mock_pay_22222222-2222-4222-8222-222222222222",
  "createdAt": "2026-11-17T18:50:00.000Z",
  "updatedAt": "2026-11-17T18:50:00.000Z"
}
```

- `id` is deterministic for the Stage 11 deposit request, so retries cannot
  create duplicate deposit Payment records for the same Booking.
- `amountMinor` and `currency` snapshot the Booking deposit terms using safe
  integer minor units.
- `provider` is explicitly `MOCK_TEST` and `simulated` is always `true` in this
  stage. No real provider or live charge exists.
- Stripe Checkout Payments use `provider: "STRIPE"`, `simulated: false`, the
  configured `livemode`, and the tenant's `connectedAccountId`. The
  `externalPaymentId` is a Checkout Session ID and remains provider-safe.
- A successful simulated provider notification changes `status` to `PAID` and
  adds `paidAt` and `providerEventId`. Duplicate notifications preserve the
  original payment timestamp and reconcile the Booking without double effects.
- `DEPOSIT`, `BALANCE` and `FULL_PAYMENT` are reserved Payment types, but Stage
  11 initially created only `DEPOSIT`. The approved Stripe integration also
  creates `BALANCE`: after a paid deposit it is `totalAmountMinor` minus the
  snapshotted deposit, while a 0% deposit Booking may pay its full amount as
  the balance. A 100% paid deposit has no remaining balance.
- `PENDING`, `PAID`, `FAILED` and `REFUNDED` are explicit statuses. Stage 11
  implements only the safe `PENDING` to `PAID` simulated transition.

## Payment Access Patterns

| Operation | Partition behavior |
| --- | --- |
| Create or retry a deposit request | Deterministic create in the authenticated `tenantId` partition |
| Read Payment detail | Point read using Payment ID plus authenticated `tenantId` |
| List Payments for a Booking | Bounded single-partition query by `bookingId` |
| Confirm mock Payment | ETag-protected replacement, then retry-safe Booking reconciliation |
| Start Stripe Checkout | Direct charge scoped to the tenant connected account; deterministic idempotency key |
| Confirm Stripe Payment | Raw-body signature-verified Connect webhook, account/mode/metadata checks, ETag replacement and retry-safe Booking reconciliation |

## Governance Rule

No new persisted record type is added until its purpose, owner, partition key,
personal-data classification, retention and deletion behavior are added to this
dictionary and approved.
