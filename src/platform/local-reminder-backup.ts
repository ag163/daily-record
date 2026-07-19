import { Capacitor } from "@capacitor/core"
import { LocalNotifications } from "@capacitor/local-notifications"

import type { DailyRecordState } from "@/domain/daily-record"
import { formatDateKey, getDayStatus } from "@/domain/daily-record"

const BACKUP_MAIN_ID = 7101
const BACKUP_IDS = Array.from({ length: 24 }, (_, index) => 7200 + index)
const BACKUP_CHANNEL_ID = "daily_record_backup_vibration_v2"
const LEGACY_SOUND_CHANNEL_ID = "daily_record_backup_notifications"

function nextTriggerDates(state: DailyRecordState, from = new Date()): Date[] {
  if (!state.reminder.enabled || !state.trackingStartedOn) {
    return []
  }

  const [hourText, minuteText] = state.reminder.time.split(":")
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return []
  }

  const triggers: Date[] = []
  const cursor = new Date(from)

  // Schedule today (if still pending and time remains) plus next 2 days.
  for (let dayOffset = 0; dayOffset < 3 && triggers.length < 3; dayOffset += 1) {
    const day = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + dayOffset,
      hour,
      minute,
      0,
      0,
    )
    const status = getDayStatus(state, day, from)
    if (status === "taken" || status === "missed") {
      continue
    }
    if (day.getTime() <= from.getTime() + 2_000) {
      continue
    }
    triggers.push(day)
  }

  // If today's main already passed and still pending, also queue interval backups
  // until midnight (capped) so something still fires when AlarmManager is flaky.
  const todayStatus = getDayStatus(state, from, from)
  if (todayStatus === "pending") {
    const todayMain = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      hour,
      minute,
      0,
      0,
    )
    if (from.getTime() >= todayMain.getTime()) {
      const intervalMs = Math.max(5, state.reminder.repeatMinutes) * 60_000
      let next = new Date(from.getTime() + intervalMs)
      const midnight = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate() + 1,
        0,
        0,
        0,
        0,
      )
      let guard = 0
      while (next < midnight && guard < BACKUP_IDS.length) {
        triggers.push(new Date(next))
        next = new Date(next.getTime() + intervalMs)
        guard += 1
      }
    }
  }

  return triggers
}

export async function ensureLocalNotificationChannel() {
  if (Capacitor.getPlatform() !== "android") {
    return
  }

  await LocalNotifications.deleteChannel({ id: LEGACY_SOUND_CHANNEL_ID }).catch(
    () => undefined,
  )
  await LocalNotifications.createChannel({
    id: BACKUP_CHANNEL_ID,
    name: "备用震动提醒",
    description: "系统定时提醒之外的备用震动通知",
    importance: 5,
    visibility: 1,
    vibration: true,
  })
}

export async function cancelLocalReminderBackup() {
  if (Capacitor.getPlatform() !== "android") {
    return
  }

  const ids = [BACKUP_MAIN_ID, ...BACKUP_IDS].map((id) => ({ id }))
  try {
    await LocalNotifications.cancel({ notifications: ids })
  } catch {
    // ignore
  }
}

export async function syncLocalReminderBackup(state: DailyRecordState) {
  if (Capacitor.getPlatform() !== "android") {
    return
  }

  await ensureLocalNotificationChannel()
  await cancelLocalReminderBackup()

  if (!state.reminder.enabled || !state.trackingStartedOn) {
    return
  }

  const permission = await LocalNotifications.checkPermissions()
  if (permission.display !== "granted") {
    return
  }

  const triggers = nextTriggerDates(state)
  if (triggers.length === 0) {
    return
  }

  const notifications = triggers.map((at, index) => ({
    id: index === 0 ? BACKUP_MAIN_ID : BACKUP_IDS[index - 1],
    title: "今天的事项待确认",
    body: index === 0 ? "点击完成今日记录" : "今天的事项仍待确认",
    schedule: {
      at,
      allowWhileIdle: true,
    },
    channelId: BACKUP_CHANNEL_ID,
    extra: {
      dateKey: formatDateKey(at),
      source: "local-backup",
    },
  }))

  await LocalNotifications.schedule({ notifications })
}

export async function scheduleLocalTestInSeconds(seconds = 60) {
  if (Capacitor.getPlatform() !== "android") {
    return null
  }

  await ensureLocalNotificationChannel()
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== "granted") {
    throw new Error("通知权限未开启")
  }

  const at = new Date(Date.now() + Math.max(5, seconds) * 1000)
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 7999,
        title: "测试提醒",
        body: `${seconds} 秒后震动：如果看到这条，通知通道正常`,
        schedule: {
          at,
          allowWhileIdle: true,
        },
        channelId: BACKUP_CHANNEL_ID,
      },
    ],
  })
  return at.getTime()
}
