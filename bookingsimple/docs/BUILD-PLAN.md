# Universal Communications & Booking Platform
## Build Plan

# 1. Purpose

This document defines the controlled implementation sequence for the platform.

The application must be built incrementally.

Copilot must NOT attempt to build the entire platform in one operation.

For every stage:

1. Read the project instruction and documentation files.
2. Inspect the current implementation.
3. Implement only the requested stage.
4. Run the required checks.
5. Fix errors introduced by that stage.
6. Report what changed.
7. STOP.

Do not continue automatically to the next stage.

---

# 2. Build Philosophy

The build sequence is designed to prove the highest-risk foundations before adding external integrations.

The order is intentionally:

Foundation
↓
Database
↓
Authentication
↓
Multi-tenancy
↓
Customers
↓
Services
↓
Conversations
↓
Bookings
↓
Deposits
↓
Payments
↓
Reminders
↓
External communication channels

Do not reverse this sequence merely to demonstrate an external API early.

The product must have a sound internal model before connecting real providers.

---

# STAGE 0 — Project Documentation

## Objective

Establish the product definition, architecture, development rules, and build plan before application code is generated.

## Required Files

`.github/copilot-instructions.md`

`docs/PRODUCT.md`

`docs/ARCHITECTURE.md`

`docs/GUARDRAILS.md`

`docs/BUILD-PLAN.md`

`README.md`

## Completion Criteria

- Product purpose documented.
- Architecture documented.
- Guardrails documented.
- Build stages documented.
- Copilot instructions available.
- No application functionality required.

## Current Status

COMPLETE.

---

# STAGE 1 — Application Foundation

## Objective

Create the basic application and prove the development environment works.

## Build

Create a Next.js application using:

- TypeScript
- App Router
- ESLint

Use a clean `src` based project structure.

Set up basic responsive styling.

Create only the minimum application shell required.

## Initial UI

Provide:

- application shell
- simple home/dashboard placeholder
- navigation structure
- mobile-friendly layout

Do not implement real business features yet.

## Required Development Commands

The project must support:

`npm run dev`

`npm run build`

`npm run lint`

## Completion Criteria

- application starts locally
- home page loads
- TypeScript compiles
- production build succeeds
- lint succeeds
- responsive shell works
- no unnecessary dependencies introduced

STOP after completion.

---

# STAGE 2 — Database Foundation

## Objective

Establish a safe server-side Azure Cosmos DB for NoSQL foundation and controlled
document and container management.

## Decisions Before Implementation

Before creating containers or connecting an environment, agree and document:

- Container layout and partition keys based on access patterns, traffic, data
  growth, retention, and uniqueness and transaction requirements.
- The approved initial development target is the existing Azure Cosmos DB
  account, using synthetic data only. Before real data is accepted, agree and
  verify separation of development and production access and data.
- The approved initial connectivity approach is a public Cosmos DB endpoint
  with an account key for local development or least-privilege Microsoft Entra
  data-plane access. Plan Vercel OIDC
  federation and separately authorised local development access; do not assume
  Azure managed identity is available on Vercel. Review deployment identity,
  permissions, monitoring and incident response before enabling access.
- Container configuration and document-versioning workflow, including safe
  handling of future data and immutable partition keys.

Registration partition keys and containers are now approved and documented
in `docs/ARCHITECTURE.md`. Future domain containers require separate decisions.
Public network and key authentication have been enabled on the existing
account. Key authentication is account-wide even though the application
restricts key mode to local development; review this risk before real data.
Creating additional Azure resources requires
separate explicit approval. Revisit restricted or private networking when
commercial circumstances and the security assessment justify the cost.

## Build

After those decisions are agreed, add:

- The official Azure Cosmos DB JavaScript SDK and server-side connection.
- Environment configuration with no real credentials in source control.
- Version-controlled document and container definitions and a reviewed
  schema-evolution process.
- Focused connection and configuration checks against the approved development
  target.

The server-side client, explicit auth container provisioning/readback, and local
synthetic persistence checks are in place. Vercel federation and safe deployment
environment separation remain unverified.

Create:

`.env.example`

Ensure real environment files are excluded from Git.

## Initial Document Design

Start with foundation entities required for tenancy:

Business

User

BusinessMembership

The agreed logical registration design also identifies applications,
invitations, sessions and platform-administrator audit records; see
`docs/ARCHITECTURE.md`. The registration subset has an approved container design;
invitations and future product entities remain deferred.
Do not implement authentication or tenant-context functionality in Stage 2.

## Completion Criteria

- container layout and keys are documented and approved before creation
- the approved development connection works server-side
- foundation document and container definitions are version controlled
- schema evolution and recovery approach is documented and verified as applicable
- the development target and limitations of verification are reported
- secrets are not committed
- no authentication, tenant-context, or business functionality is implemented

STOP after completion.

---

# STAGE 3 — Authentication

## Objective

Introduce user authentication.

## Current Registration Implementation Scope

The approved implementation combines the authentication and authorization
prerequisites needed for registration and platform administration. Include:

