package com.dailyrecord.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

final class ReminderScheduler {
    static final String PREFERENCES_NAME = "daily_record";
    static final String STATE_KEY = "state";
    static final String NEXT_ALARM_AT_KEY = "next_alarm_at";
    static final String NEXT_ALARM_ACTION_KEY = "next_alarm_action";
    static final String RESYNC_WORK_NAME = "daily_record_reminder_resync";

    static final String ACTION_MAIN = "com.dailyrecord.app.action.MAIN_REMINDER";
    static final String ACTION_REPEAT = "com.dailyrecord.app.action.REPEAT_REMINDER";
    static final String ACTION_DONE = "com.dailyrecord.app.action.DONE";
    static final String ACTION_STOP_TODAY = "com.dailyrecord.app.action.STOP_TODAY";
    static final String ACTION_SNOOZE = "com.dailyrecord.app.action.SNOOZE";
    static final String ACTION_WATCHDOG = "com.dailyrecord.app.action.WATCHDOG";

    // The v3 channel is intentionally silent: the foreground service owns
    // the continuous vibration pattern.
    static final String CHANNEL_ID = "daily_record_active_alarm_v3";
    private static final String TAG = "ReminderScheduler";
    private static final int MAIN_REQUEST_CODE = 4101;
    static final int REPEAT_REQUEST_CODE = 4102;
    private static final int WATCHDOG_REQUEST_CODE = 4105;
    static final int NOTIFICATION_ID = 5101;

    private ReminderScheduler() {}

    static void sync(Context context) {
        sync(context, false);
    }

