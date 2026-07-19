import { registerPlugin, WebPlugin } from "@capacitor/core"

import {
  createEmptyState,
  normalizeState,
  type DailyRecordState,
} from "@/domain/daily-record"

const STORAGE_KEY = "daily-record-state"

interface LoadStateResult {
  value: string | null
}

interface SaveStateOptions {
  value: string
}

export interface ScheduleStatus {
  enabled: boolean
  resolvedToday: boolean
  nextAlarmAt: number
  nextAlarmAction: string
  hasExactAlarmPermission: boolean
  canUseFullScreenIntent: boolean
  ignoringBatteryOptimizations: boolean
  now: number
  reminderTime: string
}

interface ReminderStorePlugin {
  loadState(): Promise<LoadStateResult>
  saveState(options: SaveStateOptions): Promise<ScheduleStatus | void>
  syncReminders(): Promise<ScheduleStatus | void>
  getScheduleStatus(): Promise<ScheduleStatus>
  fireTestNotification(): Promise<{ ok: boolean }>
  scheduleTestInSeconds(options: { seconds: number }): Promise<{
    ok: boolean
    nextAlarmAt: number
  }>
  requestBatteryOptimizationExemption(): Promise<{
    ignoringBatteryOptimizations: boolean
    opened?: boolean
    fallback?: boolean
  }>
  openAutostartSettings(): Promise<{
    opened: boolean
    vendor?: string
    fallback?: string
  }>
  requestFullScreenIntentPermission(): Promise<{
    allowed: boolean
    opened?: boolean
  }>
}

class ReminderStoreWeb extends WebPlugin implements ReminderStorePlugin {
  async loadState(): Promise<LoadStateResult> {
    return { value: window.localStorage.getItem(STORAGE_KEY) }
  }

  async saveState({ value }: SaveStateOptions): Promise<ScheduleStatus> {
    window.localStorage.setItem(STORAGE_KEY, value)
    return this.getScheduleStatus()
  }

  async syncReminders(): Promise<ScheduleStatus> {
    return this.getScheduleStatus()
  }

  async getScheduleStatus(): Promise<ScheduleStatus> {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const state = raw ? normalizeState(JSON.parse(raw)) : createEmptyState()
    return {
      enabled: Boolean(state.reminder.enabled && state.trackingStartedOn),
      resolvedToday: false,
      nextAlarmAt: 0,
      nextAlarmAction: "",
      hasExactAlarmPermission: true,
      canUseFullScreenIntent: true,
      ignoringBatteryOptimizations: true,
      now: Date.now(),
      reminderTime: state.reminder.time,
    }
  }

  async fireTestNotification() {
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        await Notification.requestPermission()
      }
      if (Notification.permission === "granted") {
        new Notification("今天的事项待确认", { body: "测试通知（网页）" })
      }
    }
    return { ok: true }
  }

  async scheduleTestInSeconds({ seconds }: { seconds: number }) {
    const nextAlarmAt = Date.now() + Math.max(5, seconds) * 1000
    window.setTimeout(() => {
      void this.fireTestNotification()
    }, Math.max(5, seconds) * 1000)
    return { ok: true, nextAlarmAt }
  }

  async requestBatteryOptimizationExemption() {
    return { ignoringBatteryOptimizations: true, opened: false }
  }

  async openAutostartSettings() {
    return { opened: false }
  }

  async requestFullScreenIntentPermission() {
    return { allowed: true, opened: false }
  }
}

const ReminderStore = registerPlugin<ReminderStorePlugin>("ReminderStore", {
  web: () => Promise.resolve(new ReminderStoreWeb()),
})

export async function loadDailyRecordState(): Promise<DailyRecordState> {
  const { value } = await ReminderStore.loadState()
  if (!value) {
    return createEmptyState()
  }

  try {
    return normalizeState(JSON.parse(value))
  } catch {
    return createEmptyState()
  }
}

export async function saveDailyRecordState(
  state: DailyRecordState,
): Promise<void> {
  await ReminderStore.saveState({ value: JSON.stringify(state) })
}

export async function syncNativeReminders(): Promise<ScheduleStatus | void> {
  return ReminderStore.syncReminders()
}

export async function getScheduleStatus(): Promise<ScheduleStatus> {
  return ReminderStore.getScheduleStatus()
}

export async function fireTestNotification() {
  return ReminderStore.fireTestNotification()
}

export async function scheduleTestInSeconds(seconds = 60) {
  return ReminderStore.scheduleTestInSeconds({ seconds })
}

export async function requestBatteryOptimizationExemption() {
  return ReminderStore.requestBatteryOptimizationExemption()
}

export async function openAutostartSettings() {
  return ReminderStore.openAutostartSettings()
}

export async function requestFullScreenIntentPermission() {
  return ReminderStore.requestFullScreenIntentPermission()
}
