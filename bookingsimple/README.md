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

Registration and the implemented Customer, Service, Conversation, Booking,
deposit-policy and Payment domains
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
   Set the exact `APP_ORIGIN`: use `http://localhost:3000` locally and
   `https://www.booksimple.app` in production. Production requests and email
   links must use the same origin.
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
   tenant-partitioned `channel-identities`, `bookings`, `payments` and
   `reminders`
   containers has been
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

The migration uses `.env.local`, adds `Europe/London`, `GBP` and a 0% default
deposit only when those
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

Preview the schema-version-1 Booking deposit migration:

```powershell
npm run migrate:booking-deposits
```

After checking the count, apply it explicitly:

```powershell
npm run migrate:booking-deposits -- --apply
```

Legacy Bookings receive explicit 0% terms rather than an invented historic
deposit obligation.

### Stripe Connect test setup

Stripe is opt-in and the application continues to use `MOCK_TEST` by default.
To use Stripe in a development environment, put these values in `.env.local`
or deployment secret management, never in source control:

```dotenv
PAYMENT_PROVIDER=STRIPE
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...
APP_ORIGIN=http://localhost:3000
```

Configure these exact Stripe Connect OAuth redirect URIs:

- local: `http://localhost:3000/api/stripe/connect/oauth/callback`
- production:
  `https://www.booksimple.app/api/stripe/connect/oauth/callback`

Create a Connect webhook endpoint for
`https://www.booksimple.app/api/stripe/webhook`, configured to receive events
from connected accounts. Subscribe to `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, and
`checkout.session.async_payment_failed`. A Stripe CLI listener uses its own
displayed `whsec_...` secret rather than the Dashboard endpoint secret.

Restart the application after changing the environment. A company
administrator can then open Account, choose Business profile, and start
Stripe Connect OAuth lets a Business sign in and connect an existing Stripe
account. BookSimple stores only the connected account ID, not OAuth access or
refresh tokens. Test and live connected-account references are deliberately
separate. Do not change to an `sk_live_...` key or enable production payments
without explicit production approval and HTTPS `APP_ORIGIN`.

### Booking reminders

Company administrators configure up to five default Booking reminder rules in
Business profile settings. Each rule selects EMAIL, SMS, WHATSAPP or META and
an offset from 1 minute through 7 days. New Bookings snapshot the current
rules; changing the defaults does not rewrite existing Bookings.

Stage 17 sends Email reminders through the configured messaging provider.
Due Reminder records are claimed and processed entirely server-side with:

```powershell
npm run process:reminders
```

This command remains available for controlled operations. The deployed Vercel
application also invokes `/api/internal/reminders/process` every minute through
Vercel Cron. Set `CRON_SECRET` as a server-side Vercel secret; the Route Handler
fails closed when the secret is absent or its bearer token is invalid.
Processing uses ETags and expiring leases, skips duplicate sends, reschedules
unsent reminders when Booking time changes, and cancels unsent reminders for
completed, cancelled or no-show Bookings. Email delivery is linked to the
Customer Conversation and Message. SMS, WhatsApp and Meta rules remain
retryable failures until those provider adapters are connected.

### Email, SMS, WhatsApp and Facebook messaging

Stage 13 defines the provider-neutral server boundary for outbound sends,
webhook authenticity checks and inbound-message normalization. Provider
payloads remain inside adapters; Conversation and Message records use the
normalized channel, address, body, timestamps and optional provider
correlation identifiers.

Stage 14 adds Postmark as the first real provider for Email only. Set
`MESSAGING_PROVIDER=POSTMARK` with the server token, verified platform sender,
inbound address and inbound-webhook Basic Auth credentials documented in
`.env.example`. Outbound Inbox requests are idempotent, retain Postmark message
IDs and show pending, sent or failed state. Their `ReplyTo` uses an opaque
per-Conversation Postmark `MailboxHash` route.

Configure the Postmark inbound stream to POST to:

```text
https://www.booksimple.app/api/webhooks/postmark/inbound
```

Protect that URL with the same generated Basic Auth username and password held
in the server environment. Inbound payloads are authenticated, normalized and
matched to the opaque route plus the exact tenant-local Email identity.
Postmark retries reuse a deterministic Message ID and do not duplicate Inbox
messages. Raw payloads, message content and credentials are not written to
logs.

Stage 18 adds Twilio as the first real SMS provider without replacing Postmark.
Set `TWILIO_SMS_ROUTES` to the bounded server-side JSON route list documented
in `.env.example`. Each tenant may have one route, and each Account SID plus
Twilio destination number may map to only one tenant. Configure the Twilio
number's incoming-message webhook to POST to:

```text
https://www.booksimple.app/api/webhooks/twilio/sms
```

Twilio requests are authenticated with `X-Twilio-Signature` against the
canonical `APP_ORIGIN` URL and the route's Auth Token. Only after authentication
does the adapter resolve `AccountSid` plus `To` to a tenant; the sender phone
identity is then point-read inside that tenant partition. Twilio Message SIDs
make webhook retries idempotent. Outbound SMS uses the tenant's configured
number and retains the Twilio Message SID.

Twilio WhatsApp reuses each tenant's credentials from `TWILIO_SMS_ROUTES`.
Set `TWILIO_WHATSAPP_SENDERS` to a bounded JSON list containing one
tenant-to-sender mapping, then configure that WhatsApp sender's incoming
message webhook to POST to:

```text
https://www.booksimple.app/api/webhooks/twilio/whatsapp
```

WhatsApp addresses must use E.164 format. The adapter adds Twilio's
`whatsapp:` prefix only at the provider boundary. Signed inbound requests are
tenant-routed by `AccountSid` plus the configured WhatsApp `To` sender before
the customer identity is resolved within that tenant. Free-form Inbox replies
are limited to WhatsApp's active 24-hour customer-service window. Templates,
marketing messages, media and WhatsApp reminders are outside this increment.
Twilio Sandbox testing also requires each test device to join the Sandbox and
is not a production sender.

Facebook Messenger uses a direct Meta Graph API adapter. Set
`META_MESSENGER_ROUTES` to the bounded tenant-to-Page route list documented in
`.env.example`. Each route contains one tenant ID, Page ID, server-side Page
access token, App Secret, webhook verify token and pinned Graph API version.
Duplicate tenants or Page IDs fail closed.

For administrator-managed Page onboarding, configure `META_APP_ID`,
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` and a
base64-encoded 32-byte `META_TOKEN_ENCRYPTION_KEY`. Register
`<APP_ORIGIN>/api/meta/connect/oauth/callback` as a valid Meta OAuth redirect
URI. Company administrators can then connect a managed Page from Business
settings. Page tokens are encrypted at rest and are never returned to the
browser. `META_MESSENGER_ROUTES` remains a bounded migration fallback.

