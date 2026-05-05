export function formatLocalTimeOfDay(value: string | undefined, locale = undefined as string | undefined): string {
  if (!value) return "";

  const bareTimeMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (bareTimeMatch) {
    const hour = Number(bareTimeMatch[1]);
    const minute = Number(bareTimeMatch[2]);
    if (hour <= 23 && minute <= 59) return `${String(hour).padStart(2, "0")}:${bareTimeMatch[2]}`;
    return value;
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTimeEntryWindow(input: { startAt?: string; endAt?: string }, locale?: string): string {
  if (!input.startAt || !input.endAt) return "";
  return `${formatLocalTimeOfDay(input.startAt, locale)}-${formatLocalTimeOfDay(input.endAt, locale)}`;
}
