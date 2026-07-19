import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { zhCN } from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getDayStatus,
  type DailyRecordState,
  type DayStatus,
} from "@/domain/daily-record"
import { cn } from "@/lib/utils"

import { getStatusLabel, StatusMark } from "./status-mark"

const weekdays = ["一", "二", "三", "四", "五", "六", "日"]

interface MonthCalendarProps {
  state: DailyRecordState
  month: Date
  today: Date
  onMonthChange: (month: Date) => void
  onDayClick: (date: Date, status: DayStatus) => void
}

export function MonthCalendar({
  state,
  month,
  today,
  onMonthChange,
  onDayClick,
}: MonthCalendarProps) {
  const firstVisibleDay = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const lastVisibleDay = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: firstVisibleDay, end: lastVisibleDay })
  const nextMonthDisabled = !isAfter(startOfMonth(today), startOfMonth(month))

  return (
    <section aria-labelledby="calendar-heading" className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="calendar-heading" className="text-base font-semibold">
          {format(month, "yyyy年 M月", { locale: zhCN })}
        </h2>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="上一个月"
                className="size-11 text-foreground"
                size="icon"
                variant="outline"
                onClick={() => onMonthChange(subMonths(month, 1))}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>上一个月</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="下一个月"
                className="size-11 text-foreground"
                disabled={nextMonthDisabled}
                size="icon"
                variant="outline"
                onClick={() => onMonthChange(addMonths(month, 1))}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下一个月</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        <div className="col-span-7 grid grid-cols-7 gap-1" aria-hidden="true">
          {weekdays.map((weekday) => (
            <span
              className="flex h-8 min-w-0 items-center justify-center text-center text-[0.8rem] font-medium leading-none text-muted-foreground"
              key={weekday}
            >
              {weekday}
            </span>
          ))}
        </div>

        <div className="col-span-7 grid grid-cols-7 gap-1" role="grid">
          {days.map((date) => {
            const status = getDayStatus(state, date, today)
            const inMonth = isSameMonth(date, month)
            const disabled = !inMonth || status === "future"
            const isToday = isSameDay(date, today)

            return (
              <button
                aria-label={`${format(date, "M月d日", { locale: zhCN })}，${getStatusLabel(status)}`}
                className={cn(
                  "calendar-day group flex min-w-0 aspect-square flex-col items-center justify-center gap-1 rounded-md border border-transparent text-sm font-semibold tabular-nums transition-[background-color,border-color,transform] duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  inMonth ? "text-foreground" : "text-muted-foreground/45",
                  !disabled && "active:scale-[0.96] hover:bg-muted",
                  disabled && "cursor-default",
                  isToday && "border-foreground/25",
                )}
                disabled={disabled}
                key={date.toISOString()}
                onClick={() => onDayClick(date, status)}
                role="gridcell"
                type="button"
              >
                <span className="block w-full text-center text-[0.8rem] leading-none">
                  {format(date, "d")}
                </span>
                {inMonth && status !== "future" && status !== "empty" ? (
                  <StatusMark status={status} />
                ) : (
                  <span aria-hidden="true" className="size-6" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {(["taken", "pending", "missed"] as const).map((status) => (
          <span className="inline-flex items-center gap-1.5" key={status}>
            <StatusMark status={status} />
            {getStatusLabel(status)}
          </span>
        ))}
      </div>
    </section>
  )
}
