# Universal Communications & Booking Platform
## Development Guardrails

## 1. Purpose

These guardrails define constraints that must be followed when designing, generating, modifying, reviewing, or deploying this application.

They exist to protect:

- tenant isolation
- customer data
- security
- financial correctness
- architectural consistency
- maintainability
- product scope
- working functionality

These rules apply to both human-written and AI-generated changes.

If a requested implementation conflicts with these guardrails, STOP and explain the conflict before making the change.

---

# 2. Do Not Change the Product Without Approval

The authoritative product definition is:

`/docs/PRODUCT.md`

Do not introduce significant new product behaviour that is not defined there.

In particular, do not automatically add:

- CRM functionality
- marketing automation
- loyalty programmes
- accounting
- payroll
- inventory management
- employee HR management
- AI assistants
- social media publishing
- native mobile applications
- industry-specific workflows

Ideas may be documented for later consideration.

They must not silently become implementation scope.

---

# 3. Build Only the Current Stage

The build is controlled by:

`/docs/BUILD-PLAN.md`

Only implement the active stage.

Do not automatically continue to the next stage.

Do not pre-build future functionality because it appears easy or useful.

At the end of each stage:

1. run appropriate checks,
2. report what changed,
3. report any issues,
4. STOP.

Wait for the next instruction.

---

# 4. Protect Working Code

Do not rewrite working functionality simply because another implementation appears cleaner or more modern.

Before modifying existing code:

1. inspect the current implementation,
2. understand its purpose,
3. identify dependencies,
4. make the smallest appropriate change.

Avoid large-scale refactoring while implementing unrelated features.

Never delete working functionality unless explicitly instructed or the deletion is necessary and explained beforehand.

---

# 5. Tenant Isolation Is Mandatory

This is a multi-tenant application.

Tenant isolation is a security boundary.

Every tenant-owned record must contain or inherit a reliable tenant/business association.

Examples include:

- customers
- conversations
- messages
- bookings
- services
- payments
- reminders
- settings
- integration configurations

Never query tenant-owned data without tenant scoping, except for an explicitly
authorised and audited platform-administrator operation. A business role or
client-supplied tenant identifier must never grant platform-wide access.

BAD:

An unscoped query for tenant-owned data.

GOOD conceptually: authorize the current tenant on the server, then constrain
each business-user operation to that tenant using the agreed container and
partition design. Partition routing alone does not provide authorization.

Never trust a tenantId supplied by the browser as proof that the user may access that tenant.

The server must determine the tenant from authenticated membership.

---

# 6. Prevent Cross-Tenant Access

Every operation involving tenant-owned resources must validate tenant ownership.

This includes:

- GET/read
- CREATE
- UPDATE
- DELETE
- searches
- exports
- background jobs
- webhook processing

IDs are not authorization.

Knowing a booking ID, customer ID, message ID, or payment ID must never grant access to that object.

Authorization must confirm tenant ownership.

---

# 7. Never Disable Security to Make Something Work

Do not temporarily remove:

- authentication
- authorization
- tenant filtering
- webhook validation
- input validation

simply to solve a development problem.

If security blocks expected functionality, fix the underlying issue.

Do not solve authentication problems by making protected endpoints public.

---

# 8. Secrets Must Never Enter Source Control

Never place real:

- API keys
- passwords
- access tokens
- refresh tokens
- private keys
- connection strings
- webhook signing secrets

inside source code.

Local secrets belong in appropriate environment files such as:

`.env.local`

Environment files containing real secrets must be excluded from Git.

An example file may contain variable names:

`.env.example`

but must contain no real credentials.

Never print secrets into:

- application logs
- browser console
- error responses
- screenshots
- test output

---

# 9. Never Expose Server Secrets to the Browser

Environment variables containing secrets must remain server-side.

Do not expose secrets through public environment-variable prefixes.

Never send provider credentials to React client components.

External provider communication requiring secrets must execute server-side.

---

# 10. Validate External Input

Treat all external input as untrusted.

This includes:

- form input
- query parameters
- route parameters
- request bodies
- webhook payloads
- third-party provider responses
- imported data

Use runtime validation.

