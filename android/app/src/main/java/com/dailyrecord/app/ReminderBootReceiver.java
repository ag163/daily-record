package com.dailyrecord.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // After reboot/time change, catch up any overdue reminder for today.
        ReminderScheduler.sync(context, true);
    }
}
