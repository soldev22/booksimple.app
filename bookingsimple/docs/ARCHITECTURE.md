# Universal Communications & Booking Platform
## Technical Architecture

## 1. Architecture Objective

Build a secure, maintainable, multi-tenant SaaS application for small B2C businesses.

The architecture must support:

- multiple independent business tenants
- multiple users per business
- customer records
- unified conversations
- WhatsApp messaging
- Facebook / Meta messaging
- SMS
- email
- bookings
- deposits and payments
- confirmations
- reminders
- future communication providers

The initial architecture should remain simple.

Do not introduce distributed microservices unless a genuine technical requirement emerges.

---

# 2. Initial Technology Stack

## Application

Use:

- Next.js
- TypeScript
- React

Prefer the current stable Next.js App Router architecture.

The application should contain both:

- frontend UI
- server-side application/API functionality

during the initial build.

Do not create a separate frontend and backend application unless a later requirement justifies that separation.

---

# 3. Hosting

The current application shell is deployed on Vercel. This deployment is a
foundation preview, not production readiness or approval to deploy business data.

The initial plan keeps the web application and its server-side API on Vercel
and Cosmos DB on Azure. No separate API service is planned.

The architecture should be compatible with Azure services without forcing application business logic to depend directly on Azure-specific APIs.

Likely infrastructure may eventually include:

- Azure-hosted web application
- Azure Cosmos DB for NoSQL
- secret management
- monitoring
- background processing
- object/file storage

Exact services will be selected when deployment begins.

Local development must remain straightforward.

---

# 4. Database

Use Azure Cosmos DB for NoSQL as the primary document database. This replaces
the previous PostgreSQL and Prisma plan; neither is required for Stage 2.

The product contains related business concepts including:

- tenants
- users
- customers
- conversations
- messages
- services
- bookings
- payments
- reminders

Use the official Azure Cosmos DB JavaScript SDK from server-side code. Reuse a
client per server instance rather than creating one per request. Keep persistence
behind a clear application boundary.

Cosmos DB is a document database, not a relational database: it does not
provide relational foreign keys or general cross-partition transactions.
Document relationships, uniqueness, consistency, and failure recovery must
be designed explicitly. Version document contracts, container configuration,
and any required data transformations in source control.

A serverless Cosmos DB account has been created in UK South with public network
access and account-key authentication enabled, with seven-day continuous backup.
The registration database and three auth containers have been provisioned,
and local synthetic-data access has been verified. The account is not yet
approved for real data.

The server-side Cosmos client supports a local-development-only account key or
Azure CLI credentials locally, and supports Vercel OIDC federation. Account
metadata access has been verified locally;
Vercel federation has not yet been configured or verified. The client does not
create databases or containers.

## Initial Connectivity Decision

The approved initial approach for development and production is to access the
Cosmos DB public endpoint from server-side application code. Public network
access increases exposure: anyone can reach the endpoint, though database
access still requires valid authorization. A compromised identity with database
permissions could bypass application-level tenant checks.

Use Microsoft Entra ID and least-privilege Cosmos DB data-plane permissions,
with short-lived credentials for deployed environments. The explicitly approved
local key mode is rejected in production and on Vercel, but enabling keys is
an account-wide setting: any holder can access account data outside the
application's authorization controls. Keep keys out of Git and logs; plan
rotation, secure storage and separate development resources, and reassess
disabling keys before accepting real data. For Vercel, plan workload identity federation
through OIDC; do not assume Azure managed identity exists there. Local
development may use the approved key or an explicitly authorised identity. Never expose database
credentials to the browser. Review identity scopes, deployment environments,
monitoring, alerts and incident response before enabling access.

The existing Azure account is the intended initial development target, using
synthetic test data only. The current development identity has the built-in
Cosmos DB Data Contributor role at account scope. Review or narrow this access
before accepting real data. Before accepting real data, agree
and verify safe separation of development and production access and data;
do not treat a shared account as isolated merely because records are labelled
as test data. Authentication, tenant authorization and the other security
controls must be implemented and verified first.

Revisit IP-restricted or private networking when commercial circumstances
and the security assessment justify the additional cost. No upgrade or
timeline is assumed.

---

# 5. Multi-Tenant Architecture

Use a shared application and shared database with logical tenant isolation.

Every tenant-owned record must include a tenantId.

Use a unique, stable GUID to identify each business. Each tenant-owned
activity must also have its own GUID and retain the owning business GUID.
These identifiers identify records and link them to the business; they do not
by themselves enforce authorization or guarantee database scalability.

Example:

Tenant
  id

Customer
  id
  tenantId

Conversation
  id
  tenantId

