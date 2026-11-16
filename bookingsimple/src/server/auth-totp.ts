import { TOTP } from "otpauth";
import { isFreshTotpStep } from "./auth-policy";

export function createTotp(secret: string, email: string): TOTP {
  return new TOTP({
    issuer: "BookSimple",
    label: email,
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

export function acceptedTotpStep(
  totp: TOTP,
  code: string,
  lastStep: number,
  now = Date.now(),
): number | null {
  const delta = totp.validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) {
    return null;
  }
  const currentStep = TOTP.counter({ timestamp: now, period: 30 });
  const acceptedStep = currentStep + delta;
  return isFreshTotpStep(acceptedStep, lastStep) ? acceptedStep : null;
}
