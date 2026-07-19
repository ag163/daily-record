import { useState } from "react"
import { BellOff, BellRing } from "lucide-react"

import { ReminderFields } from "@/components/reminder-form"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { DEFAULT_REMINDER, type ReminderSettings } from "@/domain/daily-record"

interface OnboardingProps {
  onComplete: (reminder: ReminderSettings) => Promise<void>
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [reminder, setReminder] = useState(DEFAULT_REMINDER)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const finish = async (enabled: boolean) => {
    setIsSubmitting(true)
    await onComplete({ ...reminder, enabled })
    setIsSubmitting(false)
  }

  return (
    <main className="app-shell grid min-h-dvh content-center gap-6">
      <header className="grid gap-4">
        <img
          alt=""
          aria-hidden="true"
          className="size-16 rounded-xl shadow-sm"
          src="/icon-192.png"
        />
        <div className="grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">每日记录</p>
          <h1 className="text-2xl font-bold">设置每日提醒</h1>
          <p className="text-sm text-muted-foreground">所有记录只保存在本机</p>
        </div>
      </header>

      <Separator />

      <ReminderFields onChange={setReminder} value={reminder} />

      <div className="grid gap-3">
        <Button
          className="h-14 w-full text-base"
          disabled={isSubmitting}
          onClick={() => void finish(true)}
        >
          <BellRing aria-hidden="true" />
          启用提醒并开始
        </Button>
        <Button
          className="h-12 w-full text-foreground"
          disabled={isSubmitting}
          onClick={() => void finish(false)}
          variant="outline"
        >
          <BellOff aria-hidden="true" />
          暂不启用提醒
        </Button>
      </div>
    </main>
  )
}
