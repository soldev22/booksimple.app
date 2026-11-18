import "server-only";

import type Stripe from "stripe";
import { getRequestViewer } from "./auth";
import {
  isConflict,
  isPreconditionFailed,
  StorageError,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import {
  confirmBookingFromPaidDeposit,
  getBooking,
  markBookingAwaitingDeposit,
} from "./booking-service";
import type { BookingView } from "./booking-types";
import { mockPaymentProvider } from "./mock-payment-provider";
import { isCurrencyCode } from "./money";
import type { PaymentProviderAdapter } from "./payment-provider";
import {
  createPaymentDocument,
  queryBookingPayments,
  readPaymentDocument,
  replacePaymentDocument,
} from "./payment-storage";
import {
  PAYMENT_SCHEMA_VERSION,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  type PaymentDocument,
  type PaymentRequestView,
  type PaymentType,
  type PaymentView,
} from "./payment-types";
import type {
  CreatePaymentInput,
  MockPaymentConfirmationInput,
} from "./payment-validation";
import { getStripeClient } from "./stripe-client";
import { getReadyStripeAccountForContext } from "./stripe-connect-service";
import { parseStripeConfig } from "./stripe-config";
import { stripePaymentProvider } from "./stripe-payment-provider";
import {
  resolveStripePaymentStatus,
  stripeEventOutcome,
  validateStripeCheckoutEvent,
} from "./stripe-webhook-validation";
import { requireTenantContext } from "./tenant-context";

const TERMINAL_BOOKING_STATUSES = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

function paymentError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

function paymentIdForBooking(
  bookingId: string,
  paymentType: "DEPOSIT" | "BALANCE",
): string {
  return `${paymentType.toLowerCase()}-${bookingId}`;
}

function isPaymentDocument(
  document: PaymentDocument,
  id: string,
  tenantId: string,
): boolean {
  const providerValid =
    (document.provider === "MOCK_TEST" &&
      document.simulated === true &&
      (document.livemode === false || document.livemode === undefined) &&
      typeof document.externalPaymentId === "string" &&
      /^mock_pay_[0-9a-f-]{36}$/i.test(document.externalPaymentId)) ||
    (document.provider === "STRIPE" &&
      document.simulated === false &&
      typeof document.livemode === "boolean" &&
      typeof document.connectedAccountId === "string" &&
      /^acct_[A-Za-z0-9]+$/.test(document.connectedAccountId) &&
      (document.externalPaymentId === undefined ||
        /^cs_(test|live)_[A-Za-z0-9]+$/.test(
          document.externalPaymentId,
        )));
  return (
    document.id === id &&
    document.tenantId === tenantId &&
    document.type === "payment" &&
    document.schemaVersion === PAYMENT_SCHEMA_VERSION &&
    typeof document.bookingId === "string" &&
    PAYMENT_TYPES.includes(document.paymentType) &&
    Number.isSafeInteger(document.amountMinor) &&
    document.amountMinor > 0 &&
    isCurrencyCode(document.currency) &&
    PAYMENT_STATUSES.includes(document.status) &&
    providerValid &&
    (document.checkoutAttempt === undefined ||
      (Number.isSafeInteger(document.checkoutAttempt) &&
        document.checkoutAttempt >= 0)) &&
    (document.providerEventId === undefined ||
      typeof document.providerEventId === "string") &&
    (document.processedProviderEventIds === undefined ||
      (Array.isArray(document.processedProviderEventIds) &&
        document.processedProviderEventIds.length <= 20 &&
        document.processedProviderEventIds.every(
          (eventId) => typeof eventId === "string",
        ))) &&
    (document.paidAt === undefined ||
      Number.isFinite(Date.parse(document.paidAt))) &&
    typeof document.createdAt === "string" &&
    typeof document.updatedAt === "string"
  );
}

function toPaymentView(document: PaymentDocument): PaymentView {
  return {
    id: document.id,
    bookingId: document.bookingId,
    paymentType: document.paymentType,
    amountMinor: document.amountMinor,
    currency: document.currency,
    status: document.status,
    provider: document.provider,
    simulated: document.simulated,
    livemode: document.livemode ?? false,
    externalPaymentId: document.externalPaymentId,
    paidAt: document.paidAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

async function readOwnedPayment(context: TenantContext, id: string) {
  const result = await readPaymentDocument(id, context.tenantId);
  if (!result) throw paymentError(404, "Payment not found.");
  if (!isPaymentDocument(result.document, id, context.tenantId)) {
    throw paymentError(503, "The Payment record is invalid.");
  }
  return result;
}

async function reconcilePaymentBooking(
  context: TenantContext,
  payment: PaymentDocument,
): Promise<void> {
  if (payment.paymentType !== "DEPOSIT") return;
  if (payment.status === "PAID") {
    await confirmBookingFromPaidDeposit(context, payment.bookingId);
    return;
  }
  if (payment.status === "PENDING") {
    await markBookingAwaitingDeposit(context, payment.bookingId);
  }
}

function configuredProvider(): PaymentProviderAdapter {
  const configured =
    process.env.PAYMENT_PROVIDER?.trim().toUpperCase() || "MOCK_TEST";
  if (configured === "MOCK_TEST") return mockPaymentProvider;
  if (configured === "STRIPE") {
    parseStripeConfig(process.env);
    return stripePaymentProvider;
  }
  throw paymentError(503, "The Payment provider configuration is invalid.");
}

async function calculatePayment(
  context: TenantContext,
  booking: BookingView,
  paymentType: "DEPOSIT" | "BALANCE",
): Promise<{ amountMinor: number; paymentType: PaymentType }> {
  if (
    TERMINAL_BOOKING_STATUSES.includes(
      booking.status as (typeof TERMINAL_BOOKING_STATUSES)[number],
    )
  ) {
    throw paymentError(409, "The Booking cannot accept another Payment.");
  }
  if (paymentType === "DEPOSIT") {
    if (booking.depositAmountMinor <= 0) {
      throw paymentError(409, "This Booking does not require a deposit.");
    }
    if (booking.status === "CONFIRMED") {
      throw paymentError(
        409,
        "The Booking is not ready for a deposit Payment request.",
      );
    }
    return {
      amountMinor: booking.depositAmountMinor,
      paymentType: "DEPOSIT",
    };
  }
  if (booking.depositAmountMinor > 0) {
    const deposit = await readPaymentDocument(
      paymentIdForBooking(booking.id, "DEPOSIT"),
      context.tenantId,
    );
    if (
      !deposit ||
      !isPaymentDocument(
        deposit.document,
        deposit.document.id,
        context.tenantId,
      ) ||
      deposit.document.status !== "PAID"
    ) {
      throw paymentError(
        409,
        "The deposit must be paid before requesting the remaining balance.",
      );
    }
  }
  const amountMinor =
    booking.totalAmountMinor - booking.depositAmountMinor;
  if (amountMinor <= 0) {
    throw paymentError(409, "This Booking has no remaining balance.");
  }
  return { amountMinor, paymentType: "BALANCE" };
}

async function startProviderPayment(
  context: TenantContext,
  booking: BookingView,
  current: { document: PaymentDocument; etag: string },
  provider: PaymentProviderAdapter,
): Promise<PaymentRequestView> {
  const retryingFailedStripe =
    current.document.status === "FAILED" &&
    current.document.provider === "STRIPE";
  if (
    current.document.status !== "PENDING" &&
    !retryingFailedStripe
  ) {
    await reconcilePaymentBooking(context, current.document);
    return { payment: toPaymentView(current.document) };
  }
  if (provider.provider !== current.document.provider) {
    throw paymentError(
      409,
      "This Payment was created with a different configured provider.",
    );
  }
  let providerRequest;
  try {
    providerRequest = await provider.createPaymentRequest({
      context,
      paymentId: current.document.id,
      bookingId: current.document.bookingId,
      paymentType: current.document.paymentType,
      amountMinor: current.document.amountMinor,
      currency: current.document.currency,
      serviceName: booking.serviceName,
      existingExternalPaymentId: retryingFailedStripe
        ? undefined
        : current.document.externalPaymentId,
      checkoutAttempt: current.document.checkoutAttempt ?? 0,
    });
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw paymentError(
      503,
      "The payment provider could not start this Payment. Retry.",
    );
  }
  if (
    current.document.externalPaymentId ===
      providerRequest.externalPaymentId &&
    current.document.checkoutAttempt === providerRequest.checkoutAttempt
  ) {
    await reconcilePaymentBooking(context, current.document);
    return {
      payment: toPaymentView(current.document),
      checkoutUrl: providerRequest.checkoutUrl,
    };
  }
  try {
    const updated = await replacePaymentDocument(
      {
        ...current.document,
        status: "PENDING",
        externalPaymentId: providerRequest.externalPaymentId,
        checkoutAttempt: providerRequest.checkoutAttempt,
        updatedAt: new Date().toISOString(),
      },
      current.etag,
    );
    await reconcilePaymentBooking(context, updated.document);
    return {
      payment: toPaymentView(updated.document),
      checkoutUrl: providerRequest.checkoutUrl,
    };
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    const concurrent = await readOwnedPayment(context, current.document.id);
    await reconcilePaymentBooking(context, concurrent.document);
    return { payment: toPaymentView(concurrent.document) };
  }
}

export async function listBookingPayments(
  request: Request,
  bookingId: string,
): Promise<PaymentView[]> {
  const context = await contextForRequest(request);
  await getBooking(context, bookingId);
  const payments = await queryBookingPayments(context.tenantId, bookingId);
  if (
    payments.some(
      (payment) =>
        !isPaymentDocument(payment, payment.id, context.tenantId),
    )
  ) {
    throw paymentError(503, "The Booking contains an invalid Payment record.");
  }
  return payments.map(toPaymentView);
}

export async function createPayment(
  request: Request,
  input: CreatePaymentInput,
): Promise<PaymentRequestView> {
  const context = await contextForRequest(request);
  const booking = await getBooking(context, input.bookingId);
  const terms = await calculatePayment(
    context,
    booking,
    input.paymentType,
  );
  const paymentId = paymentIdForBooking(
    input.bookingId,
    input.paymentType,
  );
  const provider = configuredProvider();
  const existing = await readPaymentDocument(paymentId, context.tenantId);
  if (existing) {
    if (!isPaymentDocument(existing.document, paymentId, context.tenantId)) {
      throw paymentError(503, "The Payment record is invalid.");
    }
    if (
      existing.document.amountMinor !== terms.amountMinor ||
      existing.document.currency !== booking.currency
    ) {
      throw paymentError(
        409,
        "The existing Payment does not match the Booking financial terms.",
      );
    }
    return startProviderPayment(context, booking, existing, provider);
  }
  let connectedAccountId: string | undefined;
  let livemode = false;
  if (provider.provider === "STRIPE") {
    const account = await getReadyStripeAccountForContext(context);
    connectedAccountId = account.accountId;
    livemode = account.mode === "live";
  }
  const now = new Date().toISOString();
  let document: PaymentDocument = {
    id: paymentId,
    tenantId: context.tenantId,
    type: "payment",
    schemaVersion: PAYMENT_SCHEMA_VERSION,
    bookingId: booking.id,
    paymentType: terms.paymentType,
    amountMinor: terms.amountMinor,
    currency: booking.currency,
    status: "PENDING",
    provider: provider.provider,
    simulated: provider.simulated,
    livemode,
    connectedAccountId,
    checkoutAttempt: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (provider.provider === "MOCK_TEST") {
    const mockRequest = await provider.createPaymentRequest({
      context,
      paymentId,
      bookingId: booking.id,
      paymentType: terms.paymentType,
      amountMinor: terms.amountMinor,
      currency: booking.currency,
      serviceName: booking.serviceName,
      checkoutAttempt: 0,
    });
    document = {
      ...document,
      externalPaymentId: mockRequest.externalPaymentId,
      checkoutAttempt: mockRequest.checkoutAttempt,
    };
  }
  let created;
  try {
    created = await createPaymentDocument(document);
  } catch (error) {
    if (!isConflict(error)) throw error;
    const concurrent = await readOwnedPayment(context, paymentId);
    return startProviderPayment(context, booking, concurrent, provider);
  }
  return startProviderPayment(context, booking, created, provider);
}

export async function confirmMockPayment(
  request: Request,
  id: string,
  input: MockPaymentConfirmationInput,
): Promise<PaymentView> {
  const context = await contextForRequest(request);
  const current = await readOwnedPayment(context, id);
  if (current.document.provider !== "MOCK_TEST") {
    throw paymentError(
      409,
      "Stripe Payments can be confirmed only by a signed webhook.",
    );
  }
  if (current.document.status === "PAID") {
    await reconcilePaymentBooking(context, current.document);
    return toPaymentView(current.document);
  }
  if (
    current.document.status !== "PENDING" ||
    !current.document.externalPaymentId ||
    !mockPaymentProvider.confirmPayment
  ) {
    throw paymentError(409, "This Payment cannot be marked as paid.");
  }
  let confirmation;
  try {
    confirmation = mockPaymentProvider.confirmPayment(
      current.document.externalPaymentId,
      input.eventId,
    );
  } catch {
    throw paymentError(503, "The simulated provider notification is invalid.");
  }
  try {
    const updated = await replacePaymentDocument(
      {
        ...current.document,
        status: "PAID",
        providerEventId: confirmation.providerEventId,
        processedProviderEventIds: [confirmation.providerEventId],
        paidAt: confirmation.paidAt,
        updatedAt: confirmation.paidAt,
      },
      current.etag,
    );
    await reconcilePaymentBooking(context, updated.document);
    return toPaymentView(updated.document);
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    const concurrent = await readOwnedPayment(context, id);
    if (concurrent.document.status !== "PAID") {
      throw paymentError(409, "The Payment changed. Refresh and retry.");
    }
    await reconcilePaymentBooking(context, concurrent.document);
    return toPaymentView(concurrent.document);
  }
}

export async function processStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<void> {
  const config = parseStripeConfig(process.env);
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret,
    );
  } catch {
    throw paymentError(400, "The Stripe webhook signature is invalid.");
  }
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ].includes(event.type)
  ) {
    return;
  }
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.metadata?.tenantId;
  const paymentId = session.metadata?.paymentId;
  if (
    !tenantId ||
    !paymentId ||
    !/^(deposit|balance)-[0-9a-f-]{36}$/i.test(paymentId)
  ) {
    throw paymentError(400, "The Stripe event metadata is invalid.");
  }
  const context: TenantContext = {
    tenantId,
    businessName: "Stripe webhook",
    username: "stripe-webhook",
    role: "company_admin",
  };
  const current = await readOwnedPayment(context, paymentId);
  try {
    validateStripeCheckoutEvent(
      current.document,
      event,
      session,
      config.mode,
    );
  } catch {
    throw paymentError(400, "The Stripe event does not match the Payment.");
  }
  if (current.document.processedProviderEventIds?.includes(event.id)) {
    await reconcilePaymentBooking(context, current.document);
    return;
  }
  const outcome = stripeEventOutcome(event, session);
  if (!outcome) return;
  const eventAt = new Date(event.created * 1000).toISOString();
  const status = resolveStripePaymentStatus(
    current.document.status,
    outcome,
  );
  const eventIds = [
    ...(current.document.processedProviderEventIds ?? []),
    event.id,
  ].slice(-20);
  try {
    const updated = await replacePaymentDocument(
      {
        ...current.document,
        status,
        providerEventId: event.id,
        processedProviderEventIds: eventIds,
        paidAt:
          current.document.paidAt ??
          (status === "PAID" ? eventAt : undefined),
        updatedAt: eventAt,
      },
      current.etag,
    );
    await reconcilePaymentBooking(context, updated.document);
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    const concurrent = await readOwnedPayment(context, paymentId);
    if (!concurrent.document.processedProviderEventIds?.includes(event.id)) {
      throw paymentError(409, "The Payment changed while processing Stripe.");
    }
    await reconcilePaymentBooking(context, concurrent.document);
  }
}
