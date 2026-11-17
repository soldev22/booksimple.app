# Universal Communications & Booking Platform
## Product Definition

## 1. Product Vision

Build a simple multi-tenant platform that gives small B2C businesses one place to manage:

- customer conversations
- bookings
- deposits
- confirmations
- reminders

Customers should be able to communicate with a business using channels they already use rather than being forced to install another application.

Initial channels:

- WhatsApp
- Facebook / Meta messaging
- SMS
- Email

The business sees these interactions through one unified application.

The platform may initially be tested with beauty businesses, but the core product must remain suitable for many appointment and service-based businesses.

Examples include:

- beauty businesses
- hairdressers
- barbers
- personal trainers
- therapists
- tutors
- cleaners
- consultants
- trades and home services
- other appointment-based businesses

Industry-specific functionality must not be built into the core platform unless explicitly approved.

---

# 2. The Problem

Small B2C businesses frequently communicate with customers through several disconnected channels.

A customer might:

- enquire through Facebook,
- continue the conversation through WhatsApp,
- receive a booking confirmation by SMS,
- receive an invoice or other information by email,
- and later contact the business again through another channel.

This creates fragmented customer communication.

Businesses must monitor several applications and manually connect conversations, bookings and payments.

The product should reduce that fragmentation.

---

# 3. Core Product Experience

The intended customer journey is:

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

Not every conversation must result in a booking.

Not every booking requires a deposit.

The system must therefore keep conversations, bookings and payments related but independently manageable.

---

# 4. Multi-Tenant Platform

The platform will be a SaaS application supporting multiple independent businesses.

Each business is a tenant.

Each tenant must have its own:

- users
- customers
- conversations
- messages
- bookings
- services
- deposit configuration
- reminder configuration
- communication channels
- integration settings

Tenant data must remain isolated.

A business user belonging to Business A must never gain access to Business B
through their business membership. An explicitly authorised platform
administrator may access data across businesses in their separate platform
role.

Each business has a unique GUID. Tenant-owned activities must retain the
owning business GUID and have their own activity GUID for identification.
An identifier alone does not grant access.

---

# 5. Business Onboarding

A business should eventually be able to:

1. create its business account,
2. enter basic business details,
3. configure users,
4. configure services,
5. configure booking preferences,
6. configure its deposit policy,
7. configure reminders,
8. connect supported communication channels,
9. begin receiving and responding to customer communications.

Onboarding should be kept as simple as possible.

Businesses register for a workspace, but a platform administrator must approve
the application before the workspace is enabled. Applicants can check their
application status and receive approval or rejection notifications by email.
Company administrators invite users to join their company.

Customers communicate through existing channels and do not need application
accounts. A channel message alone does not establish a customer's identity.

---

# 6. Unified Inbox

The application will provide a unified business inbox.

Messages from supported communication channels should appear as conversations inside the platform.

Initial channels:

- WhatsApp
- Facebook / Meta messaging
- SMS
- Email

Each message must retain information about its originating channel.

Example:

Customer: Jane Smith

Conversation:

WhatsApp
"Hi, do you have anything available Friday?"

Business
"Yes, I have 2:30 or 4:00."

Customer
"4 please."

The business should not need to leave the platform to continue the conversation where technically possible.

---

# 7. Customer Records

The platform maintains customer records.

A customer may have one or more identifiers, including:

- name
- mobile number
- email address
- communication-channel identifiers

The system should be designed to associate multiple communication channels with the same customer where reliable matching is possible.

Automatic matching must not recklessly merge different people simply because some data appears similar.

Customer records may be created through:

- incoming communication,
- manual creation,
- a booking,
- future integrations.

A business does not need to pre-create every Customer before communication can
begin. A Conversation may initially represent an unresolved channel contact.
Staff can later link that Conversation to an existing Customer or create a new
Customer from it. Weak or ambiguous similarities must never silently merge
Customer records, and a Booking requires a resolved Customer identity.