- email/password registration and email verification
- seven-day revocable sessions and password recovery
- password-only sign-in for all roles while MFA is temporarily disabled
- a protected platform-administrator area
- a secure one-time first-administrator setup after registration
- business-application approval and assignment of registered users

Do not add booking functionality or company invitation management in this
step. Account registration must never let an applicant select privileged
roles. Platform privileges require server-side role authorization. Removing MFA
increases the risk of platform-wide compromise and must be reassessed before
real data or production use.

### Testing Strategy

Use focused tests for password/session handling, platform authorization,
tenant boundaries and unauthorized role changes. Use the authorised Cosmos
account to verify container policies and persistence with uniquely identified
synthetic records, cleaning up only those records afterwards. Mock Postmark
for deterministic failure tests; do not claim mocked delivery is live delivery.

The opt-in lifecycle tests cover registration and one-time verification,
provider failure and verification resend, password reset and session
revocation. They use real Cosmos
storage and a stubbed Postmark transport, with UUID-scoped cleanup. The
synthetic security script separately exercises bootstrap locking and
privileged role/membership checks and races. See `README.md` for commands.

Browser checks exercise registration, login/recovery/resend feedback,
responsive layout and protected-page redirects. Mocked API checks validate
UI behavior only; live Cosmos checks and server-side authorization tests
are separate evidence. Real Postmark delivery, deployed Vercel OIDC access
and initial administrator bootstrap remain unverified and must be configured
and validated before accepting real data.

Exercise rendered registration and sign-in forms in a browser, including
mobile layout, failed requests and protected-page redirects. Verify actual
registration, verification and administrator workflows against configured
services before production use. Vercel OIDC and actual Postmark delivery must
be reported separately from local or mocked validation. Run tests, lint,
typecheck and production build before reporting completion.

## Build

The approved direction is application-managed email and password
authentication. Before implementation, review password hashing, session
management, login-abuse protection, retained MFA encryption and key management,
recovery, and initial platform-administrator provisioning.

Authenticator MFA is temporarily unavailable for all roles. Existing encrypted
MFA data is retained. Review the security impact before production or restoring
MFA; do not assume the former endpoints remain enabled.

The authentication system must establish:

- user identity
- server-side session
- protected application routes
- authenticated user retrieval
- server-side session expiry and revocation

Do not confuse authentication with tenant authorization.

## Completion Criteria

- user can sign in
- user can sign out
- protected routes reject unauthenticated requests
- authenticated identity is available server-side
- secrets remain server-side
- build and lint pass

## Current Status

COMPLETE for the approved local Stage 3 scope.

The automated test suite, lint, typecheck, production build and synthetic
Cosmos authorization checks pass. Persisted authorization coverage verifies
that assigning a company-administrator membership invalidates the previous
session but does not grant platform-administrator access. Local registration,
sign-in, sign-out and company-role behavior have also been exercised manually.

Real Postmark delivery and deployed Vercel OIDC access remain unverified and
must be validated separately before accepting real data or treating the
deployment as production-ready.

STOP after completion.

---

# STAGE 4 — Tenant Context and Authorization

## Objective

Establish strong tenant isolation before creating customer/business functionality.

## Build

Implement:

- Business membership lookup
- current business context
- server-side tenant authorization
- separate platform-administrator, company-administrator and staff roles
- server-side authorization and auditing of platform-administrator actions

Create reusable mechanisms for obtaining the authorized business context.

## Critical Tests

Prove:

User in Business A can access Business A.

User in Business A cannot access Business B.

Supplying Business B's ID manually does not bypass authorization.

A signed-in platform administrator can exercise platform access without MFA;
tenant membership alone must not grant platform-wide access.

## Completion Criteria

- current tenant can be resolved securely
- authorization occurs server-side
- cross-tenant access tests pass
- tenant context is reusable by future modules

## Current Status

COMPLETE for the approved Stage 4 scope.

The server now resolves an active business context from the authenticated
user's stored membership and a matching Business point read. Reusable guards
require tenant membership, distinguish company administrators from the
persisted `company_user` staff-level role, and reject a different business GUID.
Platform administration remains separately authorized and audited.

New business approvals now assign only the least-privileged `company_user`
membership. Company-administrator access is never automatic and requires a
separate audited assignment by a platform administrator. Existing compatible
memberships are preserved during approval retries.

Platform administrators can also open a dedicated user directory that loads
the existing paginated, audited platform data and groups all registered users
by company. It displays company roles and the independent platform role,
including explicit groups for platform-only and unassigned accounts. Both the
page and data API enforce platform authorization server-side.

Protected pages now share a prominent identity header and footer. The header
uses the validated Viewer to show the registered user, all assigned roles and
active company on one line, and provides session-revoking logout. Redundant
approved-application and identity details are omitted from the account page.

Automated policy tests, persisted synthetic Cosmos checks and a rendered-page
integration test prove that unassigned users cannot enter a workspace, Business
A's context accepts Business A and rejects another business identifier, and
tenant membership does not grant platform access. The full test suite, lint,
typecheck and production build pass.

