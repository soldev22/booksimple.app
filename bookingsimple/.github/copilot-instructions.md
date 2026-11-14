# Copilot Instructions — Universal Communications & Booking Platform

## Project Purpose

This project is a multi-tenant B2C communications and booking platform for small businesses.

The platform gives each business one place to manage customer conversations, bookings, deposits, and reminders across multiple communication channels.

Initial communication channels will include:

- WhatsApp
- Facebook / Meta messaging
- SMS
- Email

The architecture must support two-way communication so businesses can both receive and send customer messages.

The platform may initially be tested with beauty businesses, but it MUST remain industry-neutral.

Do not introduce beauty-specific terminology, data models, workflows, or business rules into the core application.

---

## Core Product Principles

### 1. Multi-Tenant From Day One

The application must support multiple independent businesses.

Every tenant-owned record must have an explicit tenant/business identifier.

Examples include:

- customers
- conversations
- messages
- bookings
- deposits
- reminders
- users
- settings

Never assume there is only one business using the application.

Never allow one tenant to access another tenant's data.

---

## 2. Unified Communications

Customer conversations must eventually be capable of originating from:

- WhatsApp
- Facebook / Meta
- SMS
- Email

Channel-specific implementation details must not control the core conversation model.

Use a normalized internal conversation/message model.

Individual providers should be implemented through adapters or integration services.

Do not scatter provider-specific API calls throughout the application.

---

## 3. Two-Way Messaging

The architecture must support:

customer -> business

and

business -> customer

Messages must retain their source channel.

Where appropriate, retain external provider identifiers so incoming messages, outgoing messages, delivery events, and replies can be correlated correctly.

---

## 4. Generic Booking System

Bookings must remain industry-neutral.

Do NOT hard-code assumptions such as:

- salon treatment
- haircut
- beauty appointment
- therapist
- stylist
- chair

Prefer generic concepts such as:

- booking
- service
- customer
- staff member
- resource
- location
- duration

---

## 5. Deposits

Businesses must be able to configure deposits.

Deposit percentage must support:

0% through 100%.

Deposit logic must NOT be inherently tied to a particular product, treatment, or industry.

Deposit policies should be configurable at business level and designed so additional policy scopes can be introduced later.

Never assume every booking requires a deposit.

Never assume deposits are a fixed amount.

---

## 6. Reminders

The system must support configurable booking reminders.

Reminder infrastructure must eventually be capable of using available communication channels.

Do not hard-code a single reminder timing or communication channel into the core booking model.

---

## 7. External Integrations

External services must be isolated behind clear integration boundaries.

Examples include:

- WhatsApp / Meta
- Facebook / Meta
- SMS providers
- Email providers
- payment providers

Use adapter/service patterns so providers can be changed without rewriting core business logic.

Provider-specific webhook payloads must be translated into internal application models before they enter business logic.

---

## 8. Security

Never place:

- API secrets
- passwords
- access tokens
- connection strings
- private keys

directly in source code.

Use environment variables or an appropriate secret-management service.

Never commit real secrets to Git.

Authentication and authorization must be enforced server-side.

Tenant isolation must never depend solely on filtering performed by the browser.

Incoming webhooks must eventually be authenticated or signature-verified according to the provider's requirements.

Payment details must never be stored directly by this application when a payment provider can securely handle them.

---

## 9. Architecture Rules

Keep clear separation between:

- UI
- business logic
- persistence
- integrations
- authentication/authorization

Prefer simple, readable implementations over unnecessary abstraction.

Do not introduce microservices unless a genuine scaling, security, deployment, or integration boundary requires them.

Design for expansion without prematurely building every future feature.

---

## 10. TypeScript

Use TypeScript.

Avoid `any` unless there is a documented technical reason.

Create explicit types/interfaces for important domain objects.

Validate external input at runtime rather than trusting TypeScript types alone.

---

## 11. Database

Do not create database models ad hoc.

The data model must be agreed and documented before significant persistence code is generated.

Every tenant-owned entity must be associated with the owning tenant/business.

Relationships and indexes should be designed deliberately.

---

## 12. API Design

Validate all API input.

Return appropriate HTTP status codes.

Do not expose internal implementation details, database errors, credentials, stack traces, or secrets to the client.

Authorization must be checked server-side for protected operations.

---

## 13. Error Handling

Do not silently swallow errors.

Errors should:

1. be logged appropriately,
2. provide useful debugging information without exposing secrets,
3. return safe user-facing messages where appropriate.

External integration failures should be handled explicitly.

---

## 14. Development Behaviour

Before making significant changes:

1. Read this file.
2. Read `/docs/PRODUCT.md`.
3. Read `/docs/ARCHITECTURE.md`.
4. Read `/docs/GUARDRAILS.md`.
5. Read `/docs/BUILD-PLAN.md`.
6. Inspect the existing implementation.
7. Determine which build stage is currently active.

Do not make unrelated changes.

Do not rewrite working code simply because another implementation is preferred.

Do not introduce major dependencies without explaining why they are required.

Do not implement future build stages unless explicitly instructed.

---

## 15. Build Incrementally

Work in small, testable stages.

For each stage:

1. explain what is being changed,
2. identify files that will be created or modified,
3. implement only the requested stage,
4. run the relevant checks,
5. report the result,
6. stop.

Do not automatically continue into the next stage.

---

## 16. Avoid Scope Creep

Do not add features just because they might be useful.

Examples of features that must NOT be introduced without an explicit requirement include:

- accounting
- payroll
- inventory management
- marketing automation
- AI assistants
- loyalty programmes
- CRM functionality beyond what the defined product requires
- analytics platforms
- mobile applications

New ideas should first be documented and evaluated before implementation.

---

## 17. Preserve Product Neutrality

When naming:

- database tables
- types
- functions
- APIs
- UI components
- variables

prefer industry-neutral terminology.

For example:

GOOD:
`Booking`
`Service`
`Customer`
`Business`
`StaffMember`

BAD:
`BeautyAppointment`
`SalonTreatment`
`Hairdresser`
`NailBooking`

The product is intended to support many types of small B2C businesses.

---

## 18. When Requirements Are Unclear

Do not invent significant product behaviour.

If a decision could materially affect:

- architecture
- security
- tenant isolation
- data structure
- payments
- external integrations
- business rules

stop and explain the decision that needs to be made before implementing it.

---

## Definition of Done

A build stage is complete only when:

- the requested functionality has been implemented,
- the project builds successfully,
- relevant tests/checks pass,
- no known TypeScript errors were introduced,
- tenant isolation has not been compromised,
- secrets have not been committed,
- documentation affected by the change has been updated,
- only the requested scope has been implemented.

After completing a stage, report what changed and STOP for the next instruction.