Message
  id
  tenantId

Booking
  id
  tenantId

For business users, the server must derive the current tenant from the
authenticated user's tenant membership.

Do not accept an arbitrary tenantId from the browser and trust it.

Business-user database operations must be constrained by the authenticated
tenant context. A separately authorised platform administrator may access
tenant data across businesses; that access must be checked server-side and
audited. A tenant role must never grant platform-wide access.

Tenant isolation is a security boundary.

## Partitioning and Tenant Safety

Partition keys are a routing and scaling mechanism, not authorization. The
server must verify membership and tenant ownership for business-user reads,
writes, point reads, and cross-partition queries. Separately authorised
platform-administrator access must also be verified and audited. Use
parameterized queries; never trust a tenant identifier or partition key
supplied by the browser as authorization.

The registration and Customer container layouts are selected below; keys for
future communications and booking containers are **not yet selected**. A user
can belong to at most one business, while platform identity, pending
applications and platform-administrator access are not ordinary tenant-owned
records. Their lookup and storage still require deliberate design.

Before creating each container, document its access patterns, item sizes,
per-key growth and retention, expected read/write rates and skew, transaction
and uniqueness requirements, and how its key is derived and kept immutable.
Use compact, bounded key values and verify the account's key-length limits.
Choosing one tenant value for all of a tenant's data can create a hot partition
and is subject to the 20 GB limit per logical partition; do not assume future
large tenants fit. Partition keys cannot be changed in place.

Cosmos DB uniqueness is scoped to the full logical partition and unique-key
policies are fixed at container creation. Do not assume global uniqueness,
foreign keys, or atomic multi-partition operations. Define enforcement,
conflict handling, and recovery explicitly before relying on them.

The available workload evidence does not certify production capacity.
Resolve these design questions before provisioning future containers.
Initial planning estimates are 100 businesses, 1,000 users, up to 200 staff in
one business, 10 simultaneously active users and 10 sign-ins per minute.
Platform-administrator audit history must be retained for one year. These
estimates do not establish document sizes, audit-event volume or data growth.

## Implemented Cosmos Storage

Database: `booksimple`. Authentication containers use the immutable
`/partitionKey` path with Hash partitioning and `defaultTtl=-1` (TTL enabled;
documents expire only when they specify a TTL). Customer, Service and channel
identity containers use the immutable `/tenantId` path. Conversations use the
hierarchical `/tenantId`, `/conversationId` key. Business-domain containers
have no default TTL.

| Container | Partition derivation | Records and retention |
| --- | --- | --- |
| `auth-control` | `account_` plus SHA-256 of trimmed, lowercase email; business GUID for business records | User/security state, hashed verification/reset tokens, encrypted email outbox, business state and settings, username reservations, business invitations, one-year admin audits, durable bootstrap lock |
| `auth-sessions` | Owning immutable account partition key | Hashed session verifiers; maximum seven-day lifetime, explicit revocation and account authorization version checks |
| `auth-throttles` | Hash of rate-limit scope and protected account key | Expiring, ETag-protected counters; no in-memory-only abuse protection |
| `customers` | Server-resolved active Business GUID in `/tenantId` | Active, archived and anonymized Customer records; durable with no automatic expiry |
| `services` | Server-resolved active Business GUID in `/tenantId` | Active and inactive bookable Service records; durable with no automatic expiry |
| `conversations` | Server-resolved Business GUID followed by Conversation GUID in a version 2 MultiHash key | Conversation summaries and separate Message documents; durable synthetic Stage 8 data with no automatic expiry |
| `channel-identities` | Server-resolved active Business GUID in `/tenantId` | Deterministic provider-neutral contact identities and optional Customer links; durable with no automatic expiry |

The plain-language record inventory, sensitivity classifications and retention
matrix are maintained in `docs/DATA-DICTIONARY.md`. Retention durations are
centralized in `src/server/data-retention.ts`; the corresponding migration is
dry-run by default. Sent email payloads are removed immediately, notification
metadata is retained for 90 days, failed or pending notification payloads for
30 days, released membership reservations for 30 days, finalized invitations
for 90 days, and privileged audits for one year. Deleted accounts remove their
email index atomically and retain only an anonymized tombstone for one year.

User GUIDs are retained separately from the deterministic account document ID.
Registration creates the user, deterministic email index, verification token
and encrypted email outbox in one account-partition transaction. Deterministic
IDs enforce email uniqueness even under concurrent registration; no query-only
global uniqueness check or global Cosmos unique-key policy is assumed.

An account has at most one embedded business membership. Business-partition
username reservations and the bounded member count are updated transactionally
using ETags; account membership writes also require ETags. Company usernames
are lowercase and unique within their business, with a 200-user ceiling.
Moving an assigned user to a different business is rejected.