Customer matching is tenant-scoped. The system may automatically link a
Conversation only when one Customer has an exact verified channel identity or
exact normalized email or phone. Multiple exact matches require staff review.
When no Customer matches, the inbox offers to create one with known contact
details prefilled. Name similarity alone never creates or links a Customer.

During initial Customer management, active company users can create, search,
view, edit and archive Customer records for their own business. Permanent
erasure of Customer personal information is restricted to company
administrators and preserves only the anonymous identity needed by future
records.

---

# 8. Conversations

A conversation represents communication between a business and a customer.

A conversation contains messages.

Each message should retain relevant information such as:

- tenant/business
- customer
- conversation
- direction
- communication channel
- sender
- recipient
- timestamp
- message content
- delivery status where available
- external provider identifier where required

Direction must distinguish between:

- inbound
- outbound

Core conversation behaviour must remain independent of individual communication providers.

The implemented first Inbox allows communication to begin with either a linked
Customer or an unresolved contact. Exact email and phone matching remains
tenant-scoped; ambiguous matches require staff selection, and no match offers a
prefilled Customer creation form. Stage 8 messages are local development
records only. Outbound replies are clearly marked local-only and are not sent
through WhatsApp, Meta, SMS or email.

---

# 9. Services

Businesses may define services that can be booked.

A service contains:

- name
- description
- duration in minutes
- price stored in integer currency minor units
- currency
- active/inactive status

The concept of a service is generic.

Do not assume a service is a beauty treatment, haircut or any other industry-specific activity.

Active company users can create, search, view and edit Services belonging to
their own business. Services are deactivated rather than physically deleted so
future Booking references retain a stable Service identity.

---

# 10. Bookings

A business user must be able to create a booking.

A booking may be created:

- manually,
- from a customer conversation,
- through future customer self-booking,
- through future integrations.

A booking may contain:

- tenant/business
- customer
- service
- assigned staff member or resource
- location
- start date/time
- duration
- price
- status
- notes
- deposit requirement
- deposit status

The exact database model will be defined separately in the architecture.

---

# 11. Booking Status

The system should support a clear booking lifecycle.

Initial conceptual statuses may include:

- pending
- awaiting deposit
- confirmed
- completed
- cancelled
- no-show

These statuses should remain implementation-neutral until the data model is agreed.

---

# 12. Deposits

Businesses must be able to request deposits for bookings.

A business must be able to configure a deposit percentage from:

0% to 100%.

Examples:

0% = no deposit required

20% = customer pays 20% of the booking value

50% = customer pays half of the booking value

100% = full payment required in advance

A deposit policy must not be inherently tied to a specific product or industry.

The architecture should allow deposit policies to become more sophisticated later without redesigning the entire booking system.

For example, future versions could support different policies based on:

- services
- customers
- booking value
- booking circumstances

These are future capabilities and must not be implemented in V1 unless explicitly requested.

---

# 13. Deposit Override

An authorised business user must eventually be able to override the normal deposit requirement for an individual booking.

Example:

Business default deposit: 30%

Customer is a trusted regular customer.

Business user changes this booking's deposit requirement to:

0%

The override applies to that booking only.

The system should retain enough information to distinguish the business's default policy from an individual booking override.

---

# 14. Payments

Payments should be handled through an external payment provider rather than storing card details in the application.

The application needs to record appropriate information about the payment/deposit, such as:

- amount required
- payment status
- provider reference
- payment timestamp

Payment provider selection will be made during architecture/integration planning.

Do not implement a payment provider until that decision has been made.

---

# 15. Booking Confirmation

Once a booking reaches the appropriate confirmed state, the system should be capable of sending confirmation to the customer.

Confirmation should include relevant booking information.

The communication architecture should allow confirmations to use an appropriate configured channel.

Do not hard-code confirmations to SMS, WhatsApp or email.

---

# 16. Reminders

Businesses should be able to configure booking reminders.

Examples could eventually include:

- 24 hours before booking
- 48 hours before booking
- one week before booking

These are examples rather than fixed product rules.

Reminder timing should be configurable.

