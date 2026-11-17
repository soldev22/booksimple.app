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

The authentication containers use `/partitionKey` because they contain several
technical record types with different routing needs. Future business domains
will not copy this pattern automatically.

## Current Record Dictionary

| Record type | Human purpose | Principal stored data | Owner | Retention | Shown in product |
| --- | --- | --- | --- | --- | --- |
| `user` | Registered account and authorization state | Name, email, password hash, verification state, roles, optional company membership and application | Account holder; platform controls authorization | Active account lifetime; anonymized deletion tombstone for 1 year | Yes |
| `email-index` | Enforces one active account per normalized email | Normalized email and user ID | Account system | Active account lifetime; deleted atomically when the account is anonymized | No |
| `business` | Company tenant and basic profile | Name, status, member count, timezone and currency | Company tenant | Company lifetime until an approved business-retention process exists | Yes |
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
| Services | `services` | `/tenantId` | Approved Stage 7 design |
| Conversations and messages | `conversations` | `/tenantId`, then `/conversationId` | Approved Stage 8 design |
| Channel identities | `channel-identities` | `/tenantId` | Approved Stage 8 matching design |
| Bookings | To be approved during Stage 9 | Expected tenant-oriented access with deliberate growth analysis | Not designed |
| Payments | To be approved during Stage 11 | Provider-safe internal records only | Not designed |

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
- Development replies use `LOCAL_ONLY`; the UI must not imply external
  delivery.
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

## Governance Rule

No new persisted record type is added until its purpose, owner, partition key,
personal-data classification, retention and deletion behavior are added to this
dictionary and approved.