## Implemented Customer Management

Customers are stored only in the dedicated `customers` container. Every list
and search query specifies the server-resolved `/tenantId` partition, and every
detail read is a Cosmos point read using both the Customer GUID and that same
tenant context. The browser cannot choose or override the tenant ID. Invalid or
cross-tenant Customer IDs return not found and cannot be used to read or update
another business's record.

Customer documents carry a `customer` discriminator and schema version. Names
are required; email and phone are optional. Email is lowercase and trimmed.
Phone punctuation is removed, leaving 7 to 15 digits with an optional leading
`+`. Name, email and canonical phone searches remain inside one tenant
partition and return continuation-token pages.

Duplicate email and phone values are deliberately allowed. Create and edit
operations run a tenant-scoped possible-duplicate query and return warnings
without merging or blocking either record. All active company users can create,
view, search, edit and archive Customers. Archived records remain available in
an explicit archived view but cannot be edited.

Permanent erasure is a separate `company_admin`-only operation requiring an
explicit confirmation value. It uses an ETag-protected replacement that removes
name, normalized search name, email and phone while retaining the Customer GUID,
tenant GUID, schema identity, erased status and timestamps for future Booking
and Conversation references. Ordinary deletion archives rather than erases.

## Implemented Service Management

Services are stored only in the dedicated `services` container. List and search
queries specify the server-resolved `/tenantId` partition, while detail reads
use a Cosmos point read with the Service GUID and authenticated tenant GUID.
Browser tenant IDs are not accepted. Invalid and cross-tenant IDs return not
found for reads, edits and status changes.

Service documents carry a `service` discriminator and schema version. Name is
required, description is optional, and duration is a positive safe integer
number of minutes. Price is stored as a non-negative safe integer in the
currency's minor unit. Decimal input is converted on the server using the
selected three-letter currency's fraction digits, so `25.50 GBP` is stored as
`2550`, while zero-decimal and three-decimal currencies retain their correct
scales. Zero-priced Services are permitted.

The create form defaults currency from the active Business, but every Service
stores its own explicit currency. All active company users can create, search,
view, edit, activate and deactivate Services within their tenant. Deactivation
preserves the Service GUID for future Booking references. Updates and status
changes use Cosmos ETags to reject conflicting writes.

Service names are not globally unique. Separate businesses can independently
create identically named Services, but tenant partitioning and authorization
prevent either business from listing or accessing the other's records.

## Implemented Conversation Management

The provider-neutral Inbox uses the dedicated `conversations` container with
hierarchical partition paths `/tenantId` and `/conversationId`. The first level
is always the authenticated Business GUID. Tenant Conversation listings include
an equality predicate on that key; detail reads and Message queries use the
complete hierarchical key. Browser tenant IDs are never accepted.

One Conversation summary and its separate, unbounded Message documents share a
full logical partition. Appending a Message creates the Message and replaces
the ETag-guarded summary in one transactional batch. The summary keeps only a
bounded preview, count, direction and timestamp. Message bodies are limited to
4,000 characters. Inbound development messages use `RECEIVED`; outbound Stage
8 replies use `LOCAL_ONLY` and the UI explicitly states they were not sent.

`channel-identities` provides one deterministic identity per tenant, channel
and normalized address. Email is lowercase; SMS and WhatsApp use canonical
phone values. A Conversation can remain unresolved with no `customerId`.
Matching checks the identity first, then exact tenant-scoped Customer email or
phone values. One exact match links during creation, several exact matches
require staff selection, and no match offers Customer creation. Names are
display-only and never drive automatic linking.

All Conversation and resolution operations derive tenant ownership from the
active membership. Linking performs a same-tenant Customer point read and
rejects archived, erased or cross-tenant records. Identity and Conversation
updates use ETags, with explicit rollback if the second cross-container update
fails. External channel adapters and real delivery are outside Stage 8.

Approval spans account and business partitions, so it is not globally atomic.
For a new membership it reserves a generated member username, records the
account with the least-privileged `company_user` role, then activates the
business. Company-administrator access requires a separate, audited platform
assignment after approval. Retry of an older approval preserves its existing
compatible membership rather than silently demoting it. The server withholds
membership for a non-active business; interrupted approval can be retried
without granting access to a pending business. Reservations are compensated
when an account assignment fails. Inspect failed/unfinished admin audit records
before manual repair.

Privileged actions have actor-scoped audit records, with affected-account
changes and their audit entries committed together. No secrets or notification
payloads belong in audit records. Role/membership changes increment the
account authorization version to invalidate older sessions.