Reminder delivery should eventually support appropriate available communication channels.

Reminder infrastructure must support reliable background processing.

---

# 17. Business Users

A tenant may have multiple users.

Each business user must be able to sign in with an email address and password.
Authenticator-app MFA is temporarily unavailable for all users by explicit
product decision. This increases the risk of account takeover, particularly
for platform administrators with access across businesses.

All users register and sign in through the same account system. Email addresses
are unique across the platform and cannot initially be changed. The registered
name is shown when managing a user; internal company usernames are unique only
within their company and are not presented as the user's display name. A user
can belong to at most one business. Selected users can be
granted a separate platform-administrator role with access across businesses.
A platform
administrator's display name is optional. Company administrators manage their
own business and invite its users. Staff users manage bookings for their own
business.

New users cannot access a workspace until assigned an appropriate role.
Pending applicants can submit and check their business application. Platform
administrators approve businesses, which grants the applicant the
least-privileged company-user role by default. A platform administrator must
separately elevate a user to company administrator. Only an existing platform
administrator can grant the platform-administrator role. Rejected applicants
can correct the proposed business name and resubmit the same application.
Platform review separates actual company records from applications and warns
when another company has the same normalized name; the reviewer explicitly
decides whether the application represents a separate company.

Detailed permissions, account recovery, and administrator provisioning must
be designed before implementation.

---

# 18. Business Dashboard

The application should eventually provide a simple dashboard containing useful operational information.

Examples may include:

- today's bookings
- upcoming bookings
- conversations requiring attention
- deposits awaiting payment

The dashboard should remain operational and simple.

Advanced analytics are outside the initial product scope.

---

# 19. V1 Scope

The first usable version should prove that the core workflow works.

V1 target:

1. Create a business tenant.
2. Create/manage a customer.
3. Receive or create a conversation.
4. View messages in a unified inbox.
5. Send a reply.
6. Create a booking associated with the customer.
7. Apply the business's deposit rule.
8. Allow an authorised deposit override.
9. Track whether the deposit has been paid.
10. Confirm the booking.
11. Schedule and send a reminder.

V1 does not need every external communication provider working simultaneously.

The implementation can prove the architecture with selected integrations before additional channels are added.

---

# 20. Explicitly Out of Scope for Initial Build

Do not build the following unless explicitly added to the project scope:

- payroll
- accounting
- stock/inventory management
- employee HR management
- complex CRM functionality
- loyalty programmes
- marketing automation
- social-media publishing
- AI assistants
- customer mobile apps
- native iOS applications
- native Android applications
- large analytics platforms
- industry-specific workflows

These capabilities may be considered later but are not part of the initial product.

---

# 21. Product Design Principles

The product should be:

## Simple

Small businesses must be able to understand the application without substantial training.

## Mobile Friendly

Business users may frequently access the platform from phones and tablets.

The web interface must therefore be responsive from the beginning.

## Fast

Common actions should require as few steps as practical.

## Channel Neutral

Core application logic must not depend on WhatsApp, Facebook, SMS or email.

## Industry Neutral

Core functionality must not depend on beauty-industry terminology or processes.

## Secure

Tenant isolation and protection of customer data are non-negotiable requirements.

## Expandable

Architecture should allow additional communication channels and capabilities without unnecessary rewrites.

---

# 22. Guiding Product Rule

Whenever a new feature is proposed, ask:

"Does this help a small business manage customer communication, booking, payment/deposit or the booking relationship?"

If YES:

Evaluate whether it belongs in the product.

If NO:

It is probably outside the core product and should not be implemented without an explicit scope decision.

---

# 23. Current Product Goal

The immediate objective is NOT to build the entire platform.

The immediate objective is to build the smallest technically sound version capable of proving:

Unified customer communication
+
Customer identity
+
Booking
+
Deposit
+
Confirmation
+
Reminder

Once that workflow works reliably for one tenant, the implementation must be proven to remain correctly isolated when multiple businesses use the platform.

Only then should the product expand into additional integrations and capabilities.