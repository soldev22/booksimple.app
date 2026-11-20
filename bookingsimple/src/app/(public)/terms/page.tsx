import type { Metadata } from "next";
import { LegalPage } from "@/app/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of service | BookSimple",
  description: "The terms governing access to and use of the BookSimple platform.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      summary="These terms govern business access to and use of the BookSimple communications and booking platform."
    >
      <section>
        <h2>1. Agreement</h2>
        <p>
          By creating an account, accepting an invitation or using BookSimple,
          you agree to these terms on behalf of yourself and, where applicable,
          the business you represent. You must be at least 18 years old and have
          authority to bind that business.
        </p>
        <p>
          If separate written order, subscription or service terms apply, those
          terms take priority where they expressly conflict with these terms.
        </p>
      </section>

      <section>
        <h2>2. The service</h2>
        <p>
          BookSimple provides a multi-tenant workspace for customer
          communications, customer records, services, bookings, deposits,
          payments and reminders. Availability of individual communication or
          payment channels depends on the relevant third-party provider and the
          business&apos;s configuration.
        </p>
        <p>
          BookSimple provides software to the business. The business, not
          BookSimple, supplies the underlying services to its customers and is
          responsible for its prices, availability, bookings, cancellations,
          refunds, customer communications and legal obligations.
        </p>
      </section>

      <section>
        <h2>3. Accounts and access</h2>
        <ul>
          <li>Account information must be accurate and kept up to date.</li>
          <li>Credentials must be kept confidential and must not be shared.</li>
          <li>
            Company administrators control staff invitations, roles and
            lifecycle within their business.
          </li>
          <li>
            You must notify us promptly of suspected unauthorized access or a
            compromised account.
          </li>
        </ul>
        <p>
          Each account and business workspace is subject to approval and may be
          paused, restricted or rejected where required to protect users, comply
          with law or enforce these terms.
        </p>
      </section>

      <section>
        <h2>4. Acceptable use</h2>
        <p>You must not use BookSimple to:</p>
        <ul>
          <li>break the law or infringe another person&apos;s rights;</li>
          <li>send spam, unsolicited marketing or prohibited communications;</li>
          <li>harass, deceive, exploit or harm another person;</li>
          <li>upload malware or interfere with platform security or availability;</li>
          <li>attempt to access another business&apos;s workspace or data;</li>
          <li>reverse engineer or bypass technical restrictions except where law permits; or</li>
          <li>store payment-card details or other information the service is not designed to hold.</li>
        </ul>
        <p>
          You are responsible for obtaining any consent and providing any notice
          required before contacting customers or entering their information in
          the service.
        </p>
      </section>

      <section>
        <h2>5. Messaging channels</h2>
        <p>
          Email, SMS, WhatsApp and Facebook Messenger are delivered through
          external providers. You must follow each provider&apos;s policies,
          consent requirements, messaging windows and acceptable-use rules.
          Delivery, identity matching and availability cannot be guaranteed.
        </p>
        <p>
          Facebook conversations must be initiated by the Messenger user.
          WhatsApp and other channels may restrict free-form replies to an active
          customer-service window. BookSimple must not be used to circumvent
          those restrictions.
        </p>
      </section>

      <section>
        <h2>6. Bookings, deposits and payments</h2>
        <p>
          Businesses are responsible for configuring services, booking terms,
          deposit percentages, cancellation rules and customer-facing prices.
          Deposit requirements may range from 0% to 100%.
        </p>
        <p>
          Payment processing is provided by Stripe or another identified payment
          provider. Payment-provider terms also apply. BookSimple does not hold
          customer card details and does not guarantee settlement, chargeback or
          refund outcomes.
        </p>
      </section>

      <section>
        <h2>7. Customer data and privacy</h2>
        <p>
          A business is responsible for customer information placed in its
          workspace, including the accuracy of that information and the lawful
          basis for processing it. BookSimple processes that information to
          provide and secure the service and as otherwise described in our
          Privacy Policy.
        </p>
        <p>
          You must not access, export or disclose information belonging to
          another business. Account and customer deletion requests are handled
          under our published data-deletion instructions.
        </p>
      </section>

      <section>
        <h2>8. Third-party services</h2>
        <p>
          BookSimple integrates with services operated by organizations such as
          Meta, Twilio, Postmark, Microsoft, Vercel and Stripe. We are not
          responsible for changes, outages, suspensions or decisions made by
          those providers. You remain responsible for maintaining any external
          account and permission required for your chosen integration.
        </p>
      </section>

      <section>
        <h2>9. Intellectual property</h2>
        <p>
          BookSimple and its software, design and documentation remain the
          property of the service operator and its licensors. Subject to these
          terms, you receive a limited, non-exclusive and non-transferable right
          to use the service for your internal business operations.
        </p>
        <p>
          You retain rights in content you lawfully provide. You grant us the
          limited rights needed to host, transmit, protect and process that
          content to provide the service.
        </p>
      </section>

      <section>
        <h2>10. Availability and changes</h2>
        <p>
          We aim to provide a reliable service but do not promise uninterrupted
          or error-free availability. We may maintain, secure, improve or change
          the service. Where reasonably practicable, material changes affecting
          normal use will be communicated in advance.
        </p>
      </section>

      <section>
        <h2>11. Suspension and termination</h2>
        <p>
          Access may be suspended or terminated for material breach, unlawful
          activity, security risk, non-payment under applicable subscription
          terms, or where a provider or legal authority requires it. You may
          stop using the service and request account deletion, subject to
          outstanding obligations and lawful retention requirements.
        </p>
      </section>

      <section>
        <h2>12. Disclaimers and liability</h2>
        <p>
          To the extent permitted by law, the service is provided on an
          &quot;as available&quot; basis. Nothing in these terms excludes
          liability that cannot lawfully be excluded, including liability for
          fraud, fraudulent misrepresentation, or death or personal injury
          caused by negligence.
        </p>
        <p>
          Subject to those mandatory rights, BookSimple is not responsible for
          indirect or consequential loss, loss caused by a business&apos;s own
          configuration or conduct, or failure of an external provider. Any
          additional liability limits stated in an applicable written service
          agreement continue to apply.
        </p>
      </section>

      <section>
        <h2>13. Governing law</h2>
        <p>
          These terms are governed by the laws of Scotland, and the Scottish
          courts have jurisdiction, except where mandatory law gives a party the
          right to bring proceedings elsewhere.
        </p>
      </section>

      <section>
        <h2>14. Changes and contact</h2>
        <p>
          We may update these terms as the service changes. Continued use after
          an updated version takes effect constitutes acceptance where permitted
          by law.
        </p>
        <p>
          Questions can be sent to{" "}
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
