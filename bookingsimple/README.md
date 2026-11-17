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
- Azure Cosmos DB JavaScript SDK (server-side database access)
- Zod
- Microsoft Azure

External messaging and payment providers are isolated behind provider adapters.

The core application must not depend directly on provider-specific implementations.

Registration and the implemented Customer, Service, Conversation and Booking domains
use the reviewed containers described in
[ARCHITECTURE.md](docs/ARCHITECTURE.md); future business-domain containers still
require separate design approval. The initial connectivity plan uses the public Cosmos DB endpoint with
Microsoft Entra authentication for deployment and an explicitly approved
account key for local development; public access and account-key authentication
are enabled account-wide. Development uses synthetic data only, and restricted
networking will be revisited as the business and security needs warrant. The
existing Vercel deployment is a foundation preview, not a production-ready
business system.

### Cosmos DB connection

Use Node.js 22 or later. For local development, copy `.env.example` to
`.env.local`, set `COSMOS_DB_ENDPOINT` to the account endpoint, set
`COSMOS_AUTH_MODE=key`, and supply the account's primary or secondary
read-write key as `COSMOS_DB_KEY`. Keep the key private and never commit or
share it. The key mode is restricted to local development; it is rejected
on Vercel and when `NODE_ENV=production`.

Alternatively, `COSMOS_AUTH_MODE=azure-cli` uses an authorised signed-in
Azure CLI identity locally. Azure management tasks such as provisioning
containers still require an authorised management-plane identity.

On Vercel, set `COSMOS_AUTH_MODE=vercel-oidc`, `COSMOS_DB_ENDPOINT`,
`AZURE_TENANT_ID` and `AZURE_CLIENT_ID`. The Entra application, Vercel OIDC
federation and Cosmos data-plane role must be configured separately; they have
not yet been verified. The deployed application continues to use Entra rather
than account keys.

An account key grants broad account-wide data access and cannot enforce the
application's tenant boundaries; a leaked key must be rotated. Enabling keys
applies to the entire shared account even though the application uses them
only locally. Consider dedicated development resources, secret management,
rotation and disabling keys again before using real data.

The Azure Identity SDK remains a native server dependency via
`serverExternalPackages`, preventing its platform-specific credential helpers
from being bundled as application modules.

The request-time client does not create databases or containers. The explicit
provisioning script creates and reads back the reviewed containers.
Use synthetic data only until deployment identity, security and environment
separation are verified.

### Registration and administration setup

The application now includes registration, email verification/resend, sign-in,
password reset and platform-admin
business approval and role assignment. Customers do not need application
accounts. Verifying an email allows access to the account page, not a business
workspace; a business membership must be assigned separately. Business
approval creates only a `company_user` membership. A platform administrator
must perform a separate, audited role assignment to elevate that account to
`company_admin`; no new membership receives company-administrator access by
default. MFA is
temporarily unavailable for all users, including platform administrators.
Password-only platform access carries a substantially higher security risk
and must be reassessed before using real data or deploying to production.

1. Configure `.env.local` from `.env.example` using one of the local Cosmos
   authentication options above.
   Set the exact `APP_ORIGIN` (for example `http://localhost:3000` locally,
   HTTPS in production). Production requests and email links must use the same
   origin.
2. Generate a 32-byte base64 value for `AUTH_NOTIFICATION_ENCRYPTION_KEY`
   using the command in `.env.example`. Keep it server-side and securely
   backed up; losing or replacing it makes existing encrypted outbox data
   unreadable. Preserve any existing `AUTH_MFA_ENCRYPTION_KEY` securely while
   retained MFA records exist.
3. Set `POSTMARK_SERVER_TOKEN`, the verified `POSTMARK_FROM_EMAIL`, and the
   appropriate message stream in the server environment. Never put credentials
   in client-side variables, Git or chat. Email-provider failures are reported
   explicitly; a created account can request a new verification email at
   `/verify`. Pending/failed email outbox entries can also be retried by the
   operator script.
   For rejected Postmark requests, server logs include `providerStatus` and,
   when available, the numeric `providerCode` from Postmark's response.
   Use that code with Postmark's API error reference to diagnose sender
   verification, account restrictions or message stream errors. Raw provider
   messages and email contents are not logged. Restart the development server
   after changing environment settings, then request a resend at `/verify`.
4. The `booksimple` database with `auth-control`, `auth-sessions`,
   `auth-throttles`, `customers`, `services`, hierarchical `conversations`,
   tenant-partitioned `channel-identities` and `bookings` containers has been
   provisioned in the approved Azure account.
   To provision or verify another approved target, set
   `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP` in `.env.local` or the
   process environment and run:

   ```powershell
   npm run provision:data
   ```

   This requires an authorized Azure management-plane identity. Normal
   application access uses Cosmos data-plane permissions; no runtime
   provisioning is performed.
5. Run `npm run dev`, register an account and verify the email.
6. An authorized operator can grant the **first** platform administrator only
   after that account has verified its email. Supply a random
   operator-managed `PLATFORM_BOOTSTRAP_SETUP_TOKEN` of at least 32 bytes in the
   operator environment, then intentionally run:

   ```powershell
   node --env-file=.env.local --conditions=react-server --import tsx scripts\bootstrap-admin.ts --email user@example.com --confirm
   ```

   No email address is hardcoded or automatically privileged. The durable
   one-time lock allows retry for the same account, not a different account.
   Remove the setup token from the environment after completion. Sign in
   again before opening `/admin`. Subsequent grants require an existing
   authenticated platform administrator.

Platform administrators can open `/admin/users` from the platform
administration page to view every registered account grouped by company. The
responsive tables show company and platform roles separately, include
unassigned and platform-only accounts, and do not display internal company
usernames. Both the page and its paginated data API independently enforce the
platform role.

