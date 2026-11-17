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
| Customers | `customers` | `/tenantId` | Approved design; not provisioned |
| Services | To be approved during Stage 7 | Expected tenant ownership | Not designed |
| Conversations and messages | To be approved during Stage 8 | Expected conversation-oriented partitioning | Not designed |
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

## Governance Rule

No new persisted record type is added until its purpose, owner, partition key,
personal-data classification, retention and deletion behavior are added to this
dictionary and approved.
