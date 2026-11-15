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

Microsoft Azure remains the planned platform for Cosmos DB and potential future
hosting. The final hosting and networking arrangements have not been selected.

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

No database account, container, authentication method, or credentials have
been configured as part of this documentation decision.

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

The server must derive the current tenant from the authenticated user's tenant membership.

Do not accept an arbitrary tenantId from the browser and trust it.

Every tenant-owned database operation must be constrained by the authenticated tenant context.

Tenant isolation is a security boundary.

## Partitioning and Tenant Safety

Partition keys are a routing and scaling mechanism, not authorization. The
server must verify membership and tenant ownership for reads, writes, point
reads, and cross-partition queries. Use parameterized queries; never trust a
tenant identifier or partition key supplied by the browser as authorization.

The final container layout and partition keys are **not yet selected**. The
tenant identifier is a candidate for tenant-owned data, but its suitability
depends on tenant count, peak traffic, data growth, retention, and query
patterns. A user can belong to multiple businesses, so global user identity
and membership lookup require deliberate designs rather than assuming every
document belongs to one tenant.

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

The available workload evidence is insufficient to select final keys or certify
capacity. Resolve these design questions before provisioning containers.

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

Authentication should use a proven authentication solution rather than custom username/password authentication.

Business users must be able to sign in with a username and password and
enrol an authenticator app for time-based one-time passcodes (TOTP). Each
business can choose whether its users must use MFA; password-only access has
greater risk. The identity provider and username format have not been selected.

The identity provider must verify credentials and MFA, provide secure
enrolment and recovery, and allow the server to verify the authentication
strength needed to enforce a business's MFA policy. Never store passwords or
authenticator secrets in application documents or treat a client-provided MFA
claim as proof. Business-specific enforcement depends on authorized membership
and belongs with tenant-context authorization.

The application must distinguish:

Authentication:
"Who is this user?"

from:

Authorization:
"What is this user allowed to do?"

A user must be associated with one or more businesses through an explicit membership model.

Conceptual structure:

User
  id
  identityProviderId
  email
  name

BusinessMembership
  id
  userId
  businessId
  role

This allows the architecture to support a user belonging to more than one business in the future.

Do not embed permanent business ownership directly inside the User record.

---

# 8. Authorization

All protected operations must be authorized server-side.

Initial conceptual roles:

- OWNER
- ADMIN
- STAFF

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