The one-time bootstrap lock has its own fixed platform partition and no TTL.
It pins the target user and setup-token hash, allows retries for that target
and permanently prevents selecting a different first administrator.
No first administrator is created merely by provisioning containers.

The initial access patterns are account/session point reads, bounded
business-partition writes and paginated platform-admin directory queries.
Token TTLs are 24 hours for verification and one hour for password reset;
audits and email outbox records have a one-year TTL. MFA secrets and pending
outbox payloads use independent server-managed AES-256-GCM keys. Delivered
outbox payloads are removed. Future domain containers need separate estimates
and approval; this layout is not a design for storing all future tenant data.

---

# 6. Tenant Entity

The primary tenant entity should conceptually be:

Business

A Business represents a company using the platform.

Initial conceptual fields:

- id
- name
- status
- createdAt
- updatedAt

Additional configuration should be added deliberately rather than turning the Business table into an unrestricted settings container.

---

# 7. Users and Authentication

The approved direction is a custom application-managed email and password
system. All users use the same registration and sign-in system. Email
addresses are unique across the platform and cannot initially be changed.
Registered names identify users in the administration UI. Internal company
usernames remain distinct from email addresses and unique only within their
business, but are not displayed as the user's name; a platform administrator's
display name is optional. Never store plaintext passwords. Use a
well-reviewed password-hashing implementation, secure password recovery and
login-abuse protections.

Use an unpredictable server-validated session token in a Secure, HttpOnly,
appropriately SameSite cookie. The server must check session validity, expiry,
revocation and authorization; the presence of a GUID or cookie alone does not
authenticate a user. Sessions last at most seven days. Protect state-changing
requests against CSRF.

Application pages live in the `(protected)` route group and require a
server-validated session; registration, login, verification and password
recovery are intentionally public in the `(public)` group. New pages must be
placed in the protected group unless explicitly approved as public. Layout
checks do not replace checks in pages, data access, server actions or API
handlers: Next.js can reuse layouts during client navigation. Each protected
page and operation must independently enforce its authentication and role or
tenant authorization before loading protected data.

MFA is temporarily disabled for all users, including platform administrators,
by explicit product decision. Login uses verified email and password; platform
access still requires the server-verified platform role and is audited.
Password-only platform access substantially increases account-takeover risk;
reassess MFA and security before real data or production use.
Previously stored encrypted MFA secrets and backup-code verifiers are retained,
not deleted. MFA setup and challenge endpoints and UI are unavailable; retain
the encryption key securely while those records exist. Re-enabling MFA requires
an explicit design and security review, not simply exposing the old endpoints.

Before implementation, review the credential, session, MFA, recovery,
administrator-bootstrap and abuse-prevention design, including key management
and data storage. No real data may be used until these controls and tenant
isolation are implemented and verified.

The application must distinguish:

Authentication:
"Who is this user?"

from:

Authorization:
"What is this user allowed to do?"

A user can have at most one business membership. Pending applicants and
platform administrators do not require a business membership. Platform access
is a separate role, not a tenant membership.

## Implemented Tenant Context

The server derives the current tenant from the authenticated user document;
it never accepts a browser-supplied tenant identifier as proof of access. A
membership resolves to a tenant context only when a point read using the stored
business GUID returns the matching active Business document. Missing, disabled,
rejected or otherwise invalid business records do not produce a tenant context.

The viewer exposes the active business GUID and name, internal company username
and company role. Reusable guards require an authenticated tenant, require the
company-administrator role where appropriate, and reject any requested business
GUID that differs from the resolved context. The persisted `company_user` role
is the current staff-level role; it is intentionally retained to preserve the
existing document contract.

Platform administration remains separate from tenant context. A platform
administrator without a business membership has no implicit tenant access, and
a company role never grants platform access. The business dashboard requires
an active tenant context; authenticated users without one remain on their
account and application-status pages.

The Users directory is shared by platform and company administration, but its
scope is always derived server-side. Platform administrators receive the
audited cross-company view, including separate company and business-application
tables. The company table is sourced from Business records rather than
applicant accounts. Exact normalized-name matches are presented as possible
duplicates during review but do not automatically block legitimate companies
that share a name. Company
administrators receive only users whose stored membership belongs to their
active business and the one matching Business record. Company users and
unassigned accounts cannot open the page or API. The client follows bounded
Cosmos continuation pages, merges them by stable IDs and presents responsive
tables grouped by stored business membership. Platform-administrator accounts
are excluded from this company-user directory. Internal company usernames are
not shown.
Company users, cross-company platform users, business applicants and pending
invitations all use the same responsive table presentation rather than
separate card layouts. Empty pending or rejected business groups are omitted
from the company-user accordions.

