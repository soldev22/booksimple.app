type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function partsInTimeZone(timestamp: number, timeZone: string): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function sameParts(left: DateTimeParts, right: DateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function offsetAt(timestamp: number, timeZone: string): number {
  const rounded = Math.floor(timestamp / 60_000) * 60_000;
  const parts = partsInTimeZone(rounded, timeZone);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    ) - rounded
  );
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function localDateTimeToUtc(
  localDateTime: string,
  timeZone: string,
): string {
  if (!isTimeZone(timeZone)) {
    throw new Error("The business timezone is invalid.");
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) {
    throw new Error("Booking time must include a local date and time.");
  }
  const expected: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const localAsUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  );
  const normalized = new Date(localAsUtc);
  if (
    normalized.getUTCFullYear() !== expected.year ||
    normalized.getUTCMonth() + 1 !== expected.month ||
    normalized.getUTCDate() !== expected.day ||
    normalized.getUTCHours() !== expected.hour ||
    normalized.getUTCMinutes() !== expected.minute
  ) {
    throw new Error("Booking time is not a valid calendar date.");
  }

  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(offsetAt(localAsUtc + hours * 3_600_000, timeZone));
  }
  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((candidate) =>
      sameParts(partsInTimeZone(candidate, timeZone), expected),
    );
  if (candidates.length === 0) {
    throw new Error(
      "Booking time does not exist in the business timezone because of a clock change.",
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      "Booking time is ambiguous in the business timezone because of a clock change.",
    );
  }
  return new Date(candidates[0]).toISOString();
}

export function utcToLocalDateTime(isoDate: string, timeZone: string): string {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp) || !isTimeZone(timeZone)) {
    throw new Error("Booking time or timezone is invalid.");
  }
  const parts = partsInTimeZone(timestamp, timeZone);
  return [
    String(parts.year).padStart(4, "0"),
    "-",
    String(parts.month).padStart(2, "0"),
    "-",
    String(parts.day).padStart(2, "0"),
    "T",
    String(parts.hour).padStart(2, "0"),
    ":",
    String(parts.minute).padStart(2, "0"),
  ].join("");
}
