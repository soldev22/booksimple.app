import { randomUUID } from "node:crypto";
import type { PaymentProviderAdapter } from "./payment-provider";

export const mockPaymentProvider: PaymentProviderAdapter = {
  provider: "MOCK_TEST",
  simulated: true,
  async createPaymentRequest(input) {
    return {
      externalPaymentId:
        input.existingExternalPaymentId ?? `mock_pay_${randomUUID()}`,
      checkoutAttempt: 0,
    };
  },
  confirmPayment(externalPaymentId, providerEventId) {
    if (
      !/^mock_pay_[0-9a-f-]{36}$/i.test(externalPaymentId) ||
      !/^[0-9a-f-]{36}$/i.test(providerEventId)
    ) {
      throw new Error("The simulated provider notification is invalid.");
    }
    return {
      providerEventId,
      paidAt: new Date().toISOString(),
    };
  },
};