STOP after completion.

---

# STAGE 5 — Business Setup

## Objective

Allow the basic business profile to be managed.

Business registration requires platform-administrator approval before the
workspace is enabled. Applicants can check application status and receive
approval or rejection notifications by email. Company administrators invite
their users. Use Postmark for decision and invitation emails. Design the
workflow and notification integration before
implementation; authentication and tenant authorization remain prerequisites.

## Build

Provide basic business configuration.

Initial fields may include:

- business name
- timezone
- country
- currency

Do not add a large settings system.

## Defaults

Initial testing may use:

Timezone:
Europe/London

Country:
GB

Currency:
GBP

However, these must be explicit configuration values rather than permanent architectural assumptions.

## Completion Criteria

- authorized user can view business details
- authorized user can update permitted business settings
- another tenant cannot access or modify those settings
- validation exists
- mobile layout works

## Current Status

COMPLETE for the approved Stage 5 scope.

The business settings page and APIs allow both company roles to view the active
business profile while only company administrators can update its name,
timezone, country and currency. Requests derive the tenant exclusively from the
authenticated membership and reject unknown fields, including browser-supplied
tenant identifiers.

Company administrators can send seven-day Postmark invitations for the
staff-level `company_user` role. Invitation links open the registration form
with the invited email. New accounts join automatically after email
verification, while existing accounts join automatically after signing in
through the invitation flow. Acceptance cannot grant company-administrator or
platform access, invalidates old sessions and is retry-safe across the account
and business partitions.

Company administrators can also delete pending invitations created for an
incorrect email. Deletion invalidates the acceptance link and atomically removes
correlated pending or failed notification records from the business partition.
Accepted invitations and memberships are not removed by this action.

The platform user directory supports audited pause, resume and anonymized
deletion of other accounts. Existing sessions are invalidated, deleted
memberships are released, and safeguards prevent self-lockout or removal of a
business's last company administrator. Company administrators cannot change
their own role.

The platform Administration landing page is navigation-only. The shared Users
page provides separate company records and business-application controls to
platform administrators, including possible duplicate-name warnings during
approval. Company administrators can open the same route but
receive only their server-resolved active-company users; they can assign either
company role and perform lifecycle actions only inside that tenant. Company
users have no access. Platform roles and application decisions remain
platform-only, and last-active-administrator safeguards also apply to role
demotion.

Rejected applicants can correct their business name and resubmit the same
application. The Business Settings route is a settings hub linking to the
Account business profile and tenant user administration. Pending invitations
use the shared responsive table presentation.

New Business documents receive explicit defaults, and the idempotent migration
successfully updated the existing development Business document without
overwriting configured values. Policy tests, live synthetic Cosmos workflows,
rendered page/API integration tests, the full test suite, lint, typecheck and
the production build pass. Real Postmark delivery remains environment-dependent
and was stubbed during automated invitation verification.

STOP after completion.

---

# STAGE 6 — Customer Management

## Objective

Create the first real tenant-owned business domain.

## Build

Add the Customer model and customer management functionality.

Initial Customer information:

- name
- email
- phone
- status
- createdAt
- updatedAt

All customers must belong to a tenant.

## Approved Data Decisions

- Use a dedicated `customers` container partitioned by `/tenantId`; do not add
  Customers to `auth-control` or a generic everything container.
- Store a type discriminator and schema version on every Customer.
- Allow duplicate customer email and phone values because contact details can
  legitimately be shared. Warn within the active tenant instead of enforcing a
  unique-key policy.
- Archive customers during normal use. A separate permanent-erasure operation
  anonymizes personal fields while preserving stable identifiers and timestamps
  needed by future Booking and Conversation references.
- Derive `tenantId` from authenticated membership for every operation.
- Keep the approved field-level model, retention rationale and access patterns
  synchronized with `docs/DATA-DICTIONARY.md`.

## UI

Create:

- customer list
- customer search
- create customer
- customer detail
- edit customer

## Critical Tests

Verify:

Business A cannot see Business B customers.

Business A cannot retrieve a Business B customer by changing the URL/ID.

Business A cannot update a Business B customer.

## Completion Criteria

- CRUD behaviour works
- validation works
- tenant isolation tests pass
- responsive UI works
- build and lint pass

## Completion

Implemented with a dedicated `customers` container partitioned by `/tenantId`.
Customer list and contact search use bounded continuation-token pages inside
the authenticated tenant partition. Customer detail uses point reads with the
Customer GUID and server-resolved tenant GUID. Create and edit return
tenant-scoped duplicate email/phone warnings without blocking the write.

All active company users can create, view, search, edit and archive Customers.
Archived records retain their business identity. Permanent erasure is restricted
to company administrators and removes name, search name, email and phone while
retaining anonymous identifiers and timestamps. Runtime input validation,
ETag-protected updates, cross-tenant API and URL denial, responsive tables and
the workspace Customers link are implemented.

STOP after completion.

---

# STAGE 7 — Services

## Objective

Allow businesses to define generic bookable services.