Preferred validation library:

Zod

TypeScript types alone do not provide runtime validation.

---

# 11. Webhooks Are Untrusted

Never process a webhook purely because it reached the webhook URL.

Where supported, validate:

- signatures
- tokens
- timestamps
- provider-specific authenticity mechanisms

Webhook processing must be idempotent where duplicate delivery is possible.

Never create duplicate payments or messages merely because a provider retried an event.

---

# 12. Keep Providers Outside Core Business Logic

Core business logic must not directly depend on:

- Meta-specific payload structures
- Twilio-specific payload structures
- Stripe-specific payload structures
- email-provider-specific structures

Use adapters.

Conceptually:

Provider Payload
        |
        v
Provider Adapter
        |
        v
Internal Model
        |
        v
Business Logic

Provider changes should not require rewriting the booking or conversation domain.

---

# 13. Do Not Hard-Code Communication Channels

Do not assume:

- WhatsApp is always used
- SMS is always available
- email is always available
- Facebook is always available

The business may have different channels configured.

Core functionality should reference communication-channel abstractions.

---

# 14. Do Not Hard-Code Beauty Industry Logic

The initial market may include beauty businesses.

The platform itself is industry neutral.

Do not introduce core names such as:

- Salon
- Treatment
- Beautician
- Hairdresser
- NailAppointment
- Chair

Prefer:

- Business
- Service
- StaffMember
- Customer
- Booking
- Resource
- Location

Industry-specific language may eventually exist as configuration or presentation, not core architecture.

---

# 15. Financial Calculations Must Be Deterministic

Never use floating-point money calculations.

BAD:

`25.50 * 0.3`

Store money in integer minor units.

Example:

£25.50 = 2550 pence

Calculate percentages using explicit deterministic rounding rules.

Deposit calculation must never produce fractional minor currency units.

Example conceptual calculation:

Booking value:
£50.00 = 5000 pence

Deposit:
30%

Calculated deposit:
1500 pence

Displayed:
£15.00

---

# 16. Deposit Percentage Must Remain Valid

Deposit percentage must be within:

0 to 100 inclusive.

Do not accept:

- negative percentages
- percentages over 100
- invalid numeric input

Business default policy and booking-specific applied policy must remain distinguishable.

---

# 17. Preserve Historical Booking Terms

Do not calculate an old booking's required deposit solely from the business's current settings.

Example:

Booking created Monday:
30% deposit

Business changes default Friday:
50%

Monday's booking must retain its agreed 30% requirement.

Store the applied booking terms appropriately.

---

# 18. Deposit Overrides Must Be Traceable

If a user overrides a deposit requirement, do not silently replace the original calculation.

Retain sufficient information to establish:

- normal/default percentage
- applied percentage
- whether an override occurred
- who performed the override
- when the override occurred

Only appropriately authorized users should perform overrides.

---

# 19. Do Not Store Card Details

Never store:

- full payment card numbers
- CVV/CVC values
- raw card details

Use the external payment provider's secure payment mechanisms.

The application should retain only the references and statuses required to manage its own business workflow.

---

# 20. Database Schema Changes Require Deliberate Review

Do not modify the production database structure manually.

Version Cosmos DB document contracts, container configuration, and any
required data transformations in source control. Cosmos DB has no Prisma
schema or relational migration guarantees.

Before a significant schema change:

1. explain the change,
2. identify affected entities,
3. consider existing data,
4. plan compatibility, backfill, validation, and recovery,
5. review any container or data migration,
6. apply and test it with appropriate approval.

Do not casually delete documents or containers containing data.

---

# 21. Do Not Reset Databases Without Explicit Approval

Never run destructive database operations against an environment containing important data without explicit approval.

Examples include:

- database reset
- drop database
- delete container
- destructive migration
- bulk delete

Development database resets may only be performed when it is clear that the environment contains disposable development data.

---

# 22. Authentication and Authorization Are Different

Successful authentication only proves identity.

It does not automatically grant access to:

- businesses
- customers
- bookings
- conversations
- payments
- administration functions

Every protected server operation must enforce appropriate authorization.

---

# 23. Client-Side Checks Are Not Security

