/**
 * Shared West Africa Time (WAT) display formatters and token humanising
 * helpers.
 *
 * Every consumer passes its own fallback copy (empty/invalid strings and the
 * optional " WAT" suffix) so rendered output stays byte-identical with the
 * previously duplicated local helpers — drifting fallback strings are
 * deliberately preserved at each call site, not unified here.
 */

const WAT_TIME_ZONE = "Africa/Lagos";

const watDateTimeFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: WAT_TIME_ZONE,
});

const watDateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeZone: WAT_TIME_ZONE,
});

const watDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: WAT_TIME_ZONE,
});

export interface FormatWatInstantOptions {
  /** Returned when the value is null, undefined or empty. Default: "". */
  empty?: string;
  /**
   * Returned when the value cannot be parsed as a date. Default: the raw
   * string value itself (the prevalent behaviour of the local copies).
   */
  invalid?: string;
  /** Include the short time alongside the medium date. Default: true. */
  withTime?: boolean;
  /** Appended verbatim after the formatted instant (e.g. " WAT"). Default: "". */
  suffix?: string;
}

export function formatWatInstant(
  value: string | Date | null | undefined,
  options: FormatWatInstantOptions = {},
): string {
  const { empty = "", invalid, withTime = true, suffix = "" } = options;
  if (!value) return empty;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalid ?? (typeof value === "string" ? value : empty);
  }
  const formatter = withTime ? watDateTimeFormatter : watDateFormatter;
  return `${formatter.format(parsed)}${suffix}`;
}

export function watDateParts(value = new Date()): string {
  const parts = watDatePartsFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

export function humaniseToken(value: string): string {
  return value.replaceAll("_", " ");
}

export function humaniseTokenCapitalised(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}