## Model

Initial Service information:

- tenantId
- name
- description
- durationMinutes
- price
- currency
- active

Money must use integer minor units.

Example:

£25.50

stored as:

2550

## UI

Create:

- service list
- create service
- edit service
- activate/deactivate service

Do not introduce beauty-specific terminology.

## Completion Criteria

- tenant-scoped service management works
- money handling uses minor units
- validation works
- tenant isolation verified
- responsive UI works

## Completion

Implemented with a dedicated `services` container partitioned by `/tenantId`.
Service list and name/description search use bounded continuation-token pages
inside the authenticated tenant partition. Service details use point reads with
the Service GUID and server-resolved tenant GUID.

All active company users can create, view, search and edit Services and can
activate or deactivate them. Prices are converted server-side from decimal
input to safe integer minor units using the selected currency's fraction
digits. Zero prices are supported. Currency defaults to the active Business
currency in the UI and remains explicit on every Service document.

Runtime input validation, ETag-protected updates, cross-tenant API and URL
denial, responsive tables, and the workspace Services link are implemented.

STOP after completion.

---

# STAGE 8 — Conversation Domain

Status: COMPLETE

## Objective

Create the provider-neutral internal communication model before connecting external messaging providers.

## Models

Create:

Conversation

Message

CustomerChannelIdentity if required by the agreed schema.

## Approved Customer Identity Flow

- A Conversation may start with an existing Customer or an unresolved channel
  contact. Businesses do not have to pre-create every Customer.
- An unresolved contact does not automatically become a full Customer record.
- Staff can link the Conversation to an existing Customer or create a Customer
  from the Conversation when the person's identity is understood.
- A verified exact channel identity may support automatic matching later.
  Similar names, phone fragments or other weak matches must never silently merge
  Customer records.
- Matching is always scoped to the active tenant. The system tries exact
  verified channel identity first, then exact normalized email or phone.
- If exactly one Customer matches, the Conversation can be linked
  automatically. If several Customers share the exact contact value, staff must
  choose the correct Customer or keep the contact unresolved.
- If no Customer matches, the inbox offers to create a new Customer with the
  known contact details prefilled. Creation is never forced.
- Customer names may be displayed to help staff review exact-match candidates,
  but name similarity alone never links records automatically.
- A Conversation may remain unresolved, but creating a Booking from it requires
  a resolved Customer.
- Stage 8 therefore includes the minimum provider-neutral channel-identity
  record needed to represent and later resolve an inbound contact.

## Message Concepts

Direction:

INBOUND

OUTBOUND

Channel:

WHATSAPP

FACEBOOK

SMS

EMAIL

Initial message creation may be local/development-driven.

Do NOT connect real communication APIs yet.

## UI

Build the first unified inbox.

Required concepts:

- conversation list
- customer identity
- last message
- channel indicator
- conversation view
- message history
- reply input

Replies may initially be stored locally in the database rather than sent to an external provider.

This proves the internal domain first.

Implemented with a dedicated hierarchical `conversations` container using
`/tenantId` then `/conversationId`, plus a tenant-partitioned
`channel-identities` container. Conversation summaries and separate Message
documents share the full hierarchical partition, so appending a Message and
updating the inbox preview occurs in one transactional batch.

The Inbox supports unresolved contacts, exact tenant-scoped Customer matching,
ambiguous-match selection, existing-Customer search, Customer creation with
known contact details prefilled, and local development messages. Outbound
messages are visibly marked `LOCAL_ONLY` and no external provider APIs are
connected.

Runtime validation covers tenant-isolated lists, URL and API denial across
tenants, cross-tenant Customer-link denial, exact and ambiguous matching,
no-match creation and linking, local-only delivery, and atomic Conversation
summary updates.

## Completion Criteria

- conversations can be created
- messages can be stored
- inbound/outbound direction works
- conversations display correctly
- tenant isolation verified
- UI resembles a usable business inbox
- no provider-specific logic leaks into domain code

STOP after completion.

---

# STAGE 9 — Booking Foundation

Status: COMPLETE

## Objective

Allow a conversation/customer to produce a booking.

## Model

Introduce Booking.

Initial booking information:

- tenantId
- customerId
- serviceId
- startAt
- endAt
- status
- totalAmount
- currency
- createdAt
- updatedAt

## Initial Statuses

PENDING

AWAITING_DEPOSIT

CONFIRMED

COMPLETED

CANCELLED

NO_SHOW

Do not add unnecessary workflow complexity.

## UI

Allow:

- booking creation
- booking viewing
- booking editing where appropriate
- booking cancellation
- viewing customer bookings

Where appropriate, allow booking creation directly from a conversation.

## Completion Criteria

- booking can be created for a customer
- service can be selected
- times are stored correctly
- tenant timezone is respected for display
- tenant isolation verified
- booking state is explicit

Implemented with a dedicated `bookings` container partitioned by `/tenantId`.
The server validates Customer, Service and optional Conversation ownership
using the authenticated tenant. New Bookings start `PENDING`; Service duration,
price and currency are snapshotted, while UTC start/end instants and the
Business timezone preserve correct display.

