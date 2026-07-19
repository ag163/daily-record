package com.dailyrecord.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class ReminderResyncWorker extends Worker {
    public ReminderResyncWorker(
        @NonNull Context context,
        @NonNull WorkerParameters params
    ) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        ReminderScheduler.sync(getApplicationContext(), false);
        return Result.success();
    }
}
