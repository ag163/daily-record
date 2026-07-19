import { App as CapacitorApp } from "@capacitor/app"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  createEmptyState,
  type DailyRecordState,
} from "@/domain/daily-record"
import {
  loadDailyRecordState,
  saveDailyRecordState,
  syncNativeReminders,
} from "@/platform/reminder-store"

type StateRecipe = (current: DailyRecordState) => DailyRecordState

export function useDailyRecord() {
  const [state, setState] = useState<DailyRecordState>(createEmptyState)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const stateRef = useRef(state)
  const writeChainRef = useRef(Promise.resolve())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const reload = useCallback(async () => {
    try {
      await writeChainRef.current
      const nextState = await loadDailyRecordState()
      await syncNativeReminders()
      stateRef.current = nextState
      setState(nextState)
      setError(null)
    } catch {
      setError("无法读取本地记录，请重新打开应用。")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()

    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void reload()
      }
    })

    return () => {
      void listener.then((handle) => handle.remove())
    }
  }, [reload])

  const update = useCallback((recipe: StateRecipe) => {
    const run = async () => {
      // Disk is the source of truth so notification actions and UI writes
      // cannot clobber each other through a stale React closure.
      const base = await loadDailyRecordState()
      const nextState = recipe(base)
      stateRef.current = nextState
      setState(nextState)

      try {
        await saveDailyRecordState(nextState)
        setError(null)
      } catch {
        setError("记录没有保存成功，请重试。")
        const recovered = await loadDailyRecordState()
        stateRef.current = recovered
        setState(recovered)
      }
    }

    const queued = writeChainRef.current.then(run, run)
    writeChainRef.current = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }, [])

  return {
    state,
    isLoading,
    error,
    reload,
    update,
  }
}
