import type { Metadata } from "next";
import { LegalPage } from "@/app/components/legal-page";

export const metadata: Metadata = {
  title: "Data deletion | BookSimple",
  description:
    "How account holders, business customers and messaging users can request deletion of personal information from BookSimple.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Data-deletion instructions"
      summary="Use the instructions below to request deletion of a BookSimple account or personal information held in a business workspace."
    >
      <section>
        <h2>1. Choose the request that applies to you</h2>
        <h3>BookSimple account holder</h3>
        <p>
          To request deletion of your BookSimple account, email us from the
          address registered to the account. Include your name, registered email
          address and business name. Do not send your password, verification
          codes or payment-card details.
        </p>

        <h3>Customer of a business using BookSimple</h3>
        <p>
          Contact the business you booked with or messaged first. That business
          controls its customer records and can correct, archive or permanently
          erase customer personal fields through an authorized company
          administrator.
        </p>
        <p>
          If you cannot reach the business, email us with the business or
          Facebook Page name, the communication channel used, your contact
          details on that channel and an approximate date of the conversation.
          Send only the information needed to locate the record.
        </p>

        <h3>Facebook Messenger user</h3>
        <p>
          You may ask the Facebook Page you contacted to delete your information
          or email BookSimple using the instructions below. Include the Page
          name and approximate dates of the Messenger conversation. Deleting
          information from BookSimple does not automatically delete copies held
          by Meta or in your own Messenger account.
        </p>
      </section>

      <section>
        <h2>2. Send the request</h2>
        <p>
          Email{" "}
          <a
            className="dashboard-action-link legal-inline-link"
            href="mailto:mike@solutionsdeveloped.co.uk?subject=BookSimple%20data-deletion%20request"
          >
            mike@solutionsdeveloped.co.uk
          </a>{" "}
          with the subject <strong>BookSimple data-deletion request</strong>.
        </p>
        <p>Please include:</p>
        <ul>
          <li>your full name;</li>
          <li>the relevant business or Facebook Page;</li>
          <li>your BookSimple account email, if you have one;</li>
          <li>the email address, phone number or channel used to contact the business; and</li>
          <li>a clear description of the information you want deleted.</li>
        </ul>
      </section>

      <section>
        <h2>3. Identity verification</h2>
        <p>
          We must protect information from unauthorized deletion. We may ask you
          to verify control of the relevant account, email address, phone number
          or messaging identity. We will not ask for your password or full
          payment-card details.
        </p>
      </section>

      <section>
        <h2>4. What happens next</h2>
        <ol>
          <li>We acknowledge and review the request.</li>
          <li>We verify identity and determine whether BookSimple or the connected business controls the record.</li>
          <li>We delete or anonymize the relevant personal information where required.</li>
          <li>We confirm completion or explain any information that must lawfully be retained.</li>
        </ol>
        <p>
          We aim to respond within one month after receiving a valid request.
          Complex requests may take longer where permitted by law; if so, we
          will explain the reason and expected timescale.
        </p>
      </section>

      <section>
        <h2>5. Information that may be retained</h2>
        <p>
          Some information may be retained where necessary for legal
          obligations, fraud prevention, security, dispute resolution or the
          integrity of booking and payment records. Where possible, personal
          fields are anonymized while non-identifying record references are
          preserved.
        </p>
        <ul>
          <li>Anonymized deleted-account tombstones may be retained for up to 1 year.</li>
          <li>Privileged security and administration audit records may be retained for up to 1 year.</li>
          <li>Payment providers retain transaction information under their own legal obligations and policies.</li>
          <li>Messages already delivered through Meta, Twilio or email providers may also remain in those external services.</li>
        </ul>
      </section>

      <section>
        <h2>6. Complaints</h2>
        <p>
          If you are dissatisfied with the response, you may contact the UK
          Information Commissioner&apos;s Office at{" "}
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
    </LegalPage>
  );
}