Platform administrators can manage users across companies; company
administrators can manage only users already belonging to their active company.
Both may assign `company_user` or `company_admin`, pause, resume and delete
within that scope. Platform roles and business-application decisions remain
platform-only. Pausing stores the prior active or pending state, marks the
account disabled, increments its authorization version and therefore
invalidates existing sessions. Resuming restores the prior state. Deletion
replaces the account with an anonymized tombstone, removes all roles and
membership, releases the business membership reservation and invalidates
sessions. Account lifecycle changes are audited. Administrators cannot pause or
delete themselves, and the last active company administrator cannot be paused,
deleted or demoted. Company administrators also cannot change their own role.
Deleted tombstones and platform-administrator accounts are excluded from
directory results and counts; empty unassigned groups are hidden.

The platform Administration landing page contains navigation only. Its Users
Companies and Company applications links open distinct anchored sections of
the shared Users page. Business Settings is a navigation hub for the Account
business profile and, for company administrators, tenant-scoped users and
invitations.

Protected page chrome presents identity from the server-validated Viewer rather
than browser-supplied values. It shows the registered display name, all assigned
company and platform roles, and the resolved active business name. Logout uses
the existing session-revocation endpoint and redirects only after a valid
server response. Approved application details are omitted from the account page
once they duplicate the active-company header; pending or rejected applications
remain visible. A rejected applicant can correct the business name and
resubmit the same Business record for review; the operation requires the
authenticated owning account and rejects membership or non-rejected states.
Unassigned accounts are directed to request an invitation from the relevant
company administrator.

User-facing content and action links use the shared rounded blue button
treatment. Structural navigation such as the product logo, workspace sidebar,
signed-in identity link and accessibility skip link retains its purpose-specific
styling.

## Implemented Business Setup

Business documents retain the business GUID as both ID and partition key and
now include an explicit IANA timezone and three-letter operating currency.
New registrations receive `Europe/London` and `GBP` defaults. The idempotent
business-settings migration adds those fields to older documents only when
missing; it does not overwrite configured values. Company administrators can
update the business name, timezone and currency. Company users can read those
settings but cannot update them. The Business profile is shown only on the
Account page. Company administrators create and manage invitations alongside
the tenant-scoped user directory on the Users page.

Business settings requests contain no tenant identifier. The server resolves
the active tenant from the authenticated membership and uses a point read in
that business partition. Runtime validation rejects unknown fields, invalid
timezones and invalid currency codes.

Company-user invitations are stored in the business partition. Their
deterministic ID is derived from the normalized invitee email, allowing one
current invitation per email and business without relying on a query-only
uniqueness check. An invitation stores the normalized email, fixed
`company_user` role, status, inviter user GUID, creation/update/expiry times and
only a hash of its random secret. The acceptance link carries the business GUID,
invitation ID and random secret; the identifiers route the point read but do not
authorize acceptance.

Invitation links expire after seven days. Pending records have 30-day
retention, while accepted or revoked records have 90-day retention.
Postmark payloads are encrypted using the existing notification outbox. The
link opens a registration form prefilled with the invited email. New accounts
accept the invitation automatically when email verification succeeds; existing
accounts accept it automatically after signing in through the preserved
invitation link. Only a verified authenticated account whose normalized email
matches the invitation can accept. Acceptance reserves a unique internal
company username, adds the membership, increments the account authorization
version and invalidates older sessions. It can grant only `company_user`;
company-administrator and platform roles remain separate privileged operations.

Company administrators may delete pending invitations in their own business
partition. The server derives the partition from tenant context and derives the
deterministic invitation ID from the normalized email; it accepts no tenant ID.
Only pending invitations are returned to the company Users page; accepted
records remain temporarily for audit history but are not shown.
The partition batch deletes the invitation and correlated pending or failed
notification records so a failed delivery cannot later be retried. A previously
sent email cannot be recalled, but its link fails after the invitation record is
deleted. Accepted invitations cannot be deleted through this operation and
membership removal remains out of Stage 5 scope.

If the account that previously accepted an invitation is later deleted, a
company administrator may invite that email again. Registration atomically
archives the anonymized deleted-account tombstone under its former user GUID,
replaces the active account slot with a new least-privileged account and updates
the email index. Active or non-deleted accepted accounts continue to block
duplicate invitations.

Membership assignment and invitation status updates span account and business
partitions and therefore are not globally atomic. If membership succeeds before
the invitation status update, a retry after signing in recognizes the existing
matching membership and completes the invitation safely. Conflicting or reused
links fail closed.

## Agreed Foundation Data

