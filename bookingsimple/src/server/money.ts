export function currencyFractionDigits(currency: string): number | null {
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? null
    );
  } catch {
    return null;
  }
}

export function isCurrencyCode(currency: string): boolean {
  return currencyFractionDigits(currency) !== null;
}

export function parsePriceToMinor(price: string, currency: string): number {
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === null || !/^\d+(?:\.\d+)?$/.test(price)) {
    throw new Error("Price or currency is invalid.");
  }
  const [whole, fraction = ""] = price.split(".");
  if (fraction.length > fractionDigits) {
    throw new Error("Price has too many decimal places for its currency.");
  }
  const factor = 10 ** fractionDigits;
  const wholeAmount = Number(whole);
  const fractionAmount = Number(
    fraction.padEnd(fractionDigits, "0") || "0",
  );
  const minor = wholeAmount * factor + fractionAmount;
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Price exceeds the safe supported range.");
  }
  return minor;
}

export function formatMinorAmount(
  priceMinor: number,
  currency: string,
): string {
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === null || !Number.isSafeInteger(priceMinor)) {
    return `${priceMinor} ${currency}`;
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(priceMinor / 10 ** fractionDigits);
}

export function minorAmountToInput(
  priceMinor: number,
  currency: string,
): string {
  const fractionDigits = currencyFractionDigits(currency);
  if (
    fractionDigits === null ||
    !Number.isSafeInteger(priceMinor) ||
    priceMinor < 0
  ) {
    return String(priceMinor);
  }
  const factor = 10 ** fractionDigits;
  const whole = Math.floor(priceMinor / factor);
  if (fractionDigits === 0) return String(whole);
  return `${whole}.${String(priceMinor % factor).padStart(fractionDigits, "0")}`;
}