The Booking workspace supports creation, Customer and status filtering, detail
viewing, non-terminal detail editing, explicit status changes and cancellation.
Customer pages link to their Bookings, and resolved Conversations can open the
creation form with Customer and Conversation context prefilled.

Runtime validation covers timezone and DST behavior, tenant-isolated lists and
point reads, cross-tenant URL/write denial, Conversation-Customer consistency,
Service-derived totals, editing, cancellation and terminal edit protection.

STOP after completion.

---

# STAGE 10 — Deposit Engine

## Objective

Implement the business deposit rules without processing real payments yet.

## Business Configuration

Add:

defaultDepositPercentage

Valid range:

0 to 100 inclusive.

## Booking Behaviour

When a booking is created, calculate and preserve:

- default deposit percentage
- applied deposit percentage
- deposit amount
- whether the deposit was overridden

Do not derive historic booking deposits from current business settings.

## Calculation

Use integer minor units.

Example:

Booking:

£80.00

Internal value:

8000

Deposit:

25%

Deposit amount:

2000

Displayed:

£20.00

Define deterministic rounding for calculations that do not divide exactly.

## Deposit Override

Allow appropriately authorized users to change the deposit percentage for an individual booking.

Retain:

- original percentage
- applied percentage
- overriding user
- override timestamp

## Critical Cases

Test:

0%

1%

25%

50%

99%

100%

and rounding cases.

Implemented with a company-administrator-managed Business default from 0% to
100%. New Bookings snapshot the default and applied percentages, calculated
minor-unit amount and override state. Calculations round half up to the nearest
minor unit without unsafe percentage multiplication.

All active company users who can manage Bookings may apply a Booking-specific
override. The current override records the authenticated user ID, member
username and timestamp. Completed, cancelled and no-show Booking terms are
final. Selecting a different Service recalculates the amount from the Booking's
preserved applied percentage; changing the Business default never rewrites
historic Bookings.

Legacy Stage 9 Bookings are migrated to explicit 0% terms because no deposit
obligation existed before this stage. Validation covers 0%, 1%, 25%, 50%, 99%,
100%, non-exact rounding, the safe integer boundary, authorization, terminal
status protection and tenant isolation. No payment state or collection is
introduced.

## Completion Criteria

- defaults work
- overrides work
- historical terms are preserved
- calculations are deterministic
- authorization works
- tenant isolation verified

STOP after completion.

---

# STAGE 11 — Payment Domain

## Objective

Create the internal payment model before connecting a real payment provider.

## Model

Introduce Payment.

Conceptual fields:

- tenantId
- bookingId
- type
- amount
- currency
- status
- provider
- externalPaymentId
- paidAt
- createdAt

Possible payment types:

DEPOSIT

BALANCE

FULL_PAYMENT

Initial statuses:

PENDING

PAID

FAILED

REFUNDED

## Development Behaviour

Use an explicitly labelled mock/test payment provider.

The UI must make it clear that this is NOT a live payment.

## Workflow

Prove:

Booking
↓
Deposit Required
↓
Payment Request
↓
Mock Payment
↓
Payment Confirmed
↓
Booking Confirmed

## Completion Criteria

- payment domain works
- payment state affects booking appropriately
- duplicate payment notifications are handled safely
- tenant isolation verified
- mocked payment clearly identified as simulated

Implemented with a dedicated `payments` container partitioned by `/tenantId`.
Stage 11 initially created one deterministic `DEPOSIT` Payment per Booking and
snapshotted the Booking deposit amount and currency. The explicitly approved
early Stripe provider work now also implements `BALANCE`: only after a positive
deposit is paid, or for the full Booking amount when the deposit is 0%.

The `MOCK_TEST` provider adapter and UI are explicitly labelled as simulated;
no card details, provider credentials or real money are involved. Creating a
request moves a `PENDING` Booking to `AWAITING_DEPOSIT`. A successful simulated
notification uses an ETag-protected Payment transition to `PAID`, then
retry-safely reconciles the Booking to `CONFIRMED`.

Duplicate request creation is prevented by the deterministic Payment ID.
Duplicate success notifications preserve the original `paidAt` timestamp and
reconcile rather than applying a second effect. Deposit terms and Service
pricing are locked once a pending or paid deposit Payment exists. Tenant
ownership is resolved server-side for every Payment list, create and simulate
operation.

STOP after completion.

---

# STAGE 12 — Reminder Domain

## Objective

Create booking reminders before connecting them to real communication providers.

## Model

Introduce Reminder.

Conceptual fields:

- tenantId
- bookingId
- scheduledFor
- channel
- status
- sentAt
- createdAt

## Behaviour

Allow reminder configuration.

Do not use browser timers.

Create a server-side mechanism capable of finding due reminders.

Initially, reminder delivery may use a development/mock provider.

## Critical Tests

Verify:

- reminders are created correctly
- cancelled bookings do not receive inappropriate reminders
- duplicate processing does not repeatedly send reminders
- timezone handling is correct
- tenant isolation works