The following is the broader logical foundation. The implemented registration
and business-setup subsets use the container layout above; future domain records
remain deferred. Identifiers for businesses and tenant-owned
activities are GUIDs; tenant-owned records retain the business ID. Persisted
documents include a schema version. The registration contracts are implemented
in the server auth modules; future contracts require separate review.

| Record | Agreed information |
| --- | --- |
| Business | ID, name, status, creation and update timestamps |
| User | ID, globally unique email, name, account status and securely protected sign-in details |
| BusinessMembership | ID, business ID, user ID, company username and company role |
| BusinessApplication | Applicant user ID, proposed business name, status and approval decision |
| Invitation | Business ID, invitee email, role, status and expiry |
| Session | Server-validated session information, including expiry and revocation |
| Platform-admin audit | Actor, action, affected scope and timestamp |

Company administrators invite and assign company users. Platform administrators
approve business applications and assign company administrators. Only an
existing platform administrator can grant another user the platform role.
New users cannot access a workspace until assigned an appropriate role, but
pending applicants can submit and check their applications.

Use Postmark for application-decision and invitation emails. Its credentials
must remain server-side and out of source control. The first platform
administrator is to be provisioned through a secure one-time setup after
registering; subsequent platform-administrator grants require an existing
platform administrator.

Email uniqueness across the platform, company-username uniqueness within a
business, and the one-business-per-user rule require race-safe enforcement.
Cosmos DB unique-key policies apply only within a logical partition; a
check-then-write query does not enforce these rules under concurrent requests.
The uniqueness, provisioning, session, MFA and recovery mechanisms and their
failure handling must be designed and reviewed before implementation.

---

# 8. Authorization

All protected operations must be authorized server-side.

Initial conceptual roles:

- Platform administrator: full platform and cross-business access, separate
  from tenant membership, with audited actions and currently password-only login.
- Company administrator: manages its own business and invites its users.
- Staff: manages bookings within its own business.

Businesses register for approval by a platform administrator. Their workspace
is enabled only after approval. Applicants can check application status and
receive approval or rejection notifications by email. Customers do not need
application accounts.

Do not create an excessively complicated permissions system during V1.

Authorization should be centralized where practical.

Never rely solely on hiding buttons in the UI for security.

---

# 9. Core Domain Structure

Keep the core business domain independent from communication and payment providers.

Conceptual modules:

/businesses
/customers
/conversations
/messages
/bookings
/services
/payments
/reminders
/integrations

These represent logical boundaries.

They do not necessarily require separate deployed services.

---

# 10. Customer Model

A customer belongs to a business.

Conceptually:

Customer
  id
  tenantId
  name
  email
  phone
  createdAt
  updatedAt

A customer may later have multiple communication identities.

Do not assume:

one phone number = one permanent customer identity.

Do not automatically merge records based solely on similar names.

---

# 11. Customer Channel Identities

External communication identifiers should be separated from the core Customer record when appropriate.

Conceptually:

CustomerChannelIdentity
  id
  tenantId
  customerId
  channel
  externalId
  metadata

Example channels:

WHATSAPP
FACEBOOK
SMS
EMAIL

This allows one customer to communicate through multiple channels.

---

# 12. Conversations

A conversation belongs to:

- a tenant
- a customer

Conceptually:

Conversation
  id
  tenantId
  customerId
  status
  createdAt
  updatedAt

A conversation contains messages.

Do not make the Conversation entity provider-specific.

---

# 13. Messages

Conceptual message model:

Message
  id
  tenantId
  conversationId
  channel
  direction
  body
  externalMessageId
  status
  sentAt
  receivedAt
  createdAt

Direction:

INBOUND
OUTBOUND

Channel examples:

WHATSAPP
FACEBOOK
SMS
EMAIL

Status may eventually include:

QUEUED
SENT
DELIVERED
FAILED
RECEIVED

Do not assume every provider supports identical status information.

---

# 14. Communication Provider Architecture

External communication providers must use adapters.

Core application logic should interact with an interface conceptually similar to:

MessagingProvider
  sendMessage()
  validateWebhook()
  parseIncomingMessage()

Provider implementations may eventually include:

MetaMessagingProvider
SmsProvider
EmailProvider

Do not call external communication APIs directly from React components or domain business logic.

---

# 15. Incoming Message Flow

Conceptual inbound flow:

External Provider
       |
       v
Webhook Endpoint
       |
       v
Verify Provider Request
       |
       v
Provider Adapter
       |
       v
Normalize Message
       |
       v
Identify Tenant
       |
       v
Identify Customer
       |
       v
Conversation
       |
       v
Message Storage
       |
       v
Unified Inbox

