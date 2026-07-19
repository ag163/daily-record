import { describe, expect, it } from "vitest"

import {
  createEmptyState,
  getDayStatus,
  getMonthSummary,
  normalizeState,
  setDayStatus,
  startTracking,
  updateReminder,
  type DailyRecordState,
} from "./daily-record"

const atNoon = (day: number) => new Date(2026, 6, day, 12, 0, 0)

describe("daily record state", () => {
  it("derives empty, pending, missed, and future dates", () => {
    const today = atNoon(19)
    const state = startTracking(createEmptyState(), atNoon(17))

    expect(getDayStatus(state, atNoon(16), today)).toBe("empty")
    expect(getDayStatus(state, atNoon(18), today)).toBe("missed")
    expect(getDayStatus(state, today, today)).toBe("pending")
    expect(getDayStatus(state, atNoon(20), today)).toBe("future")
  })

  it("stores explicit taken and missed records", () => {
    const today = atNoon(19)
    let state = startTracking(createEmptyState(), atNoon(17))
    state = setDayStatus(state, atNoon(18), "taken", today)
    state = setDayStatus(state, today, "missed", today)

    expect(getDayStatus(state, atNoon(18), today)).toBe("taken")
    expect(getDayStatus(state, today, today)).toBe("missed")
  })

  it("allows explicit history before tracking started without filling blank days", () => {
    const today = atNoon(19)
    let state = startTracking(createEmptyState(), today)
    state = setDayStatus(state, atNoon(10), "taken", today)

    expect(getDayStatus(state, atNoon(10), today)).toBe("taken")
    expect(getDayStatus(state, atNoon(11), today)).toBe("empty")
  })

  it("calculates the current month from the tracking start through today", () => {
    const today = atNoon(19)
    let state = startTracking(createEmptyState(), atNoon(17))
    state = setDayStatus(state, atNoon(17), "taken", today)
    state = setDayStatus(state, atNoon(19), "taken", today)

    expect(getMonthSummary(state, today, today)).toEqual({
      taken: 2,
      elapsed: 3,
    })
  })

  it("includes backfilled history before trackingStartedOn in the month summary", () => {
    const today = atNoon(19)
    let state = startTracking(createEmptyState(), today)
    state = setDayStatus(state, atNoon(18), "taken", today)

    expect(getDayStatus(state, atNoon(18), today)).toBe("taken")
    expect(getMonthSummary(state, today, today)).toEqual({
      taken: 1,
      elapsed: 2,
    })
  })

  it("keeps month summary consistent with every calendar day status", () => {
    const today = atNoon(19)
    let state = startTracking(createEmptyState(), atNoon(15))
    state = setDayStatus(state, atNoon(15), "taken", today)
    state = setDayStatus(state, atNoon(16), "missed", today)
    state = setDayStatus(state, atNoon(18), "taken", today)

    const summary = getMonthSummary(state, today, today)
    let taken = 0
    let elapsed = 0

    for (let day = 1; day <= 19; day += 1) {
      const status = getDayStatus(state, atNoon(day), today)
      if (status === "empty" || status === "future") {
        continue
      }
      elapsed += 1
      if (status === "taken") {
        taken += 1
      }
    }

    expect(summary).toEqual({ taken, elapsed })
    expect(summary).toEqual({ taken: 2, elapsed: 5 })
  })

  it("clamps reminder intervals to five-minute steps", () => {
    const state = updateReminder(createEmptyState(), {
      enabled: true,
      time: "09:30",
      repeatMinutes: 127,
    })

    expect(state.reminder).toEqual({
      enabled: true,
      time: "09:30",
      repeatMinutes: 120,
    })
  })

  it("preserves non-default reminder times through normalizeState", () => {
    const state = normalizeState({
      version: 1,
      trackingStartedOn: "2026-07-19",
      records: {
        "2026-07-18": { status: "taken", updatedAt: "2026-07-18T12:00:00.000Z" },
      },
      reminder: {
        enabled: true,
        time: "21:30",
        repeatMinutes: 15,
      },
    })

    expect(state.reminder.time).toBe("21:30")
    expect(state.reminder.enabled).toBe(true)
    expect(state.reminder.repeatMinutes).toBe(15)
    expect(state.records["2026-07-18"]?.status).toBe("taken")
  })

  it("accepts unpadded and second-bearing reminder times without falling back to 08:00", () => {
    expect(normalizeState({ reminder: { time: "9:05", enabled: true, repeatMinutes: 10 } }).reminder.time).toBe("09:05")
    expect(normalizeState({ reminder: { time: "21:30:00", enabled: true, repeatMinutes: 10 } }).reminder.time).toBe("21:30")
    expect(normalizeState({ reminder: { time: "7:5", enabled: true, repeatMinutes: 10 } }).reminder.time).toBe("08:00")
  })

  it("drops invalid record entries instead of treating them as data", () => {
    const state = normalizeState({
      trackingStartedOn: "2026-07-19",
      records: {
        "2026-07-18": { status: "taken", updatedAt: "2026-07-18T12:00:00.000Z" },
        "2026-07-17": { status: "weird", updatedAt: "x" },
        "bad-key": { status: "taken", updatedAt: "x" },
        "2026-07-16": "taken",
      },
      reminder: { enabled: false, time: "10:00", repeatMinutes: 10 },
    })

    expect(Object.keys(state.records).sort()).toEqual(["2026-07-18"])
    expect(state.records["2026-07-18"]?.status).toBe("taken")
  })

  it("keeps records when reminder is updated (stale-state recipe shape)", () => {
    const today = atNoon(19)
    let state = startTracking(createEmptyState(), atNoon(18))
    state = setDayStatus(state, atNoon(18), "taken", today)

    // Simulates the correct update recipe: load latest, then apply reminder only.
    const latest: DailyRecordState = state
    const next = updateReminder(latest, {
      enabled: true,
      time: "21:15",
      repeatMinutes: 10,
    })

    expect(next.records["2026-07-18"]?.status).toBe("taken")
    expect(next.reminder.time).toBe("21:15")
    expect(getMonthSummary(next, today, today)).toEqual({ taken: 1, elapsed: 2 })
  })
})