## Completion Criteria

- reminder scheduling works
- due reminder detection works
- retry/idempotency behaviour is defined
- mock delivery works
- browser does not control business-critical scheduling

Implemented with company-administrator-managed Business defaults containing up
to five unique channel/offset rules. EMAIL, SMS, WHATSAPP and META are
provider-neutral labels in this stage. Offsets range from one minute through
seven days and apply only to new Bookings.

New Bookings create deterministic tenant-partitioned Reminder records that
snapshot their rule, UTC schedule, Booking start and IANA timezone. Editing a
Booking reschedules unsent reminders; completed, cancelled and no-show
Bookings cancel them. Reads point-check the Booking in the authenticated
tenant, and browser tenant IDs are never accepted.

The standalone `process:reminders` worker finds due records without a browser,
claims them using Cosmos ETags and five-minute leases, rechecks Booking state
and schedule, and records a deterministic `MOCK_TEST` result without sending a
customer message. Sent records are not selected again. Failures use bounded
exponential retry times and expired processing leases are recoverable.

Validation covers automatic creation, UTC scheduling across tenant timezones,
rescheduling, terminal cancellation, cross-tenant denial and duplicate
processing. The reviewed `reminders` container is provisioned with
`/tenantId`.

STOP after completion.

---

# STAGE 13 — Messaging Provider Interface

## Objective

Create the provider abstraction required for real two-way communication.

## Build

Define the internal messaging-provider contract.

Conceptually support:

- sendMessage
- validateWebhook
- parseIncomingMessage

Provider code must translate between:

external provider models

and

internal Message models.

## Completion Criteria

- provider abstraction exists
- core conversation logic does not know provider payload structures
- mock provider implements the interface
- provider can be replaced without redesigning Conversation or Message

Implemented with a server-only `MessagingProviderAdapter` defining
`sendMessage`, `validateWebhook` and `parseIncomingMessage`. Its inputs and
outputs use normalized internal channel, address, body, timestamp and
correlation types; provider-specific payloads are raw only at the adapter
boundary.

The `MOCK_TEST` adapter supports WHATSAPP, FACEBOOK, SMS and EMAIL, returns a
deterministic external message reference for the same internal Message ID,
validates a development-only body digest before parsing, and translates its
strict runtime-validated payload into normalized incoming messages. The
messaging service validates outbound requests and untrusted adapter results,
bounds webhook bodies and fails explicitly for unknown providers or
unsupported channels.

Message documents now allow optional provider, external-message and
provider-event identifiers so later delivery events can correlate without
redesigning Conversation storage. No real provider, public communication
webhook or external send is introduced. Existing Inbox replies remain
`LOCAL_ONLY` until Stage 14 selects one real channel.

STOP after completion.

---

# STAGE 14 — First Real Communication Channel

Status: COMPLETE

## Objective

Connect one real communication channel end-to-end.

Do NOT attempt WhatsApp + Facebook + SMS + Email simultaneously.

Select the first provider/channel before implementation begins.

## Required Flow

Customer
↓
External Channel
↓
Provider
↓
Webhook
↓
Application
↓
Customer Identification
↓
Conversation
↓
Unified Inbox

Reply:

Business
↓
Unified Inbox
↓
Messaging Service
↓
Provider Adapter
↓
Provider
↓
Customer

## Requirements

- webhook authentication/validation
- normalized message input
- duplicate-event protection
- outbound send
- send failure handling
- external message ID tracking
- tenant identification
- logs without secrets

## Completion Criteria

- real inbound message appears in inbox
- business can reply
- customer receives reply
- duplicate webhook does not duplicate message
- failures are visible/handled
- tenant isolation proven

## Implemented Stage 14 Design

Postmark Email is the single real channel. Outbound sends use the existing
verified platform sender and a provider-neutral adapter. Each browser send has
a UUID request ID and is persisted before provider I/O; repeated requests do
not send twice. Messages retain Postmark Message IDs and explicit pending, sent
or failed state.

Email channel identities store a random opaque inbound route key. The Postmark
`ReplyTo` uses that key through `MailboxHash` plus-addressing. The public
inbound Route Handler authenticates with server-held HTTP Basic Auth
credentials, validates and normalizes the Postmark payload, resolves exactly
one route, verifies the sender against the tenant-local Email identity and
uses a deterministic provider Message ID for duplicate protection. Unknown or
sender-mismatched routes are safely logged without credentials, addresses or
message content and are acknowledged without creating a Message.

Twilio SMS, Meta WhatsApp/Facebook, attachments and delivery/bounce webhooks
remain deferred.

STOP after completion.

---

# STAGE 15 — Real Payment Provider

Status: COMPLETE IN STRIPE TEST MODE; LIVE PAYMENTS ARE NOT ENABLED

## Objective

Replace the mock payment implementation with a real provider adapter.

The payment provider must be selected explicitly before implementation.

## Required Flow