Provider webhook payloads must not become the application's internal message format.

Normalize them first.

---

# 16. Outgoing Message Flow

Conceptual outbound flow:

Business User
       |
       v
Unified Inbox
       |
       v
Server Action / API
       |
       v
Authorization
       |
       v
Messaging Service
       |
       v
Provider Adapter
       |
       v
External Provider
       |
       v
Customer

Store sufficient information to reconcile outgoing messages with provider delivery events.

---

# 17. Services

A bookable Service belongs to a tenant.

Conceptually:

Service
  id
  tenantId
  name
  description
  durationMinutes
  price
  active
  createdAt
  updatedAt

Money must not be represented using floating-point calculations.

Prefer integer minor units.

Example:

£25.50

should internally be stored as:

2550 pence

with an associated currency where required.

---

# 18. Bookings

Conceptual booking model:

Booking
  id
  tenantId
  customerId
  serviceId
  startAt
  endAt
  status
  totalAmount
  currency
  depositPercentage
  depositAmount
  depositStatus
  createdAt
  updatedAt

The final database schema will be refined before implementation.

Do not derive historic deposit requirements dynamically from today's business settings.

A booking should retain the deposit terms that applied when the booking was created or confirmed.

---

# 19. Deposit Configuration

Business-level deposit configuration should be separate from individual bookings.

Conceptually:

BusinessBookingSettings
  tenantId
  defaultDepositPercentage

Valid percentage:

0 to 100

When a booking is created, the applicable deposit policy can be evaluated and the resulting terms stored with the booking.

This preserves booking history if business settings later change.

---

# 20. Deposit Override

An authorised user may override the normal deposit percentage for an individual booking.

Conceptually retain:

- calculated/default deposit percentage
- applied deposit percentage
- whether an override occurred
- identity of the user making the override
- timestamp

This provides a basic audit trail.

Do not silently overwrite the original policy result.

---

# 21. Payment Architecture

Payment processing must use an external payment provider.

Payment card details must not be stored in the application database.

Use a provider adapter.

Conceptually:

PaymentProvider
  createPaymentRequest()
  retrievePaymentStatus()
  validateWebhook()

A future implementation may use a provider such as Stripe.

Provider selection is not considered permanent application architecture.

Core booking code should not depend directly on Stripe-specific data structures.

---

# 22. Payment Records

Keep payment records distinct from bookings.

Conceptually:

Payment
  id
  tenantId
  bookingId
  type
  amount
  currency
  status
  provider
  externalPaymentId
  paidAt
  createdAt

Possible types:

DEPOSIT
BALANCE
FULL_PAYMENT

Possible status values may include:

PENDING
PAID
FAILED
REFUNDED

Exact lifecycle will be defined when payment integration is implemented.

---

# 23. Reminders

Reminders must use reliable server-side/background processing.

Do not implement booking reminders using browser timers.

Conceptually:

Reminder
  id
  tenantId
  bookingId
  scheduledFor
  channel
  status
  sentAt
  createdAt

The background processor should find due reminders and dispatch them through the messaging abstraction.

---

# 24. Background Jobs

Long-running or scheduled operations must not depend upon an open browser session.

Examples:

- reminders
- message retries
- webhook processing
- payment reconciliation
- delivery-status processing

Initial development may use a simple implementation.

Production architecture must use a reliable background mechanism appropriate to the Azure deployment environment.

Avoid adding complex queue infrastructure until workload requirements justify it.

---

# 25. Webhooks

External providers will send events to webhook endpoints.

Example structure:

/api/webhooks/meta
/api/webhooks/payments
/api/webhooks/sms

Webhook handlers must:

1. validate provider authenticity,
2. validate input,
3. identify the relevant tenant,
4. normalize the provider payload,
5. process the event idempotently,
6. return an appropriate response.

Never trust incoming webhook payloads.

---

# 26. Idempotency

Webhook processing and payment operations must account for duplicate requests.

External providers may deliver the same event more than once.

Where appropriate store external event/message identifiers and ensure repeat delivery does not create duplicate:

- messages
- bookings
- payments
- payment transitions

---

# 27. Validation

Use runtime validation for:

- API input
- forms
- webhook payloads
- external service responses where appropriate

Preferred library:

Zod

TypeScript interfaces alone do not validate runtime data.

---

# 28. API Boundaries

Use Next.js server-side functionality where practical.

Possible approaches include:

- Server Actions
- Route Handlers

Use Route Handlers when a conventional HTTP endpoint is required, especially for:

- webhooks
- provider callbacks
- external integrations

Do not expose database credentials or provider secrets to client-side code.

---

# 29. Repository Structure

Initial target structure:

