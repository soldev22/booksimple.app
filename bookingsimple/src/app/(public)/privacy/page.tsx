import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/app/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy | BookSimple",
  description:
    "How BookSimple collects, uses, protects, retains and deletes personal information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      summary="This policy explains how BookSimple handles personal information when businesses use the workspace and when customers communicate with those businesses."
    >
      <section>
        <h2>1. Who this policy covers</h2>
        <p>
          BookSimple is a communications and booking platform for independent
          businesses. This policy covers business applicants, account holders,
          staff members, customers who communicate with a connected business,
          and visitors to our public pages.
        </p>
        <p>
          For account administration and operation of the BookSimple service,
          BookSimple acts as a data controller. For customer information that a
          business manages through its workspace, the business normally decides
          why and how that information is used and BookSimple processes it on
          the business&apos;s behalf.
        </p>
      </section>

      <section>
        <h2>2. Information we process</h2>
        <ul>
          <li>
            Account and business information, including names, email addresses,
            authentication records, business details, staff roles and settings.
          </li>
          <li>
            Customer and booking information entered by a business, such as
            names, contact details, services, booking times, reminders and
            deposit terms.
          </li>
          <li>
            Communications sent through connected email, SMS, WhatsApp or
            Facebook Messenger channels, including message content, timestamps,
            delivery state and provider identifiers needed to route replies.
          </li>
          <li>
            Payment records such as amounts, status and provider references.
            BookSimple does not store full payment-card details; those are
            handled by the payment provider.
          </li>
          <li>
            Security and operational information, including session records,
            rate-limit data, audit events and technical error information.
          </li>
        </ul>
        <p>
          We receive information directly from account holders and businesses,
          from customers who contact a connected business, and from the service
          providers used to deliver messages and payments.
        </p>
      </section>

      <section>
        <h2>3. Why we use information</h2>
        <p>We process personal information to:</p>
        <ul>
          <li>provide, secure and support the BookSimple workspace;</li>
          <li>authenticate users and enforce tenant and role boundaries;</li>
          <li>deliver, correlate and display business communications;</li>
          <li>manage customers, bookings, deposits, reminders and payments;</li>
          <li>detect misuse, investigate failures and maintain audit records;</li>
          <li>meet legal, regulatory and contractual obligations; and</li>
          <li>improve service reliability and usability.</li>
        </ul>
        <p>
          Depending on the context, our lawful basis is performance of a
          contract, legitimate interests in operating and securing the service,
          compliance with a legal obligation, or consent where consent is
          required. A connected business is responsible for having an
          appropriate lawful basis for the customer information it places in
          BookSimple.
        </p>
      </section>

      <section>
        <h2>4. Sharing and service providers</h2>
        <p>
          We disclose information only where needed to operate the service,
          follow a business&apos;s instructions, comply with law, or protect
          people and the platform. Providers currently used by BookSimple may
          include:
        </p>
        <ul>
          <li>Vercel for application hosting;</li>
          <li>Microsoft Azure for database services;</li>
          <li>Postmark for email delivery;</li>
          <li>Twilio for SMS and WhatsApp messaging;</li>
          <li>Meta for Facebook Messenger; and</li>
          <li>Stripe for payment processing and connected-account services.</li>
        </ul>
        <p>
          These providers process information under their own terms and privacy
          commitments. Some processing may occur outside the United Kingdom.
          Where required, appropriate contractual or legal transfer safeguards
          must be used.
        </p>
        <p>We do not sell personal information.</p>
      </section>

      <section>
        <h2>5. Cookies and local storage</h2>
        <p>
          BookSimple uses essential session and security storage needed to sign
          users in, protect accounts and preserve requested account actions. We
          do not currently use the workspace for third-party behavioural
          advertising.
        </p>
      </section>

      <section>
        <h2>6. Retention</h2>
        <p>
          We keep information only for as long as needed for the purpose for
          which it was collected, to provide the service, resolve disputes,
          maintain security and meet legal obligations. Current operational
          periods include:
        </p>
        <ul>
          <li>sessions for no more than 7 days;</li>
          <li>pending invitations and failed notifications for up to 30 days;</li>
          <li>completed invitations and sent notification metadata for up to 90 days;</li>
          <li>privileged audit records and anonymized account tombstones for 1 year; and</li>
          <li>
            business, booking, payment and communication records for the
            business relationship or another approved retention period.
          </li>
        </ul>
        <p>
          A business may archive customer records. An authorized company
          administrator can permanently erase customer personal fields while
          preserving anonymous identifiers needed to maintain record integrity.
        </p>
      </section>

      <section>
        <h2>7. Security</h2>
        <p>
          BookSimple uses server-side authorization, tenant-scoped access,
          runtime input validation, signed provider webhooks, protected
          credentials and audit records. No online service can guarantee
          absolute security, so account holders must also use strong credentials
          and promptly report suspected misuse.
        </p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          Depending on applicable law, you may have rights to access, correct,
          erase, restrict or object to processing of your personal information,
          and to receive a portable copy. You may also withdraw consent where
          processing relies on consent.
        </p>
        <p>
          Customers should normally contact the business they communicated
          with first because that business controls its customer records.
          Account holders and other requesters can follow our{" "}
          <Link className="dashboard-action-link legal-inline-link" href="/data-deletion">
            data-deletion instructions
          </Link>
          .
        </p>
        <p>
          You may complain to the UK Information Commissioner&apos;s Office at{" "}
          <a
            className="dashboard-action-link legal-inline-link"
            href="https://ico.org.uk/make-a-complaint/"
            rel="noreferrer"
          >
            ico.org.uk
          </a>
          .
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          BookSimple business accounts are not intended for children. Businesses
          using the platform remain responsible for any additional safeguards
          required when they provide services to children or process a
          child&apos;s information.
        </p>
      </section>

      <section>
        <h2>10. Changes and contact</h2>
        <p>
          We may update this policy when the service or legal requirements
          change. The effective date above identifies the current version.
        </p>
        <p>
          Privacy questions and rights requests can be sent to{" "}
          <a
            className="dashboard-action-link legal-inline-link"
            href="mailto:mike@solutionsdeveloped.co.uk"
          >
            mike@solutionsdeveloped.co.uk
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