    static void sync(Context context, boolean notifyIfDue) {
        SharedPreferences preferences = context.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        // Capture before cancel so "过会再提醒" / pending repeat is not rewritten
        // to "now + interval" every time the app opens.
        long previousNextAt = preferences.getLong(NEXT_ALARM_AT_KEY, 0L);
        String previousAction = preferences.getString(NEXT_ALARM_ACTION_KEY, "");

        cancelAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE);
        cancelAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE + 50);
        cancelAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE);
        cancelAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE + 50);
        cancelAlarm(context, ACTION_WATCHDOG, WATCHDOG_REQUEST_CODE);

        JSONObject state = readState(context);
        boolean enabled = isReminderEnabled(state) && hasTrackingStarted(state);
        boolean resolvedToday = isTodayResolved(state);

        if (!enabled) {
            cancelVisibleNotification(context);
            clearNextAlarmMeta(context);
            cancelResyncWork(context);
            return;
        }

        ensureChannel(context);
        ensureResyncWork(context);

        Calendar now = Calendar.getInstance();
        Calendar todayReminder = reminderTimeForDay(state, now);

        if (resolvedToday) {
            cancelVisibleNotification(context);
            Calendar nextMain = reminderTimeForDay(state, now);
            nextMain.add(Calendar.DAY_OF_MONTH, 1);
            scheduleAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE, nextMain);
            scheduleWatchdog(context, nextMain);
            return;
        }

        if (now.before(todayReminder)) {
            cancelVisibleNotification(context);
            scheduleAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE, todayReminder);
            scheduleWatchdog(context, todayReminder);
            Log.i(TAG, "Scheduled main alarm at " + todayReminder.getTime());
            return;
        }

        Calendar nextMain = reminderTimeForDay(state, now);
        nextMain.add(Calendar.DAY_OF_MONTH, 1);
        scheduleAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE, nextMain);
        scheduleWatchdog(context, nextMain);

        if (notifyIfDue) {
            showReminder(context, true);
            scheduleNextRepeat(context, state, now);
        } else {
            restoreOrSchedulePendingRepeat(
                context,
                state,
                now,
                previousNextAt,
                previousAction
            );
        }
        Log.i(TAG, "Past due; next main " + nextMain.getTime() + " notifyIfDue=" + notifyIfDue);
    }

    /**
     * Keep an already-scheduled same-day REPEAT (e.g. snooze) when the app is
     * merely opened. Only create a fresh "now + interval" repeat when there is
     * no future same-day REPEAT left.
     */
    private static void restoreOrSchedulePendingRepeat(
        Context context,
        JSONObject state,
        Calendar now,
        long previousNextAt,
        String previousAction
    ) {
        long nowMs = now.getTimeInMillis();
        Calendar midnight = (Calendar) now.clone();
        midnight.add(Calendar.DAY_OF_MONTH, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 0);
        midnight.set(Calendar.MILLISECOND, 0);
        long midnightMs = midnight.getTimeInMillis();

        boolean preserveRepeat =
            ACTION_REPEAT.equals(previousAction) &&
            previousNextAt > nowMs + 2_000L &&
            previousNextAt < midnightMs;

        if (preserveRepeat) {
            Calendar when = Calendar.getInstance();
            when.setTimeInMillis(previousNextAt);
            scheduleAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE, when);
            Log.i(TAG, "Preserved pending repeat at " + when.getTime());
            return;
        }

        // No future snooze/repeat left for today: keep the day covered.
        scheduleNextRepeat(context, state, now);
    }

    static void handleAlarm(Context context, String action) {
        PowerManager powerManager =
            (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "dailyrecord:reminder"
            );
            wakeLock.acquire(30_000L);
        }

        try {
            JSONObject state = readState(context);
            if (!isReminderEnabled(state) || !hasTrackingStarted(state)) {
                cancelVisibleNotification(context);
                clearNextAlarmMeta(context);
                return;
            }

            if (ACTION_WATCHDOG.equals(action)) {
                sync(context, false);
                return;
            }

            if (ACTION_MAIN.equals(action)) {
                Calendar nextMain = reminderTimeForDay(state, Calendar.getInstance());
                if (!nextMain.after(Calendar.getInstance())) {
                    nextMain.add(Calendar.DAY_OF_MONTH, 1);
                }
                scheduleAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE, nextMain);
                scheduleWatchdog(context, nextMain);
            }

            if (isTodayResolved(state)) {
                cancelAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE);
                cancelVisibleNotification(context);
                return;
            }

            showReminder(context, ACTION_REPEAT.equals(action));
            scheduleNextRepeat(context, state, Calendar.getInstance());
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        }
    }

    static void resolveToday(Context context, String status) {
        JSONObject state = readState(context);
        try {
            JSONObject records = state.optJSONObject("records");
            if (records == null) {
                records = new JSONObject();
                state.put("records", records);
            }

            JSONObject record = new JSONObject();
            record.put("status", status);
            record.put("updatedAt", isoTimestamp());
            records.put(todayKey(), record);
            saveState(context, state);
        } catch (JSONException ignored) {
            return;
        }

        cancelAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE);
        cancelVisibleNotification(context);
        sync(context, false);
    }

    static void snooze(Context context) {
        JSONObject state = readState(context);
        if (
            !isReminderEnabled(state) ||
            !hasTrackingStarted(state) ||
            isTodayResolved(state)
        ) {
            cancelVisibleNotification(context);
            return;
        }

        cancelAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE);
        cancelAlarm(context, ACTION_REPEAT, REPEAT_REQUEST_CODE + 50);
        scheduleNextRepeat(context, state, Calendar.getInstance());
        cancelVisibleNotification(context);
        Log.i(TAG, "Snoozed reminder by " + repeatMinutes(state) + " minutes");
    }


    static void fireTestNotification(Context context) {
        showReminder(context, false);
        Log.i(TAG, "Test notification fired immediately");
    }

    static long scheduleInSeconds(Context context, int seconds) {
        ensureChannel(context);
        cancelAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE);
        Calendar when = Calendar.getInstance();
        when.add(Calendar.SECOND, Math.max(5, seconds));
        scheduleAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE, when, true);
        // exact backup with different request code
        scheduleAlarm(context, ACTION_MAIN, MAIN_REQUEST_CODE + 50, when, false);
        Log.i(TAG, "Test alarm in " + seconds + "s at " + when.getTime());
        return when.getTimeInMillis();
    }

    static JSONObject scheduleStatus(Context context) {
        JSONObject status = new JSONObject();
        SharedPreferences preferences = context.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        JSONObject state = readState(context);
        try {
            status.put("enabled", isReminderEnabled(state) && hasTrackingStarted(state));
            status.put("resolvedToday", isTodayResolved(state));
            status.put("nextAlarmAt", preferences.getLong(NEXT_ALARM_AT_KEY, 0L));
            status.put(
                "nextAlarmAction",
                preferences.getString(NEXT_ALARM_ACTION_KEY, "")
            );
            status.put("hasExactAlarmPermission", canScheduleExact(context));
            status.put("canUseFullScreenIntent", canUseFullScreenIntent(context));
            status.put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizations(context));
            status.put("now", System.currentTimeMillis());
            JSONObject reminder = state.optJSONObject("reminder");
            status.put(
                "reminderTime",
                reminder == null ? "08:00" : reminder.optString("time", "08:00")
            );
        } catch (JSONException ignored) {
        }
        return status;
    }

    static boolean isIgnoringBatteryOptimizations(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager powerManager =
            (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) {
            return false;
        }
        return powerManager.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }
        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarmManager != null && alarmManager.canScheduleExactAlarms();
    }

    static boolean canUseFullScreenIntent(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return true;
        }
        NotificationManager manager =
            context.getSystemService(NotificationManager.class);
        return manager != null && manager.canUseFullScreenIntent();
    }

    private static void scheduleNextRepeat(
        Context context,
        JSONObject state,
        Calendar now
    ) {
        int repeatMinutes = repeatMinutes(state);
        Calendar repeatAt = (Calendar) now.clone();
        repeatAt.add(Calendar.MINUTE, repeatMinutes);

        Calendar midnight = (Calendar) now.clone();
        midnight.add(Calendar.DAY_OF_MONTH, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 0);
        midnight.set(Calendar.MILLISECOND, 0);

        if (repeatAt.before(midnight)) {
            scheduleAlarm(
                context,
                ACTION_REPEAT,
                REPEAT_REQUEST_CODE,
                repeatAt
            );
        }
    }

    private static void scheduleWatchdog(Context context, Calendar target) {
        Calendar watchdog = (Calendar) target.clone();
        watchdog.add(Calendar.MINUTE, 2);
        if (watchdog.after(Calendar.getInstance())) {
            // Exact fallback only: do not steal the system alarm-clock indicator.
            scheduleAlarm(
                context,
                ACTION_WATCHDOG,
                WATCHDOG_REQUEST_CODE,
                watchdog,
                false
            );
        }
    }

    private static void scheduleAlarm(
        Context context,
        String action,
        int requestCode,
        Calendar when
    ) {
        scheduleAlarm(context, action, requestCode, when, true);
    }

    private static void scheduleAlarm(
        Context context,
        String action,
        int requestCode,
        Calendar when,
        boolean preferAlarmClock
    ) {
        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }

        PendingIntent pendingIntent = alarmIntent(
            context,
            action,
            requestCode,
            PendingIntent.FLAG_UPDATE_CURRENT
        );
        long triggerAt = when.getTimeInMillis();
        if (triggerAt <= System.currentTimeMillis()) {
            triggerAt = System.currentTimeMillis() + 2_000L;
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        PendingIntent showIntent = PendingIntent.getActivity(
            context,
            requestCode + 1000,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        if (preferAlarmClock) {
            try {
                AlarmManager.AlarmClockInfo clockInfo =
                    new AlarmManager.AlarmClockInfo(triggerAt, showIntent);
                alarmManager.setAlarmClock(clockInfo, pendingIntent);
                rememberNextAlarm(context, action, triggerAt);
                Log.i(TAG, "setAlarmClock ok action=" + action + " at=" + triggerAt);
                // Dual path: exact backup so HyperOS has a second delivery attempt.
                if (ACTION_MAIN.equals(action) || ACTION_REPEAT.equals(action)) {
                    try {
                        PendingIntent backupIntent = alarmIntent(
                            context,
                            action,
                            requestCode + 50,
                            PendingIntent.FLAG_UPDATE_CURRENT
                        );
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            alarmManager.setExactAndAllowWhileIdle(
                                AlarmManager.RTC_WAKEUP,
                                triggerAt,
                                backupIntent
                            );
                        }
                        Log.i(TAG, "exact backup ok action=" + action);
                    } catch (Exception backupError) {
                        Log.w(TAG, "exact backup failed", backupError);
                    }
                }
                return;
            } catch (Exception error) {
                Log.w(TAG, "setAlarmClock failed, fallback exact", error);
            }
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerAt,
                    pendingIntent
                );
            } else {
                alarmManager.setExact(
                    AlarmManager.RTC_WAKEUP,
                    triggerAt,
                    pendingIntent
                );
            }
            rememberNextAlarm(context, action, triggerAt);
            Log.i(TAG, "exact fallback ok action=" + action + " at=" + triggerAt);
        } catch (SecurityException securityException) {
            Log.e(TAG, "Unable to schedule exact alarm", securityException);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerAt,
                    pendingIntent
                );
                rememberNextAlarm(context, action, triggerAt);
            }
        }
    }

    private static void rememberNextAlarm(
        Context context,
        String action,
        long triggerAt
    ) {
        SharedPreferences preferences = context.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        long existing = preferences.getLong(NEXT_ALARM_AT_KEY, 0L);
        boolean shouldWrite =
            ACTION_MAIN.equals(action) ||
            ACTION_REPEAT.equals(action) ||
            existing <= System.currentTimeMillis() ||
            triggerAt < existing;

        if (!shouldWrite) {
            return;
        }

        preferences
            .edit()
            .putLong(NEXT_ALARM_AT_KEY, triggerAt)
            .putString(NEXT_ALARM_ACTION_KEY, action)
            .apply();
    }

    private static void clearNextAlarmMeta(Context context) {
        context
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(NEXT_ALARM_AT_KEY)
            .remove(NEXT_ALARM_ACTION_KEY)
            .apply();
    }

    private static void cancelAlarm(
        Context context,
        String action,
        int requestCode
    ) {
        AlarmManager alarmManager =
            (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }

        PendingIntent pendingIntent = alarmIntent(
            context,
            action,
            requestCode,
            PendingIntent.FLAG_NO_CREATE
        );
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
    }

    private static PendingIntent alarmIntent(
        Context context,
        String action,
        int requestCode,
        int baseFlag
    ) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(action);
        intent.setPackage(context.getPackageName());
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            baseFlag | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void showReminder(Context context, boolean isRepeat) {
        try {
            AlarmVibrationService.start(context, isRepeat);
            Log.i(TAG, "Vibration service requested isRepeat=" + isRepeat);
        } catch (Exception error) {
            Log.e(TAG, "Unable to start vibration service", error);
        }
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager =
            context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "正在震动",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("每日事项持续震动时显示的通知");
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setBypassDnd(false);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private static void cancelVisibleNotification(Context context) {
        AlarmVibrationService.stop(context);
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
    }

    private static void ensureResyncWork(Context context) {
        try {
            PeriodicWorkRequest request =
                new PeriodicWorkRequest.Builder(
                    ReminderResyncWorker.class,
                    15,
                    TimeUnit.MINUTES
                )
                    .build();
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                RESYNC_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            );
        } catch (Exception error) {
            Log.w(TAG, "WorkManager resync enqueue failed", error);
        }
    }

    private static void cancelResyncWork(Context context) {
        try {
            WorkManager.getInstance(context).cancelUniqueWork(RESYNC_WORK_NAME);
        } catch (Exception ignored) {
        }
    }

    private static JSONObject readState(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        String value = preferences.getString(STATE_KEY, null);
        if (value == null) {
            return new JSONObject();
        }

        try {
            return new JSONObject(value);
        } catch (JSONException ignored) {
            return new JSONObject();
        }
    }

    private static void saveState(Context context, JSONObject state) {
        context
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(STATE_KEY, state.toString())
            .commit();
    }

    private static boolean hasTrackingStarted(JSONObject state) {
        String trackingStartedOn = state.optString("trackingStartedOn", "");
        return trackingStartedOn != null
            && !trackingStartedOn.isEmpty()
            && !"null".equals(trackingStartedOn);
    }

    private static boolean isReminderEnabled(JSONObject state) {
        JSONObject reminder = state.optJSONObject("reminder");
        return reminder != null && reminder.optBoolean("enabled", false);
    }

    private static boolean isTodayResolved(JSONObject state) {
        JSONObject records = state.optJSONObject("records");
        if (records == null) {
            return false;
        }

        JSONObject record = records.optJSONObject(todayKey());
        if (record == null) {
            return false;
        }

        String status = record.optString("status", "");
        return "taken".equals(status) || "missed".equals(status);
    }

    private static Calendar reminderTimeForDay(JSONObject state, Calendar source) {
        JSONObject reminder = state.optJSONObject("reminder");
        String value = reminder == null
            ? "08:00"
            : reminder.optString("time", "08:00");
        String[] parts = value.split(":");
        int hour = parts.length > 0 ? safeInt(parts[0], 8) : 8;
        int minute = parts.length > 1 ? safeInt(parts[1], 0) : 0;

        Calendar result = (Calendar) source.clone();
        result.set(Calendar.HOUR_OF_DAY, Math.max(0, Math.min(23, hour)));
        result.set(Calendar.MINUTE, Math.max(0, Math.min(59, minute)));
        result.set(Calendar.SECOND, 0);
        result.set(Calendar.MILLISECOND, 0);
        return result;
    }

    private static int repeatMinutes(JSONObject state) {
        JSONObject reminder = state.optJSONObject("reminder");
        int value = reminder == null
            ? 10
            : reminder.optInt("repeatMinutes", 10);
        return Math.max(5, Math.min(120, value));
    }

    private static int safeInt(String value, int fallback) {
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static String todayKey() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        formatter.setTimeZone(TimeZone.getDefault());
        return formatter.format(new Date());
    }

    private static String isoTimestamp() {
        SimpleDateFormat formatter = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            Locale.US
        );
        formatter.setTimeZone(TimeZone.getDefault());
        return formatter.format(new Date());
    }
}