src/
  app/
  components/
  features/
  lib/
  server/
  integrations/
  types/

docs/
  PRODUCT.md
  ARCHITECTURE.md
  GUARDRAILS.md
  BUILD-PLAN.md

.github/
  copilot-instructions.md

Possible server structure:

src/server/
  auth/
  db/
  businesses/
  customers/
  conversations/
  bookings/
  payments/
  reminders/

Possible integration structure:

src/integrations/
  messaging/
  payments/

Do not create every directory before it is needed.

---

# 30. Environment Configuration

Secrets and environment-specific configuration belong in environment variables or managed secret storage.

Local development may use:

.env.local

The repository should include an example configuration file such as:

.env.example

Never put real credentials in .env.example.

Ensure secret-bearing environment files are excluded from Git.

---

# 31. Logging

Server-side operations should use structured logging.

Logs should include useful operational context such as:

- operation
- tenantId where safe
- integration/provider
- event identifier
- error information

Never log:

- passwords
- access tokens
- payment card data
- authentication secrets
- unnecessary sensitive customer content

---

# 32. Auditability

Important business actions should eventually be auditable.

When recorded, tenant-owned activities must carry their own GUID and the
owning business GUID; record the authenticated actor and time where
appropriate. These identifiers do not substitute for authorization.

Examples:

- deposit override
- booking cancellation
- payment refund
- business configuration change

Do not build a complex enterprise audit platform for V1.

However, the data model should not prevent audit information from being introduced.

---

# 33. Dates and Times

Store timestamps in a timezone-safe representation.

Use UTC for persisted timestamps where practical.

Business display should respect the business's configured timezone.

Do not assume every tenant operates in UK local time even if initial testing occurs in the UK.

---

# 34. Currency

Do not assume GBP is the only currency at the architectural level.

Businesses should eventually have a configured operating currency.

Represent monetary values in integer minor units.

Example:

GBP £10.50 = 1050

Never perform financial calculations using JavaScript floating-point values where rounding errors could occur.

---

# 35. Testing

Testing should focus particularly on business-critical and security-critical behaviour.

Priority tests include:

- tenant isolation
- authorization
- deposit calculations
- deposit overrides
- booking state changes
- webhook idempotency
- provider normalization
- payment status transitions
- reminder scheduling

Do not create meaningless tests purely to increase coverage percentages.

---

# 36. Database Schema Evolution

Cosmos DB does not use Prisma schema migrations. Version document contracts
and container definitions in source control, and include a schema version in
persisted document types.

For changes to existing data, plan and review compatibility, any backfill or
transformation, validation, rollback, and recovery before applying the change.
Use conditional writes such as ETags where needed to prevent lost updates.
Changing partition keys or immutable container policies requires a separately
reviewed container migration; never casually reset a database or delete data.

---

# 37. Security Boundaries

Treat the following as untrusted:

- browser input
- query strings
- route parameters
- webhook payloads
- third-party API responses
- externally supplied identifiers

Validate data at system boundaries.

Server-side code is responsible for authorization and tenant isolation.

---

# 38. Initial Deployment Philosophy

Begin with the smallest deployable architecture.

Preferred conceptual deployment:

Browser
   |
   v
Next.js Application
   |
   +---- Azure Cosmos DB for NoSQL
   |
   +---- Messaging Providers
   |
   +---- Payment Provider
   |
   +---- Background Processing

Do not split this architecture into numerous deployable services during V1.

---

# 39. Scalability

Design so individual components can be separated later if genuine scale requires it.

Likely future separation points include:

- inbound webhook processing
- outbound message processing
- scheduled reminders
- high-volume event processing

Do not prematurely optimize for millions of users.

Correctness, security and product validation come first.

---

# 40. Architecture Decision Rule

Before adding a new technology or dependency, answer:

1. What problem does it solve?
2. Is that problem present now?
3. Can the current architecture solve it adequately?
4. What operational complexity does the new technology introduce?

If there is no clear present requirement, do not add the technology.

---

# 41. Initial Architecture Summary

The V1 architecture is therefore:

Frontend:
Next.js + React + TypeScript

Backend:
Next.js server-side functionality

Database:
Azure Cosmos DB for NoSQL

Database access:
Official Azure Cosmos DB JavaScript SDK, server-side

Validation:
Zod

Tenancy:
Shared application + shared database with explicit tenant isolation

Messaging:
Provider adapter architecture

Payments:
External provider adapter architecture

Background Work:
Server-side scheduled/background processing

Hosting:
Microsoft Azure

Architecture Style:
Modular monolith

The modular monolith is intentional.

It provides clear domain boundaries without creating the operational complexity of microservices before the product requires them.