Authenticated pages use a prominent shared header that displays the registered
name, every assigned company/platform role and the active company on one line.
The header includes a server-backed logout control, and protected account pages
share a consistent footer. The account page does not repeat approved
application, identity, role or company details already shown in the header;
pending and rejected applications remain visible.

For queued email retries:

```powershell
node --env-file=.env.local --conditions=react-server --import tsx scripts\retry-auth-notifications.ts
```

These standalone scripts do not automatically load `.env.local`; the commands
above do so explicitly, while the provisioning aliases load it when present.
Production can instead inject environment variables.
No real email delivery, deployed Vercel federation or initial administrator
bootstrap has been verified or performed as part of implementation.

### Validation

Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`.
The opt-in auth lifecycle tests use real Cosmos storage and a **stubbed**
Postmark transport: they do not prove real email delivery. With an approved
synthetic-data target and the environment configured above, set
`AUTH_COSMOS_INTEGRATION_TESTS=1` in the process environment and run:

```powershell
node --env-file=.env.local --conditions=react-server --import tsx --test tests\auth-registration.integration.test.mjs tests\auth-session.integration.test.mjs tests\auth-mfa.integration.test.mjs
node --env-file=.env.local --conditions=react-server --import tsx scripts\check-auth-cosmos.ts
```

The lifecycle tests create UUID-scoped synthetic accounts and remove their
account, business, session and exact throttle records during cleanup.
The security check covers password-only platform role access, denial of
platform operations to company administrators, one-time bootstrap locking,
membership races and session invalidation with synthetic data.
The retained internal MFA tests exercise dormant implementation details, not
available user flows; MFA HTTP endpoints are disabled.
Neither command creates a real administrator or sends email.

The live Customer authorization test uses synthetic Customers and the existing
application on port 3000:

```powershell
$env:AUTH_PAGE_TEST_BASE_URL='http://localhost:3000'
node --env-file=.env.local --conditions=react-server --import tsx --test tests\customer-page-access.integration.test.mjs
```

The equivalent synthetic Service isolation and minor-unit pricing workflow is:

```powershell
$env:AUTH_PAGE_TEST_BASE_URL='http://localhost:3000'
node --env-file=.env.local --conditions=react-server --import tsx --test tests\service-page-access.integration.test.mjs
```

---

## Business Setup

Approved businesses have a tenant-scoped settings page at `/settings`.
Company administrators can update the business name, IANA timezone and
three-letter operating currency. Company users can view the same settings but
cannot update them. The APIs derive the business from the authenticated
membership and do not accept a tenant ID from the browser.

Company administrators can invite staff-level company users by email. The
invitation is valid for seven days and can only be accepted by an authenticated,
verified account with the invited email address. Acceptance grants only the
persisted `company_user` role, invalidates the old session and requires the user
to sign in again. Company-administrator and platform roles cannot be granted
through invitations.

Company administrators can delete a pending invitation created for the wrong
email address. Deletion immediately invalidates the acceptance link and removes
any correlated pending or failed notification that could otherwise be retried.
It cannot recall an email that Postmark has already delivered. Accepted
invitations cannot be deleted because membership removal is a separate
authorization operation.

Existing Business documents must have explicit timezone and currency settings.
The Stage 5 migration is idempotent and can be rerun:

```powershell
npm run migrate:business-settings
```

The migration uses `.env.local`, adds `Europe/London` and `GBP` only when those
fields are missing, and does not overwrite configured values.

### Data dictionary and retention

[`docs/DATA-DICTIONARY.md`](docs/DATA-DICTIONARY.md) explains every persisted
record, its owner, personal-data classification and retention in plain
language.

Preview the reviewed retention migration without changing data:

```powershell
npm run migrate:data-retention
```

After checking the counts, apply it explicitly:

```powershell
npm run migrate:data-retention -- --apply
```

The migration never prints record contents, email addresses, secrets or
credentials.

### Customer management

Active company users can open `/customers` to create, search, view, edit and
archive Customers belonging to their server-resolved business. Email and phone
are optional. Possible duplicates produce a warning but remain separate.
Archived Customers are retained, while permanent personal-data erasure is
available only to company administrators.

Customer data is stored in the dedicated `customers` container partitioned by
`/tenantId`; it is never stored in the authentication container. Detail reads
use the Customer GUID and authenticated tenant GUID together. The API never
accepts a browser tenant ID as authorization.

### Service management

Active company users can open `/services` to create, search, view, edit,
activate and deactivate generic bookable Services belonging to their
server-resolved business. Price input is converted server-side to integer minor
units, currency defaults from Business settings, and zero-priced Services are
supported.

Service data is stored in the dedicated `services` container partitioned by
`/tenantId`; it is never stored in the authentication container. Service detail
reads and writes require both the Service GUID and authenticated tenant GUID.
Deactivation preserves stable identity for future Booking references.

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

The authenticated viewer includes a current tenant context only when the
server-stored membership points to an active business. The context contains
the business GUID, business name, internal company username and company role.
It is resolved server-side from the session and membership; browser-supplied
tenant identifiers are never accepted as authorization.

Reusable guards require an active tenant, enforce company-administrator
operations and reject identifiers for any other business. The persisted
`company_user` role is the current staff-level role. Platform administration
remains a separate audited role and does not implicitly grant a business
membership.

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

Current work:

STAGE 3 — Registration and platform administration, with the necessary
database and server-side authorization foundation implemented.

Company-managed invitations, business workspace features and later booking
stages are not implemented by this step. Live service configuration and
deployment verification remain prerequisites before use with real data.

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