Booking
↓
Deposit Required
↓
Payment Request
↓
Secure Provider Checkout
↓
Provider Payment
↓
Verified Webhook
↓
Payment Record Updated
↓
Booking Confirmed

## Requirements

- no card details stored
- webhook verification
- idempotent processing
- failed payments handled
- provider reference retained
- tenant/booking association verified

## Completion Criteria

- test/sandbox payment succeeds
- payment webhook updates correct booking
- duplicate webhook is safe
- payment failure is handled
- booking confirmation follows correct payment state

Do not enable production payments without explicit approval.

The approved provider is Stripe Connect with OAuth connection of an existing
full-Dashboard Stripe account. Checkout uses direct charges and no application
fee. BookSimple stores only the connected account ID, never OAuth tokens.
Separate test and live references prevent mode crossover. Signed
connected-account Checkout webhooks, not browser redirects, are payment
authority.

Application implementation and deterministic tests are complete. A real
test-mode existing-account OAuth connection and Checkout payment remain
environment-gated until the platform secret key, Connect client ID, exact OAuth
redirect URI and Connect webhook signing secret are configured outside source
control. Live mode is not approved by this implementation status.

STOP after completion.

---

# STAGE 16 — Booking Confirmation Messaging

Status: COMPLETE

## Objective

Connect confirmed bookings to customer communications.

## Behaviour

When a booking becomes confirmed:

1. create confirmation communication,
2. select the configured/appropriate channel,
3. dispatch through messaging provider abstraction,
4. record the outbound message,
5. track status where supported.

Ensure retries cannot repeatedly send confirmations without control.

## Completion Criteria

- confirmed booking generates correct confirmation
- message is associated with customer/conversation
- duplicate confirmation risk is controlled
- provider failure is handled

Implemented routing reuses a supported originating Conversation and otherwise
falls back to the Customer's Email Conversation. A deterministic tenant-owned
confirmation record and Message request ID control duplicate sends across
manual transitions and payment webhook retries. Missing contact details or
provider failures leave the Booking confirmed and record an explicit failed
confirmation outcome.

STOP after completion.

---

# STAGE 17 — Real Reminder Delivery

Status: COMPLETE

## Objective

Send actual booking reminders using the messaging architecture.

## Flow

Scheduled Reminder
↓
Background Processor
↓
Validate Booking State
↓
Messaging Service
↓
Provider Adapter
↓
Customer
↓
Record Result

## Completion Criteria

- reminder sends without an active browser
- cancelled booking is checked before sending
- duplicate processing is safe
- delivery result is recorded
- failures are visible and retryable where appropriate

## Implemented Stage 17 Design

The existing tenant-partitioned Reminder worker now sends Email reminders
through the configured messaging provider and records the Conversation and
Message identifiers on the Reminder. Deterministic Message identifiers,
ETag-protected claims and processing leases make duplicate worker invocations
safe. The worker re-reads the Booking immediately before delivery and cancels
the Reminder when the Booking is completed, cancelled, no-show or missing.

A Vercel Cron invokes a server-only Route Handler every minute. Vercel must
supply the configured `CRON_SECRET` as a bearer token; missing configuration
fails closed and the secret is never logged. SMS, WhatsApp and Meta rules
record explicit retryable `UNSUPPORTED_CHANNEL` failures until their provider
adapters are connected. Provider and routing failures remain visible on the
Reminder and use the existing bounded retry schedule.

Production validation on `www.booksimple.app` confirmed that the secured Cron
processes overdue Email reminders without an active browser, Postmark delivers
them, and each configured rule retains its own persisted `SENT` result. The
controlled Booking had distinct 1,440-minute and 5-minute rules; both appeared
as Sent after delivery, retained an attempt count of one, and were not
reprocessed by later Cron cycles.

STOP after completion.

---

# STAGE 18 — Additional Communication Channels

Status: IN PROGRESS — TWILIO SMS PRODUCTION CONFIGURED; LIVE CARRIER VALIDATION PENDING

## Objective

Expand the unified inbox after the first provider architecture is proven.

Potential channels:

- WhatsApp
- Facebook / Meta
- SMS
- Email

Add one channel at a time.

For each channel:

1. create/extend provider adapter,
2. validate incoming webhooks,
3. normalize messages,
4. prove tenant mapping,
5. prove incoming messaging,
6. prove outgoing messaging,
7. test failures,
8. test duplicates,
9. STOP before adding another channel.

Do not duplicate core conversation logic for each provider.

## SMS Increment

The first Stage 18 increment adds Twilio SMS only. Postmark remains the Email
provider; WhatsApp and Facebook / Meta remain deferred.

Implemented:

- channel-aware provider selection preserves local `MOCK_TEST`, routes real
  Email to Postmark and routes real SMS to Twilio,
- bounded server-side tenant routes reject duplicate tenants and duplicate
  Account SID plus destination-number mappings,
- outgoing Inbox SMS uses the tenant route, retains the Twilio Message SID and
  preserves request-ID send idempotency and visible failure state,
- the Twilio form webhook is size-bounded, signature-authenticated against the
  canonical application origin and normalized inside the adapter,
