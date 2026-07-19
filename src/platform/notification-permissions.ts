import { Capacitor } from "@capacitor/core"
import { LocalNotifications } from "@capacitor/local-notifications"

import {
  getScheduleStatus,
  openAutostartSettings,
  requestBatteryOptimizationExemption,
  type ScheduleStatus,
} from "@/platform/reminder-store"

export interface ReminderCapability {
  notification: "granted" | "denied" | "prompt" | "prompt-with-rationale"
  exactAlarm: "granted" | "denied" | "prompt" | "prompt-with-rationale"
  fullScreenIntent: boolean
  batteryOptimized: boolean
  nextAlarmAt: number
  scheduleEnabled: boolean
}

const webCapability: ReminderCapability = {
  notification: "granted",
  exactAlarm: "granted",
  fullScreenIntent: true,
  batteryOptimized: false,
  nextAlarmAt: 0,
  scheduleEnabled: false,
}

async function withSchedule(
  base: Omit<
    ReminderCapability,
    "batteryOptimized" | "fullScreenIntent" | "nextAlarmAt" | "scheduleEnabled"
  >,
): Promise<ReminderCapability> {
  let schedule: ScheduleStatus | null = null
  try {
    schedule = await getScheduleStatus()
  } catch {
    schedule = null
  }

  return {
    ...base,
    batteryOptimized: schedule ? !schedule.ignoringBatteryOptimizations : false,
    fullScreenIntent: schedule?.canUseFullScreenIntent ?? true,
    nextAlarmAt: schedule?.nextAlarmAt ?? 0,
    scheduleEnabled: schedule?.enabled ?? false,
  }
}

export async function getReminderCapability(): Promise<ReminderCapability> {
  if (Capacitor.getPlatform() !== "android") {
    return webCapability
  }

  const [notification, exactAlarm] = await Promise.all([
    LocalNotifications.checkPermissions(),
    LocalNotifications.checkExactNotificationSetting(),
  ])

  return withSchedule({
    notification: notification.display,
    exactAlarm: exactAlarm.exact_alarm,
  })
}

export async function requestReminderCapability(): Promise<ReminderCapability> {
  if (Capacitor.getPlatform() !== "android") {
    return webCapability
  }

  const notification = await LocalNotifications.requestPermissions()
  const exactAlarm = await LocalNotifications.checkExactNotificationSetting()

  return withSchedule({
    notification: notification.display,
    exactAlarm: exactAlarm.exact_alarm,
  })
}

export async function requestExactAlarmCapability(): Promise<ReminderCapability> {
  if (Capacitor.getPlatform() !== "android") {
    return webCapability
  }

  const exactAlarm = await LocalNotifications.changeExactNotificationSetting()
  const notification = await LocalNotifications.checkPermissions()

  return withSchedule({
    notification: notification.display,
    exactAlarm: exactAlarm.exact_alarm,
  })
}

export async function ensureBackgroundDelivery(): Promise<ReminderCapability> {
  if (Capacitor.getPlatform() !== "android") {
    return webCapability
  }

  const capability = await getReminderCapability()
  if (capability.batteryOptimized) {
    await requestBatteryOptimizationExemption()
  }
  return getReminderCapability()
}

export async function openVendorAutostartSettings() {
  return openAutostartSettings()
}

export function formatNextAlarm(nextAlarmAt: number, now = Date.now()): string | null {
  if (!nextAlarmAt || nextAlarmAt <= 0) {
    return null
  }

  const date = new Date(nextAlarmAt)
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  const sameDay =
    date.getFullYear() === new Date(now).getFullYear() &&
    date.getMonth() === new Date(now).getMonth() &&
    date.getDate() === new Date(now).getDate()

  if (sameDay) {
    return `今天 ${hh}:${mm}`
  }

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()

  if (isTomorrow) {
    return `明天 ${hh}:${mm}`
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`
}
