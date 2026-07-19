package com.dailyrecord.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class AlarmVibrationService extends Service {
    private static final String TAG = "AlarmVibrationService";
    private static final String ACTION_START =
        "com.dailyrecord.app.action.START_VIBRATION";
    private static final String EXTRA_IS_REPEAT = "isRepeat";
    private static final long MAX_VIBRATION_MILLIS = 10 * 60_000L;
    private static final int DONE_REQUEST_CODE = 6103;
    private static final int STOP_REQUEST_CODE = 6104;
    private static final int SNOOZE_REQUEST_CODE = 6107;
    private static final int CONTENT_REQUEST_CODE = 6105;
    private static final int FULL_SCREEN_REQUEST_CODE = 6106;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::stopSelf;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private static volatile boolean vibrating;
    private static volatile AlarmVibrationService activeService;

    static void start(Context context, boolean isRepeat) {
        Intent intent = new Intent(context, AlarmVibrationService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_IS_REPEAT, isRepeat);
        ContextCompat.startForegroundService(context, intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, AlarmVibrationService.class));
    }

    static boolean isVibratingForTest() {
        return vibrating;
    }

    @VisibleForTesting
    static void cancelMotorForTest() {
        AlarmVibrationService service = activeService;
        if (service != null && service.vibrator != null) {
            service.vibrator.cancel();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean isRepeat =
            intent != null && intent.getBooleanExtra(EXTRA_IS_REPEAT, false);
        ReminderScheduler.ensureChannel(this);
        Notification notification = buildNotification(isRepeat);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                ReminderScheduler.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else {
            startForeground(ReminderScheduler.NOTIFICATION_ID, notification);
        }

        startVibration();
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, MAX_VIBRATION_MILLIS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        stopVibration();
        if (activeService == this) {
            activeService = null;
        }
        stopForeground(true);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification(boolean isRepeat) {
        Intent contentScreen = new Intent(this, MainActivity.class);
        contentScreen.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            CONTENT_REQUEST_CODE,
            contentScreen,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent fullScreen = new Intent(this, MainActivity.class);
        fullScreen.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        PendingIntent fullScreenIntent = PendingIntent.getActivity(
            this,
            FULL_SCREEN_REQUEST_CODE,
            fullScreen,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent doneIntent = actionIntent(
            ReminderScheduler.ACTION_DONE,
            DONE_REQUEST_CODE
        );
        PendingIntent stopIntent = actionIntent(
            ReminderScheduler.ACTION_STOP_TODAY,
            STOP_REQUEST_CODE
        );
        PendingIntent snoozeIntent = actionIntent(
            ReminderScheduler.ACTION_SNOOZE,
            SNOOZE_REQUEST_CODE
        );

        NotificationCompat.Builder builder =
            new NotificationCompat.Builder(this, ReminderScheduler.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_daily_record)
                .setContentTitle("今天的事项待确认")
                .setContentText(
                    isRepeat ? "提醒仍在震动，请确认今日状态" : "正在持续震动，点击处理今日记录"
                )
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setAutoCancel(false)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setForegroundServiceBehavior(
                    NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE
                )
                .addAction(R.drawable.ic_action_done, "已完成", doneIntent)
                .addAction(R.drawable.ic_action_snooze, "过会再提醒", snoozeIntent)
                .addAction(R.drawable.ic_action_stop, "今天不再提醒", stopIntent);

        if (ReminderScheduler.canUseFullScreenIntent(this)) {
            builder.setFullScreenIntent(fullScreenIntent, true);
        }
        return builder.build();
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, ReminderReceiver.class);
        intent.setAction(action);
        intent.setPackage(getPackageName());
        return PendingIntent.getBroadcast(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void startVibration() {
        if (wakeLock == null || !wakeLock.isHeld()) {
            acquireWakeLock();
        }

        vibrating = false;
        if (vibrator != null) {
            vibrator.cancel();
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) {
            Log.w(TAG, "Device has no available vibrator");
            return;
        }
        long[] pattern = new long[] { 0L, 800L, 400L };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            VibrationEffect effect = VibrationEffect.createWaveform(pattern, 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                vibrator.vibrate(
                    effect,
                    VibrationAttributes.createForUsage(
                        VibrationAttributes.USAGE_ALARM
                    )
                );
            } else {
                vibrator.vibrate(
                    effect,
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build()
                );
            }
        } else {
            vibrator.vibrate(pattern, 0);
        }
        vibrating = true;
        Log.i(TAG, "Persistent vibration started");
    }

    private void stopVibration() {
        vibrating = false;
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
        Log.i(TAG, "Persistent vibration stopped");
    }

    private void acquireWakeLock() {
        PowerManager powerManager =
            (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) {
            return;
        }
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "dailyrecord:vibration"
        );
        wakeLock.acquire(MAX_VIBRATION_MILLIS + 30_000L);
    }
}