- authenticated `AccountSid` plus `To` resolves the tenant before a
  deterministic sender identity is point-read in that tenant partition,
- Twilio Message SID retries produce one stored Message,
- focused provider tests cover sends, safe provider failures, authentication,
  normalization and ambiguous configuration, and an environment-backed
  integration test covers persistence, retries and tenant isolation.

Production configuration evidence:

- the tenant-scoped Twilio route is stored as a masked Vercel Production
  secret,
- the replacement Twilio Auth Token was promoted to primary and the exposed
  token was retired,
- Vercel Production deployment `6Zp5bsseudX9HSmnzYiDegpzDFX7` completed as
  Ready and was assigned to `https://www.booksimple.app`,
- the Twilio number persists
  `https://www.booksimple.app/api/webhooks/twilio/sms` as its incoming-message
  HTTP POST webhook after a page reload, and
- an unsigned production webhook probe returns `401` with safe empty TwiML,
  proving the deployed route is present, configured and fail-closed.

The first live outbound attempt exposed a UI/server integration defect: choosing
an outgoing first message while opening a Conversation persisted it locally but
did not call the channel provider. Initial outbound Email and SMS messages now
use the same provider-backed, failure-visible delivery path as later replies;
simulated incoming messages and channels without connected providers retain
their existing local behavior. A second live attempt confirmed the form still
defaulted to simulated incoming, so the production-safe default is now
`Send outgoing message`; incoming simulation requires an explicit selection.
The existing Conversation reply form was also updated from its prior
Email-only gate so SMS replies use Twilio and unsupported channels remain
disabled.

Production completion remains pending until a real carrier-delivered incoming
SMS and an outgoing Inbox reply are proven with persisted Message evidence. Do
not begin another channel before that validation.

---

# STAGE 19 — Operational Dashboard

## Objective

Create a useful daily business overview using functionality that now genuinely exists.

Potential dashboard information:

- today's bookings
- upcoming bookings
- conversations requiring attention
- deposits awaiting payment
- reminder failures

Do not build advanced analytics.

## Completion Criteria

- dashboard uses tenant-scoped data
- information is operationally useful
- mobile layout works
- no cross-tenant aggregation occurs

STOP after completion.

---

# STAGE 20 — Production Readiness

## Objective

Prepare the proven application for controlled production use.

Review:

- authentication
- authorization
- tenant isolation
- database indexes
- migrations
- secret management
- monitoring
- structured logging
- backup strategy
- webhook security
- rate limiting
- dependency security
- error handling
- background processing
- retry behaviour
- accessibility
- mobile responsiveness

Run production build and tests.

Resolve critical security issues before deployment.

STOP before deploying production unless deployment is explicitly requested.

---

# STAGE 21 — Azure Deployment

## Objective

Deploy the production-ready application to Microsoft Azure.

Exact Azure resources must be selected based on the requirements established by the completed application.

Do not create unnecessary infrastructure.

Deployment planning should cover:

- application hosting
- Azure Cosmos DB for NoSQL configuration and hosting
- secrets
- monitoring
- logging
- networking where required
- scheduled/background work
- backups
- custom domain
- TLS/HTTPS

Infrastructure decisions must be documented.

Use separate configuration/secrets for development and production.

## Completion Criteria

- application deployed
- database migrations applied safely
- production secrets configured securely
- HTTPS works
- monitoring works
- background processing works
- health checks pass

STOP after deployment verification.

---

# 3. Development Checkpoint Format

At the end of every stage, report:

## Stage Completed

Stage number and name.

## Files Created

List new files.

## Files Modified

List modified files.

## Packages Added

List packages and explain why they were required.

## Database Changes

List schema/migration changes.

## Tests and Checks

Report results for relevant commands such as:

- lint
- TypeScript
- tests
- build

## Security Check

Confirm whether the stage affects:

- authentication
- authorization
- tenant isolation
- secrets
- payments
- external input

## Known Issues

List any unresolved issues honestly.

## Next Stage

Identify the next planned stage.

DO NOT begin it.

---

# 4. Definition of a Successful Stage

A stage is complete only when:

- requested functionality works,
- relevant validation exists,
- TypeScript does not contain introduced errors,
- lint succeeds,
- relevant tests pass,
- production build succeeds where appropriate,
- tenant isolation remains intact,
- secrets have not been committed,
- documentation remains accurate.

A partially working feature is not complete merely because the UI renders.

---

# 5. Current Build Position

Completed stage:

STAGE 16 — Booking Confirmation Messaging

Status:

COMPLETE.

Current work:

STAGE 17 — Real Reminder Delivery is implemented. A server-side `CRON_SECRET`,
Vercel redeployment and controlled real Postmark reminder are still required
before Stage 17 is marked complete.

---

# 6. Core Build Rule

Do not build ahead.

The purpose of this plan is not to predict every detail of the finished application.

The purpose is to create:

one working layer
↓
prove it
↓
protect it
↓
add the next layer.

At every point, the application should remain understandable and recoverable.

Correctness and security take priority over development speed.