In the Meta App dashboard, add Messenger, connect the intended Facebook Page,
and configure this callback URL:

```text
https://www.booksimple.app/api/webhooks/meta/messenger
```

Use the route's webhook verify token and subscribe the Page to `messages`. Meta
verifies the endpoint with a GET challenge. POST requests are accepted only
after the exact raw UTF-8 body passes `X-Hub-Signature-256` HMAC-SHA256
verification with the App Secret. The authenticated Page ID then selects one
tenant before the Page-scoped sender ID is resolved in that tenant partition.
Page access tokens and App Secrets must remain server-side and must never be
logged or committed.

Outgoing replies call the pinned Graph API
`/{PAGE_ID}/messages` endpoint with `messaging_type=RESPONSE`. A person must
message the Page first, and ordinary free-form replies are limited to Meta's
standard messaging window, normally 24 hours. Standard Access reaches only
app-role/test users; messages for ordinary customers require the appropriate
Advanced Access and App Review approval. This increment handles text messages
only. Attachments, reactions, postbacks, echoes, templates, tags, marketing,
Instagram and Facebook reminders remain outside scope.

`MOCK_TEST` remains available for local-only development.

### Booking confirmations

Stage 16 sends one controlled confirmation when a Booking first reaches
`CONFIRMED`. The system reuses a supported originating Conversation, or falls
back to the Customer's Email Conversation. Local `MOCK_TEST` confirmations are
recorded as `LOCAL_ONLY`; configured Postmark Email confirmations use the real
outbound provider and retain sent or failed state in the Conversation.

Run `npm run provision:data` after deploying Stage 16 to create or verify the
tenant-partitioned `booking-confirmations` container. Missing supported contact
details or provider failure does not roll back the Booking status; an explicit
failed confirmation record prevents uncontrolled duplicate sends.

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

STAGE 16 — Booking Confirmation Messaging

Status:

COMPLETE.

Current work:

STAGE 17 — Real Reminder Delivery is implemented. Deployment still requires a
server-side `CRON_SECRET`, a Vercel redeployment and one controlled Postmark
reminder validation before the stage is marked complete. Production Stripe
payments remain outside the approved scope.

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
Stages 1 through 14 are implemented. Stage 15 was implemented early, but
Stripe sandbox validation remains pending.

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