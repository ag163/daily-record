import { useEffect, useRef, useState } from "react"
import { BellRing, ChevronRight, Clock3, Minus, Plus, Shield, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { ReminderSettings } from "@/domain/daily-record"
import {
  formatNextAlarm,
  openVendorAutostartSettings,
  type ReminderCapability,
} from "@/platform/notification-permissions"
import {
  fireTestNotification,
  requestBatteryOptimizationExemption,
  requestFullScreenIntentPermission,
  scheduleTestInSeconds,
} from "@/platform/reminder-store"

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"))
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"))

interface TimePickerProps {
  value: string
  onChange: (value: string) => void
}

interface TimeWheelProps {
  id: string
  label: string
  values: string[]
  value: string
  active: boolean
  onChange: (value: string) => void
}

const TIME_ITEM_HEIGHT = 44
const TIME_VISIBLE_COUNT = 5

function TimeWheel({
  id,
  label,
  values,
  value,
  active,
  onChange,
}: TimeWheelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const suppressScrollSync = useRef(false)
  const scrollEndTimer = useRef<number | null>(null)

  const indexFromScroll = (list: HTMLDivElement) => {
    const raw = Math.round(list.scrollTop / TIME_ITEM_HEIGHT)
    return Math.max(0, Math.min(values.length - 1, raw))
  }

  const scrollToValue = (next: string, behavior: ScrollBehavior = "auto") => {
    const list = listRef.current
    if (!list) {
      return
    }

    const index = values.indexOf(next)
    if (index < 0) {
      return
    }

    suppressScrollSync.current = true
    list.scrollTo({
      top: index * TIME_ITEM_HEIGHT,
      behavior,
    })
    window.setTimeout(() => {
      suppressScrollSync.current = false
    }, behavior === "smooth" ? 220 : 0)
  }

  const syncFromScroll = () => {
    const list = listRef.current
    if (!list || suppressScrollSync.current) {
      return
    }

    const next = values[indexFromScroll(list)]
    if (next && next !== value) {
      onChange(next)
    }
  }

  useEffect(() => {
    if (!active) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToValue(value, "auto")
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    if (!active) {
      return
    }

    const list = listRef.current
    if (!list) {
      return
    }

    const currentIndex = indexFromScroll(list)
    const targetIndex = values.indexOf(value)
    if (targetIndex >= 0 && currentIndex !== targetIndex && !suppressScrollSync.current) {
      scrollToValue(value, "auto")
    }
  }, [active, value, values])

  useEffect(() => {
    return () => {
      if (scrollEndTimer.current !== null) {
        window.clearTimeout(scrollEndTimer.current)
      }
    }
  }, [])

  return (
    <div className="grid gap-2">
      <Label className="text-center" htmlFor={id}>
        {label}
      </Label>
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-11 -translate-y-1/2 rounded-md bg-accent/80 ring-1 ring-border"
        />
        <div
          aria-label={label}
          className="snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-lg border border-input bg-background shadow-inner"
          id={id}
          onScroll={() => {
            if (scrollEndTimer.current !== null) {
              window.clearTimeout(scrollEndTimer.current)
            }
            scrollEndTimer.current = window.setTimeout(() => {
              syncFromScroll()
            }, 80)
          }}
          ref={listRef}
          role="listbox"
          style={{
            height: TIME_ITEM_HEIGHT * TIME_VISIBLE_COUNT,
            paddingTop: TIME_ITEM_HEIGHT * 2,
            paddingBottom: TIME_ITEM_HEIGHT * 2,
          }}
        >
          {values.map((item) => {
            const selected = item === value

            return (
              <button
                aria-selected={selected}
                className={cn(
                  "relative z-20 flex w-full snap-center items-center justify-center text-base font-medium tabular-nums transition-colors",
                  selected
                    ? "text-xl font-bold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={item}
                onClick={() => {
                  onChange(item)
                  scrollToValue(item, "smooth")
                }}
                role="option"
                style={{ height: TIME_ITEM_HEIGHT }}
                type="button"
              >
                {item}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TimePicker({ value, onChange }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [hour, minute] = value.split(":")
  const [draftHour, setDraftHour] = useState(hour)
  const [draftMinute, setDraftMinute] = useState(minute)

  useEffect(() => {
    if (!open) {
      setDraftHour(hour)
      setDraftMinute(minute)
    }
  }, [hour, minute, open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          aria-label={`提醒时间，当前 ${value}`}
          className="h-12 w-full justify-start gap-3 px-3 text-base"
          id="reminder-time"
          type="button"
          variant="outline"
        >
          <Clock3 aria-hidden="true" className="text-muted-foreground" />
          <span className="tabular-nums">{value}</span>
          <ChevronRight aria-hidden="true" className="ml-auto text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>选择提醒时间</DialogTitle>
          <DialogDescription>按小时和分钟设置每天的固定提醒。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 py-2">
          <TimeWheel
            active={open}
            id="reminder-hour"
            label="小时"
            onChange={setDraftHour}
            value={draftHour}
            values={hours}
          />
          <span
            aria-hidden="true"
            className="pb-8 text-lg font-bold text-muted-foreground"
          >
            :
          </span>
          <TimeWheel
            active={open}
            id="reminder-minute"
            label="分钟"
            onChange={setDraftMinute}
            value={draftMinute}
            values={minutes}
          />
        </div>
        <DialogFooter className="grid grid-cols-2">
          <DialogClose asChild>
            <Button className="h-11" type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            className="h-11"
            onClick={() => {
              onChange(`${draftHour}:${draftMinute}`)
              setOpen(false)
            }}
            type="button"
          >
            确定时间
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ReminderFieldsProps {
  value: ReminderSettings
  showEnabled?: boolean
  onChange: (value: ReminderSettings) => void
}

export function ReminderFields({
  value,
  showEnabled = false,
  onChange,
}: ReminderFieldsProps) {
  return (
    <div className="grid gap-5">
      {showEnabled ? (
        <div className="flex min-h-12 items-center justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="reminder-enabled">每日提醒</Label>
            <p className="text-sm text-muted-foreground">
              关闭后持续暂停，直到手动恢复。
            </p>
          </div>
          <Switch
            checked={value.enabled}
            id="reminder-enabled"
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          />
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="reminder-time">提醒时间</Label>
        <TimePicker
          onChange={(time) => onChange({ ...value, time })}
          value={value.time}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="repeat-interval">重复间隔</Label>
        <div
          className="grid h-12 grid-cols-[3rem_1fr_3rem] items-center rounded-lg border border-input bg-background shadow-xs"
          id="repeat-interval"
        >
          <Button
            aria-label="减少重复间隔"
            className="size-11 justify-self-center"
            disabled={value.repeatMinutes <= 5}
            onClick={() =>
              onChange({ ...value, repeatMinutes: Math.max(5, value.repeatMinutes - 5) })
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <Minus aria-hidden="true" />
          </Button>
          <span className="text-center text-base font-semibold tabular-nums">
            {value.repeatMinutes} 分钟
          </span>
          <Button
            aria-label="增加重复间隔"
            className="size-11 justify-self-center"
            disabled={value.repeatMinutes >= 120}
            onClick={() =>
              onChange({ ...value, repeatMinutes: Math.min(120, value.repeatMinutes + 5) })
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {value.repeatMinutes < 10 ? (
          <p className="text-xs leading-5 text-status-pending">
            锁屏省电状态下，安卓系统可能把短于 9 分钟的提醒延后。
          </p>
        ) : null}
      </div>
    </div>
  )
}

interface ReminderSettingsFormProps {
  value: ReminderSettings
  capability: ReminderCapability | null
  onSave: (value: ReminderSettings) => Promise<void>
}

export function ReminderSettingsForm({
  value,
  capability,
  onSave,
}: ReminderSettingsFormProps) {
  const [draft, setDraft] = useState(value)
  const [isSaving, setIsSaving] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)

  useEffect(() => setDraft(value), [value])

  const nextAlarmText = formatNextAlarm(capability?.nextAlarmAt ?? 0)
  const capabilityText = !draft.enabled
    ? "提醒已暂停"
    : capability?.notification !== "granted"
      ? "通知权限未开启"
      : capability.exactAlarm !== "granted"
        ? "精确定时未开启，提醒可能延迟"
        : capability.fullScreenIntent === false
          ? "持续震动已开启；全屏提醒权限未开启"
        : nextAlarmText
          ? `已挂系统闹钟：${nextAlarmText}`
          : "提醒已开启，正在确认闹钟"

  return (
    <form
      className="grid gap-6"
      onSubmit={async (event) => {
        event.preventDefault()
        setIsSaving(true)
        await onSave(draft)
        setIsSaving(false)
      }}
    >
      <ReminderFields onChange={setDraft} showEnabled value={draft} />

      <div className="grid gap-2 rounded-lg border border-border/80 bg-muted/40 p-3">
        <p aria-live="polite" className="text-sm text-foreground">
          {capabilityText}
        </p>
        {draft.enabled ? (
          <p className="text-xs leading-5 text-muted-foreground">
            小米/HyperOS 若强杀应用会清掉系统闹钟。请把电池策略设为「无限制」，并允许自启动；
            保存后状态栏可能出现闹钟图标（部分机型只显示在系统时钟里）。
          </p>
        ) : null}
        {draft.enabled ? (
          <div className="grid gap-2 pt-1">
            <Button
              className="h-11 w-full justify-start"
              onClick={() => void requestBatteryOptimizationExemption()}
              type="button"
              variant="outline"
            >
              <Shield aria-hidden="true" />
              {capability?.batteryOptimized ? "允许忽略电池优化（未开启）" : "检查/保持电池无限制"}
            </Button>
            <Button
              className="h-11 w-full justify-start"
              onClick={() => void openVendorAutostartSettings()}
              type="button"
              variant="outline"
            >
              <Sparkles aria-hidden="true" />
              打开自启动/后台设置
            </Button>
            {capability?.fullScreenIntent === false ? (
              <Button
                className="h-11 w-full justify-start"
                onClick={() => void requestFullScreenIntentPermission()}
                type="button"
                variant="outline"
              >
                <BellRing aria-hidden="true" />
                允许全屏提醒
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Button
          className="h-11 w-full"
          disabled={isSaving}
          onClick={async () => {
            try {
              await fireTestNotification()
              setTestMessage("测试提醒已开始持续震动，可在通知中停止。")
            } catch {
              setTestMessage("测试闹钟启动失败，请检查通知和后台权限。")
            }
          }}
          type="button"
          variant="outline"
        >
          立即震动测试
        </Button>
        <Button
          className="h-11 w-full"
          disabled={isSaving}
          onClick={async () => {
            try {
              const native = await scheduleTestInSeconds(60)
              const when = new Date(native.nextAlarmAt)
              const hh = String(when.getHours()).padStart(2, "0")
              const mm = String(when.getMinutes()).padStart(2, "0")
              const ss = String(when.getSeconds()).padStart(2, "0")
              setTestMessage(`已安排 1 分钟后震动（约 ${hh}:${mm}:${ss}）。请灭屏等待，不要强杀应用。`)
            } catch {
              setTestMessage("1 分钟震动安排失败。请先保存并开启通知权限。")
            }
          }}
          type="button"
          variant="outline"
        >
          1 分钟后震动
        </Button>
        {testMessage ? (
          <p className="text-xs leading-5 text-status-pending">{testMessage}</p>
        ) : null}
      </div>

      <Button className="h-12 w-full" disabled={isSaving} type="submit">
        {isSaving ? "正在保存" : "保存提醒设置"}
      </Button>
    </form>
  )
}
