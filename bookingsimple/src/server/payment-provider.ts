import type { TenantContext } from "./auth-types";
import type { PaymentProvider, PaymentType } from "./payment-types";

export type ProviderPaymentRequest = {
  externalPaymentId: string;
  checkoutUrl?: string;
  checkoutAttempt: number;
};

export type ProviderPaymentConfirmation = {
  providerEventId: string;
  paidAt: string;
};

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  readonly simulated: boolean;
  createPaymentRequest(input: {
    context: TenantContext;
    paymentId: string;
    bookingId: string;
    paymentType: PaymentType;
    amountMinor: number;
    currency: string;
    serviceName: string;
    existingExternalPaymentId?: string;
    checkoutAttempt: number;
  }): Promise<ProviderPaymentRequest>;
  confirmPayment?(
    externalPaymentId: string,
    providerEventId: string,
  ): ProviderPaymentConfirmation;
}
