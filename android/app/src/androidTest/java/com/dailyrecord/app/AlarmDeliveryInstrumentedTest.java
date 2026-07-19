package com.dailyrecord.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

@RunWith(AndroidJUnit4.class)
public class AlarmDeliveryInstrumentedTest {
    @Test
    public void scheduledAlarmStartsAndStopsPersistentVibration() throws Exception {
        Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager manager =
            context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        manager.cancelAll();

        JSONObject reminder = new JSONObject();
        reminder.put("enabled", true);
        reminder.put("time", "00:00");
        reminder.put("repeatMinutes", 10);

        JSONObject state = new JSONObject();
        state.put("version", 1);
        state.put(
            "trackingStartedOn",
            new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date())
        );
        state.put("records", new JSONObject());
        state.put("reminder", reminder);

        context
            .getSharedPreferences(
                ReminderScheduler.PREFERENCES_NAME,
                Context.MODE_PRIVATE
            )
            .edit()
            .putString(ReminderScheduler.STATE_KEY, state.toString())
            .commit();

        ReminderScheduler.scheduleInSeconds(context, 5);

        Notification notification = waitForReminder(manager, 15_000L);
        assertNotNull("Scheduled alarm did not post a notification", notification);
        assertEquals(ReminderScheduler.CHANNEL_ID, notification.getChannelId());
        assertTrue(
            "Alarm notification is not backed by an ongoing vibration service",
            (notification.flags & Notification.FLAG_ONGOING_EVENT) != 0
        );
        assertTrue(
            "AlarmVibrationService did not remain active after delivery",
            waitForService(context, "com.dailyrecord.app.AlarmVibrationService", 5_000L)
        );
        assertTrue(
            "AlarmVibrationService started without active vibration",
            waitForVibration(5_000L)
        );
        assertNotNull("Reminder notification has no action buttons", notification.actions);
        assertEquals("Reminder notification must expose three actions", 3, notification.actions.length);
        assertEquals("已完成", notification.actions[0].title);
        assertEquals("过会再提醒", notification.actions[1].title);
        assertEquals("今天不再提醒", notification.actions[2].title);
        assertTrue("已完成 action has no icon", notification.actions[0].icon != 0);
        assertTrue("过会再提醒 action has no icon", notification.actions[1].icon != 0);
        assertTrue("今天不再提醒 action has no icon", notification.actions[2].icon != 0);

        notification.actions[1].actionIntent.send();
        assertTrue(
            "Snooze action did not stop AlarmVibrationService",
            waitForServiceStopped(
                context,
                "com.dailyrecord.app.AlarmVibrationService",
                5_000L
            )
        );
        assertFalse(AlarmVibrationService.isVibratingForTest());
        assertNotNull(
            "Snooze action did not schedule the next repeat alarm",
            findPendingRepeatAlarm(context)
        );

        NotificationChannel channel =
            manager.getNotificationChannel(ReminderScheduler.CHANNEL_ID);
        assertNotNull(channel);
        assertNull(channel.getSound());

        ReminderScheduler.resolveToday(context, "missed");
        assertTrue(
            "Resolving today did not stop AlarmVibrationService",
            waitForServiceStopped(
                context,
                "com.dailyrecord.app.AlarmVibrationService",
                5_000L
            )
        );
        assertFalse(AlarmVibrationService.isVibratingForTest());
    }

    private android.app.PendingIntent findPendingRepeatAlarm(Context context) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ReminderScheduler.ACTION_REPEAT);
        intent.setPackage(context.getPackageName());
        return android.app.PendingIntent.getBroadcast(
            context,
            ReminderScheduler.REPEAT_REQUEST_CODE,
            intent,
            android.app.PendingIntent.FLAG_NO_CREATE |
                android.app.PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification waitForReminder(
        NotificationManager manager,
        long timeoutMillis
    ) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() == 5101) {
                    return active.getNotification();
                }
            }
            SystemClock.sleep(250L);
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private boolean waitForService(
        Context context,
        String className,
        long timeoutMillis
    ) {
        ActivityManager activityManager =
            context.getSystemService(ActivityManager.class);
        assertNotNull(activityManager);
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            for (
                ActivityManager.RunningServiceInfo service :
                    activityManager.getRunningServices(Integer.MAX_VALUE)
            ) {
                if (className.equals(service.service.getClassName())) {
                    return true;
                }
            }
            SystemClock.sleep(250L);
        }
        return false;
    }

    private boolean waitForServiceStopped(
        Context context,
        String className,
        long timeoutMillis
    ) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (!waitForService(context, className, 250L)) {
                return true;
            }
        }
        return false;
    }

    private boolean waitForVibration(long timeoutMillis) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (AlarmVibrationService.isVibratingForTest()) {
                return true;
            }
            SystemClock.sleep(250L);
        }
        return false;
    }
}