UI behaviour can improve user experience but cannot enforce security.

For example, hiding a "Delete Booking" button from a STAFF user does not secure the delete endpoint.

The server must independently reject unauthorized actions.

---

# 24. Avoid `any`

Do not use TypeScript `any` simply to suppress compiler errors.

Preferred approaches include:

- explicit types
- generics
- `unknown` followed by validation/narrowing
- provider-specific types at adapter boundaries

If `any` is unavoidable, document why.

---

# 25. Do Not Suppress Errors Without Understanding Them

Never resolve development problems by blindly adding:

- `@ts-ignore`
- disabled ESLint rules
- empty catch blocks
- forced type casts

Investigate the underlying issue first.

Exceptions must be deliberate and documented.

---

# 26. Do Not Swallow Errors

BAD:

`catch {}`

Failures must be handled appropriately.

Depending on context:

- log the failure,
- return an appropriate response,
- retry a transient external operation,
- mark an operation as failed,
- show a safe user-facing message.

Never expose secrets or internal stack traces to customers.

---

# 27. External Providers Will Fail

Assume that external systems can:

- time out
- reject requests
- return errors
- throttle requests
- send duplicate events
- become temporarily unavailable

Do not design messaging or payment workflows assuming successful external responses every time.

---

# 28. Background Jobs Must Be Safe to Retry

Where possible, background operations should be idempotent.

Retrying a job must not accidentally:

- send duplicate payment requests
- create duplicate bookings
- create duplicate messages
- repeatedly change the same state incorrectly

Reminder retry behaviour must be designed deliberately to avoid repeatedly messaging customers.

---

# 29. Do Not Use Browser Timers for Business-Critical Scheduling

Do not use mechanisms such as:

`setTimeout()`

in the browser to implement:

- booking reminders
- payment reminders
- future business events

Closing the user's browser must not stop business workflows.

Use reliable server-side/background scheduling.

---

# 30. Dates and Timezones Must Be Explicit

Do not assume the application only operates in one timezone.

Persist timestamps consistently, preferably in UTC where appropriate.

Display times using the tenant's configured timezone.

Avoid relying on the web server's local timezone.

---

# 31. Currency Must Be Explicit

Do not assume all businesses use GBP.

Even if the initial business operates in the UK, data structures should allow an explicit currency.

Do not add full multi-currency accounting unless required.

Supporting a defined currency field is sufficient initially.

---

# 32. Do Not Add Dependencies Casually

Before installing a new dependency, determine:

1. what problem it solves,
2. whether existing dependencies already solve that problem,
3. whether a lightweight implementation is appropriate,
4. whether the package is actively maintained,
5. whether it creates security or operational risk.

Avoid adding a library for trivial functionality.

---

# 33. No Premature Microservices

The current architecture is a modular monolith.

Do not create separate deployed services for:

- customers
- bookings
- messaging
- payments
- reminders

unless a documented architectural decision requires it.

Logical modularity is required.

Distributed deployment is not.

---

# 34. Do Not Prematurely Optimize

Optimize when there is evidence of a problem.

Priorities are:

1. correctness
2. security
3. tenant isolation
4. usability
5. maintainability
6. performance

Do not create unnecessary caching, queues, distributed state, or infrastructure without a demonstrated reason.

---

# 35. Avoid Giant Components

Do not allow React components to accumulate unrelated responsibilities.

Separate:

- presentation
- data access
- business logic
- integrations

Keep important domain logic outside UI components.

React components must not directly call provider APIs requiring secrets.

---

# 36. Accessibility

Do not intentionally introduce inaccessible UI.

Interactive controls should:

- use appropriate semantic elements,
- have accessible names,
- support keyboard interaction,
- have visible focus behaviour.

Forms should associate labels with controls and provide understandable validation feedback.

---

# 37. Responsive Design

The platform must be usable on:

- mobile phones
- tablets
- desktop browsers

Do not build a desktop-only interface and plan to "make it mobile later."

Mobile usability must be considered as components are created.

---

# 38. Avoid Destructive UI Actions Without Protection

Actions such as:

- cancelling a booking
- deleting information
- refunding a payment
- disconnecting an integration

