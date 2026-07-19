package com.dailyrecord.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pendingResult = goAsync();
        try {
            String action = intent.getAction();
            if (ReminderScheduler.ACTION_DONE.equals(action)) {
                ReminderScheduler.resolveToday(context, "taken");
                return;
            }

            if (ReminderScheduler.ACTION_STOP_TODAY.equals(action)) {
                ReminderScheduler.resolveToday(context, "missed");
                return;
            }

            if (ReminderScheduler.ACTION_SNOOZE.equals(action)) {
                ReminderScheduler.snooze(context);
                return;
            }

            if (
                ReminderScheduler.ACTION_MAIN.equals(action) ||
                ReminderScheduler.ACTION_REPEAT.equals(action) ||
                ReminderScheduler.ACTION_WATCHDOG.equals(action)
            ) {
                ReminderScheduler.handleAlarm(context, action);
            }
        } finally {
            pendingResult.finish();
        }
    }
}
