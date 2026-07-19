import {
  differenceInCalendarDays,
  endOfMonth,
  isAfter,
  isBefore,
  startOfMonth,
} from "date-fns"

export type StoredDayStatus = "taken" | "missed"
export type DayStatus = StoredDayStatus | "pending" | "empty" | "future"

export interface DayRecord {
  status: StoredDayStatus
  updatedAt: string
}

export interface ReminderSettings {
  enabled: boolean
  time: string
  repeatMinutes: number
}

export interface DailyRecordState {
  version: 1
  trackingStartedOn: string | null
  records: Record<string, DayRecord>
  reminder: ReminderSettings
}

export const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  time: "08:00",
  repeatMinutes: 10,
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function createEmptyState(): DailyRecordState {
  return {
    version: 1,
    trackingStartedOn: null,
    records: {},
    reminder: { ...DEFAULT_REMINDER },
  }
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function normalizeReminderTime(value: unknown): string {
  const raw = String(value ?? "").trim()
  const match = raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/)
  if (!match) {
    return DEFAULT_REMINDER.time
  }

  const hour = Number(match[1])
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return DEFAULT_REMINDER.time
  }

  return `${String(hour).padStart(2, "0")}:${match[2]}`
}

function normalizeRecords(value: unknown): Record<string, DayRecord> {
  if (!value || typeof value !== "object") {
    return {}
  }

  const records: Record<string, DayRecord> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!DATE_KEY_PATTERN.test(key) || !entry || typeof entry !== "object") {
      continue
    }

    const record = entry as Partial<DayRecord>
    if (record.status !== "taken" && record.status !== "missed") {
      continue
    }

    records[key] = {
      status: record.status,
      updatedAt:
        typeof record.updatedAt === "string" && record.updatedAt.length > 0
          ? record.updatedAt
          : new Date(0).toISOString(),
    }
  }

  return records
}

function normalizeRepeatMinutes(value: unknown): number {
  const repeatMinutes = Number(value)
  if (!Number.isFinite(repeatMinutes)) {
    return DEFAULT_REMINDER.repeatMinutes
  }

  return Math.min(120, Math.max(5, Math.round(repeatMinutes / 5) * 5))
}

export function normalizeState(value: unknown): DailyRecordState {
  if (!value || typeof value !== "object") {
    return createEmptyState()
  }

  const source = value as Partial<DailyRecordState>
  const reminder = source.reminder ?? DEFAULT_REMINDER
  const trackingStartedOn =
    typeof source.trackingStartedOn === "string" &&
    DATE_KEY_PATTERN.test(source.trackingStartedOn)
      ? source.trackingStartedOn
      : null

  return {
    version: 1,
    trackingStartedOn,
    records: normalizeRecords(source.records),
    reminder: {
      enabled: Boolean(reminder.enabled),
      time: normalizeReminderTime(reminder.time),
      repeatMinutes: normalizeRepeatMinutes(reminder.repeatMinutes),
    },
  }
}

export function startTracking(
  state: DailyRecordState,
  date = new Date(),
): DailyRecordState {
  if (state.trackingStartedOn) {
    return state
  }

  return {
    ...state,
    trackingStartedOn: formatDateKey(date),
  }
}

export function getDayStatus(
  state: DailyRecordState,
  date: Date,
  today = new Date(),
): DayStatus {
  const dateKey = formatDateKey(date)
  const todayKey = formatDateKey(today)

  if (dateKey > todayKey) {
    return "future"
  }

  const storedStatus = state.records[dateKey]?.status
  if (storedStatus === "taken" || storedStatus === "missed") {
    return storedStatus
  }

  if (!state.trackingStartedOn || dateKey < state.trackingStartedOn) {
    return "empty"
  }

  return dateKey === todayKey ? "pending" : "missed"
}

export function setDayStatus(
  state: DailyRecordState,
  date: Date,
  status: StoredDayStatus,
  updatedAt = new Date(),
): DailyRecordState {
  return {
    ...state,
    records: {
      ...state.records,
      [formatDateKey(date)]: {
        status,
        updatedAt: updatedAt.toISOString(),
      },
    },
  }
}

export function updateReminder(
  state: DailyRecordState,
  reminder: ReminderSettings,
): DailyRecordState {
  return {
    ...state,
    reminder: {
      enabled: Boolean(reminder.enabled),
      time: normalizeReminderTime(reminder.time),
      repeatMinutes: normalizeRepeatMinutes(reminder.repeatMinutes),
    },
  }
}

export function getMonthSummary(
  state: DailyRecordState,
  month: Date,
  today = new Date(),
): { taken: number; elapsed: number } {
  if (!state.trackingStartedOn) {
    return { taken: 0, elapsed: 0 }
  }

  const first = startOfMonth(month)
  const last = endOfMonth(month)

  // Future months never contribute. Past/current months count every day that
  // the calendar itself treats as meaningful (taken / missed / pending),
  // including backfilled history before trackingStartedOn.
  if (isAfter(first, today)) {
    return { taken: 0, elapsed: 0 }
  }

  const rangeEnd = isBefore(today, last) ? today : last
  const dayCount = differenceInCalendarDays(rangeEnd, first) + 1
  let taken = 0
  let elapsed = 0

  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() + offset,
    )
    const status = getDayStatus(state, date, today)

    if (status === "empty" || status === "future") {
      continue
    }

    elapsed += 1
    if (status === "taken") {
      taken += 1
    }
  }

  return { taken, elapsed }
}