should include appropriate confirmation or safeguards.

Never make financially consequential operations occur accidentally through a single ambiguous action.

---

# 39. Keep Business Logic Server-Side

Important business calculations and decisions must be enforced server-side.

Examples:

- deposit calculation
- permissions
- booking status transitions
- tenant validation
- payment status changes

The client may display predicted values but cannot be the authoritative source.

---

# 40. Tests Must Prove Important Behaviour

Tests should prioritize risk.

Important areas include:

- Tenant A cannot access Tenant B data
- unauthorized users cannot perform privileged actions
- deposit percentages calculate correctly
- 0% deposit works
- 100% deposit works
- deposit overrides work correctly
- duplicate webhook events do not duplicate records
- failed external integrations are handled
- reminder scheduling behaves correctly

Do not produce large numbers of superficial tests simply to increase coverage metrics.

---

# 41. Never Fabricate Successful Integration Results

During development, integrations may use clearly identified mocks or test environments.

Never present mocked behaviour as though a real provider successfully processed it.

Clearly distinguish:

- mocked
- sandbox/test
- live/production

integration states.

---

# 42. Protect Customer Data in Development

Do not copy real customer information into:

- source-controlled fixtures
- screenshots
- automated test data
- public logs

Use synthetic development/test customers.

---

# 43. No Silent Architectural Decisions

If implementation requires a new significant choice that is not already documented, STOP.

Examples:

- changing database technology
- changing authentication provider
- adding a queue platform
- changing payment provider
- changing the approved database access approach
- introducing a new cloud service
- splitting the application into separate services

Explain:

1. the decision required,
2. why it is required,
3. the available options,
4. the recommended option,
5. the trade-offs.

Wait for approval before implementing the architectural change.

---

# 44. Keep Documentation Synchronized

When an approved implementation changes:

- product behaviour
- architecture
- significant business rules
- build stage assumptions

update the corresponding documentation.

Do not allow the implementation and documentation to silently diverge.

---

# 45. Git Safety

Before significant changes, ensure the current working state can be recovered.

Prefer small, meaningful commits.

Do not:

- force push
- rewrite shared Git history
- delete branches containing work
- discard uncommitted changes

unless explicitly instructed.

Never commit secrets.

---

# 46. AI Development Behaviour

When Copilot is asked to make a change:

1. Read `.github/copilot-instructions.md`.
2. Read the relevant project documentation.
3. Inspect the current code.
4. Confirm the active build stage.
5. identify the smallest implementation required.
6. Make only those changes.
7. Run appropriate checks/tests.
8. Explain exactly what changed.
9. Report failures honestly.
10. STOP.

Do not autonomously proceed into another stage.

---

# 47. No "While I'm Here" Changes

Do not modify unrelated functionality during an implementation task.

Avoid statements such as:

"While I was here, I also..."

unless the additional change was essential to safely complete the requested work.

Unrelated improvements should be proposed separately.

---

# 48. Prefer Boring Technology

For core infrastructure, prefer:

- established technologies
- understandable patterns
- maintained libraries
- predictable behaviour

over experimental technology.

This application handles:

- customer communications
- bookings
- money
- business data

Reliability is more important than novelty.

---

# 49. Stop Conditions

STOP implementation and ask for a decision if:

- the requirement contradicts PRODUCT.md,
- tenant isolation cannot be guaranteed,
- a security control would need to be removed,
- a destructive database action is required,
- a new major architecture decision is required,
- payment behaviour is ambiguous,
- an action risks losing existing work,
- required credentials or configuration are unavailable,
- the requested change extends beyond the current approved build stage.

Do not guess through high-impact ambiguity.

---

# 50. Final Rule

When choosing between:

FAST BUT UNSAFE

and:

SLIGHTLY SLOWER BUT CORRECT AND SECURE

choose the correct and secure implementation.

When choosing between:

COMPLEX AND CLEVER

and:

SIMPLE AND MAINTAINABLE

choose simple and maintainable.

When choosing between:

BUILDING FUTURE FEATURES NOW

and:

BUILDING THE CURRENT REQUIREMENT WELL

build the current requirement well.