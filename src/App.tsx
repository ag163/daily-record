import { App as CapacitorApp } from "@capacitor/app"
import { startOfMonth } from "date-fns"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { BellOff, CircleCheckBig, PencilLine, Settings } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { MonthCalendar } from "@/components/month-calendar"
import { Onboarding } from "@/components/onboarding"
import { ReminderSettingsForm } from "@/components/reminder-form"
import { StatusMark } from "@/components/status-mark"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  getDayStatus,
  getMonthSummary,
  normalizeReminderTime,
  setDayStatus,
  startTracking,
  updateReminder,
  type DayStatus,
  type ReminderSettings,
} from "@/domain/daily-record"
import { useDailyRecord } from "@/hooks/use-daily-record"
import {
  ensureBackgroundDelivery,
  getReminderCapability,
  requestExactAlarmCapability,
  requestReminderCapability,
  type ReminderCapability,
} from "@/platform/notification-permissions"

function App() {
  const { state, isLoading, error, reload, update } = useDailyRecord()
  const [now, setNow] = useState(() => new Date())
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [revertDate, setRevertDate] = useState<Date | null>(null)
  const [capability, setCapability] = useState<ReminderCapability | null>(null)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => document.documentElement.classList.toggle("dark", media.matches)
    applyTheme()
    media.addEventListener("change", applyTheme)

    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => {
      media.removeEventListener("change", applyTheme)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    void getReminderCapability().then(setCapability).catch(() => setCapability(null))
  }, [settingsOpen])

  useEffect(() => {
    const listener = CapacitorApp.addListener("backButton", () => {
      const hasOpenOverlay = document.querySelector(
        [
          '[data-slot="select-content"][data-state="open"]',
          '[data-slot="dialog-content"][data-state="open"]',
          '[data-slot="sheet-content"][data-state="open"]',
        ].join(","),
      )

      if (hasOpenOverlay) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
        return
      }

      void CapacitorApp.exitApp()
    })

    return () => {
      void listener.then((handle) => handle.remove())
    }
  }, [])

  const todayStatus = getDayStatus(state, now, now)
  const summary = useMemo(
    () => getMonthSummary(state, visibleMonth, now),
    [now, state, visibleMonth],
  )

  const persistStatus = async (date: Date, status: "taken" | "missed") => {
    await update((current) => setDayStatus(current, date, status))
  }

  const handleDayClick = (date: Date, status: DayStatus) => {
    if (status === "taken") {
      setRevertDate(date)
      return
    }

    if (status === "empty" || status === "pending" || status === "missed") {
      void persistStatus(date, "taken")
    }
  }

  const saveReminder = async (reminder: ReminderSettings) => {
    let nextReminder: ReminderSettings = {
      ...reminder,
      time: normalizeReminderTime(reminder.time),
    }

    let nextCapability: ReminderCapability | null = capability
    if (nextReminder.enabled) {
      nextCapability = await requestReminderCapability()
      setCapability(nextCapability)
      if (nextCapability.notification !== "granted") {
        nextReminder = { ...nextReminder, enabled: false }
      }
    }

    await update((current) => updateReminder(current, nextReminder))

    if (nextReminder.enabled && nextCapability?.exactAlarm !== "granted") {
      nextCapability = await requestExactAlarmCapability()
      setCapability(nextCapability)
    }

    if (nextReminder.enabled) {
      nextCapability = await ensureBackgroundDelivery()
      setCapability(nextCapability)
    }

    // Always re-read from native storage so the UI matches the committed value
    // and native alarms are rescheduled against the saved state.
    await reload()
    setCapability(await getReminderCapability().catch(() => nextCapability))
    setSettingsOpen(false)
  }

  if (isLoading) {
    return (
      <main className="app-shell grid min-h-dvh place-items-center">
        <p className="text-sm text-muted-foreground">正在读取本地记录</p>
      </main>
    )
  }

  if (!state.trackingStartedOn) {
    return (
      <Onboarding
        onComplete={async (reminder) => {
          let nextReminder: ReminderSettings = {
            ...reminder,
            time: normalizeReminderTime(reminder.time),
          }
          let nextCapability: ReminderCapability | null = capability
          if (nextReminder.enabled) {
            nextCapability = await requestReminderCapability()
            setCapability(nextCapability)
            if (nextCapability.notification !== "granted") {
              nextReminder = { ...nextReminder, enabled: false }
            }
          }

          await update((current) =>
            updateReminder(startTracking(current, now), nextReminder),
          )
          if (
            nextReminder.enabled &&
            nextCapability?.exactAlarm !== "granted"
          ) {
            setCapability(await requestExactAlarmCapability())
          }
          if (nextReminder.enabled) {
            setCapability(await ensureBackgroundDelivery())
          }
          await reload()
          setCapability(await getReminderCapability().catch(() => null))
        }}
      />
    )
  }

  const todayHeading =
    todayStatus === "taken"
      ? "今天已完成"
      : todayStatus === "missed"
        ? "今天记录为未完成"
        : "今天待确认"

  return (
    <main className="app-shell min-h-dvh">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">每日记录</h1>

        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetTrigger asChild>
            <Button
              aria-label="打开设置"
              className="size-11 text-foreground"
              size="icon"
              variant="outline"
            >
              <Settings aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>提醒设置</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-safe pt-6">
              <ReminderSettingsForm
                capability={capability}
                onSave={saveReminder}
                value={state.reminder}
              />
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <section className="today-section grid gap-4 py-6" aria-labelledby="today-heading">
        <div className="flex items-center justify-between gap-5">
          <div className="grid min-w-0 gap-1.5">
            <p className="text-sm font-medium text-muted-foreground">
              {format(now, "M月d日 EEEE", { locale: zhCN })}
            </p>
            <h2 className="text-xl font-bold" id="today-heading">
              {todayHeading}
            </h2>
          </div>
          <StatusMark size="lg" status={todayStatus} />
        </div>

        <div className="grid gap-2">
          <Button
            className="h-14 w-full text-base"
            onClick={() => handleDayClick(now, todayStatus)}
            variant={todayStatus === "taken" ? "outline" : "default"}
          >
            {todayStatus === "taken" ? (
              <PencilLine aria-hidden="true" />
            ) : (
              <CircleCheckBig aria-hidden="true" />
            )}
            {todayStatus === "taken" ? "修改今日记录" : "标记为已完成"}
          </Button>
          {todayStatus === "pending" ? (
            <Button
              className="h-12 w-full text-foreground"
              onClick={() => void persistStatus(now, "missed")}
              variant="outline"
            >
              <BellOff aria-hidden="true" />
              今天不再提醒
            </Button>
          ) : null}
        </div>
      </section>

      <Separator />

      <section className="grid gap-4 py-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold">本月记录</h2>
          <p className="text-sm tabular-nums text-muted-foreground">
            已完成 {summary.taken} 天 / 已经过 {summary.elapsed} 天
          </p>
        </div>
        <MonthCalendar
          month={visibleMonth}
          onDayClick={handleDayClick}
          onMonthChange={setVisibleMonth}
          state={state}
          today={now}
        />
      </section>

      {error ? (
        <p className="mb-safe rounded-md bg-status-missed-soft px-3 py-2 text-sm text-status-missed" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={Boolean(revertDate)} onOpenChange={(open) => !open && setRevertDate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>改为未完成？</DialogTitle>
            <DialogDescription>
              这会撤销 {revertDate ? format(revertDate, "M月d日") : "该日期"} 的已完成记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button className="h-11" variant="outline">保留已完成记录</Button>
            </DialogClose>
            <Button
              className="h-11"
              onClick={() => {
                if (revertDate) {
                  void persistStatus(revertDate, "missed")
                }
                setRevertDate(null)
              }}
              variant="destructive"
            >
              改为未完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export default App

