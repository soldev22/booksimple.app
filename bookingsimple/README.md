# Universal Communications & Booking Platform

A multi-tenant SaaS platform for small B2C businesses that brings customer communications, bookings, deposits, confirmations, and reminders into one application.

## Product Goal

Small businesses often manage customer communications across several disconnected channels.

The platform aims to provide one unified workspace for:

- WhatsApp
- Facebook / Meta messaging
- SMS
- Email
- Customer conversations
- Bookings
- Deposits
- Booking confirmations
- Reminders

The application may initially be tested with beauty and appointment-based businesses, but the core platform must remain industry-neutral.

---

## Core Workflow

The primary product journey is:

Customer Contact
↓
Unified Conversation
↓
Booking
↓
Deposit if required
↓
Booking Confirmation
↓
Reminder
↓
Completed Booking

Not every conversation must produce a booking.

Not every booking requires a deposit.

---

## Architecture

The initial application uses a modular monolith architecture.

Planned core stack:

- Next.js
- React
- TypeScript
- Azure Cosmos DB for NoSQL
- Azure Cosmos DB JavaScript SDK (planned server-side database access)
- Zod
- Microsoft Azure

External messaging and payment providers are isolated behind provider adapters.

The core application must not depend directly on provider-specific implementations.

Cosmos DB container layouts, partition keys, and development connectivity
remain to be agreed before Stage 2 implementation. The existing Vercel
deployment is a foundation preview, not a production-ready business system.

---

## Multi-Tenancy

The application supports multiple independent businesses.

Every tenant-owned entity must be isolated by business/tenant.

Tenant isolation is a security boundary.

A user belonging to one business must never be able to access another business's:

- customers
- conversations
- messages
- bookings
- services
- payments
- reminders
- settings

Authorization must be enforced server-side.

---

## Product Documentation

Before making significant changes, read:

### Product Definition

`docs/PRODUCT.md`

Defines what the product is and what functionality belongs within its scope.

### Architecture

`docs/ARCHITECTURE.md`

Defines the technical architecture, technology choices, tenancy model, integrations, database approach, and security boundaries.

### Development Guardrails

`docs/GUARDRAILS.md`

Defines rules that must not be violated during development.

### Build Plan

`docs/BUILD-PLAN.md`

Defines the controlled stage-by-stage implementation sequence.

### Copilot Instructions

`.github/copilot-instructions.md`

Provides repository-wide instructions for GitHub Copilot.

---

## Development Rule

Development happens one build stage at a time.

For each stage:

1. Read the project documentation.
2. Inspect the existing implementation.
3. Implement only the requested stage.
4. Validate the implementation.
5. Run relevant tests and checks.
6. Report what changed.
7. STOP.

Do not automatically begin the next stage.

---

## Current Build Stage

Completed stage:

STAGE 1 — Application Foundation

Status:

COMPLETE.

Next stage:

STAGE 2 — Database Foundation

Do not implement Stage 2 until explicitly instructed.

---

## Planned Build Sequence

1. Application Foundation
2. Database Foundation
3. Authentication
4. Tenant Context and Authorization
5. Business Setup
6. Customer Management
7. Services
8. Conversation Domain
9. Booking Foundation
10. Deposit Engine
11. Payment Domain
12. Reminder Domain
13. Messaging Provider Interface
14. First Real Communication Channel
15. Real Payment Provider
16. Booking Confirmation Messaging
17. Real Reminder Delivery
18. Additional Communication Channels
19. Operational Dashboard
20. Production Readiness
21. Azure Deployment

Each stage must be completed and verified before moving to the next.

---

## Security Principles

Never commit:

- API keys
- passwords
- access tokens
- private keys
- connection strings
- webhook secrets

Never rely on client-side checks for authorization.

Never trust:

- browser input
- route parameters
- webhook payloads
- third-party data

without server-side validation.

Never store customer payment card details.

---

## Development Status

The project is currently under initial development.

The immediate objective is not to build the entire platform.

The first objective is to establish a secure, maintainable foundation and then prove the core workflow incrementally:

Communication
+
Customer
+
Booking
+
Deposit
+
Confirmation
+
Reminder

Only once this workflow is proven should the platform expand further.