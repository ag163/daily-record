import { Check, Clock3, Minus, X } from "lucide-react"

import type { DayStatus } from "@/domain/daily-record"
import { cn } from "@/lib/utils"

const statusConfig = {
  taken: {
    label: "已完成",
    icon: Check,
    className: "bg-status-taken-soft text-status-taken",
  },
  pending: {
    label: "待确认",
    icon: Clock3,
    className: "bg-status-pending-soft text-status-pending",
  },
  missed: {
    label: "未完成",
    icon: X,
    className: "bg-status-missed-soft text-status-missed",
  },
  empty: {
    label: "无记录",
    icon: Minus,
    className: "bg-muted text-muted-foreground",
  },
  future: {
    label: "未来日期",
    icon: Minus,
    className: "bg-muted text-muted-foreground",
  },
} satisfies Record<
  DayStatus,
  { label: string; icon: typeof Check; className: string }
>

interface StatusMarkProps {
  status: DayStatus
  size?: "sm" | "lg"
  className?: string
}

export function StatusMark({ status, size = "sm", className }: StatusMarkProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span
      aria-label={config.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        size === "lg" ? "size-16" : "size-6",
        config.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className={size === "lg" ? "size-8" : "size-3.5"} />
    </span>
  )
}

export function getStatusLabel(status: DayStatus): string {
  return statusConfig[status].label
}
