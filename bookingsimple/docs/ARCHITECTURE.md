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

The target cloud platform is Microsoft Azure.

The architecture should be compatible with Azure services without forcing application business logic to depend directly on Azure-specific APIs.

Likely infrastructure may eventually include:

- Azure-hosted web application
- managed PostgreSQL database
- secret management
- monitoring
- background processing
- object/file storage

Exact services will be selected when deployment begins.

Local development must remain straightforward.

---

# 4. Database

Use PostgreSQL as the primary relational database.

PostgreSQL is appropriate because the product contains strongly related business entities including:

- tenants
- users
- customers
- conversations
- messages
- services
- bookings
- payments
- reminders

Use an ORM suitable for TypeScript.

Preferred initial ORM:

Prisma

The database schema must be version controlled using migrations.

Do not manually modify production database structures.

---

# 5. Multi-Tenant Architecture

Use a shared application and shared database with logical tenant isolation.

Every tenant-owned record must include a tenantId.

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

prisma/
  schema.prisma
  migrations/

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

# 36. Database Migrations

All schema changes must use migrations.

During active development:

1. modify the Prisma schema,
2. generate a migration,
3. inspect the migration,
4. apply it,
5. update affected tests/documentation.

Never casually reset a database containing important data.

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
   +---- PostgreSQL
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
PostgreSQL

ORM:
Prisma

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