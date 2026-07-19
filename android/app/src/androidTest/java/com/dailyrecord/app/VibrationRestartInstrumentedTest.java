package com.dailyrecord.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.os.Vibrator;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

@RunWith(AndroidJUnit4.class)
public class VibrationRestartInstrumentedTest {
    @Test
    public void repeatedTriggerRestartsMotorAfterSystemCancellation()
        throws Exception {
        Instrumentation instrumentation =
            InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        Vibrator vibrator = context.getSystemService(Vibrator.class);

        AlarmVibrationService.stop(context);
        vibrator.cancel();
        assertTrue(
            "Previous vibration service did not finish before setup",
            waitForServiceFlag(false, 3_000L)
        );
        writeState(context, false);
        ReminderScheduler.sync(context, false);
        writePendingState(context);

        try {
            ReminderScheduler.scheduleInSeconds(context, 5);
            assertTrue(
                "Initial trigger did not start system vibration",
                waitForSystemVibration(instrumentation, true, 15_000L)
            );

            AlarmVibrationService.cancelMotorForTest();
            assertTrue(
                "Test could not reproduce system-side vibration cancellation",
                waitForSystemVibration(instrumentation, false, 3_000L)
            );
            assertTrue(
                "Service lost the stale active flag needed to reproduce the bug",
                AlarmVibrationService.isVibratingForTest()
            );

            ReminderScheduler.handleAlarm(
                context,
                ReminderScheduler.ACTION_MAIN
            );
            assertTrue(
                "A later reminder did not restart vibration",
                waitForSystemVibration(instrumentation, true, 3_000L)
            );
        } finally {
            writeState(context, false);
            ReminderScheduler.sync(context, false);
            AlarmVibrationService.stop(context);
            assertTrue(
                "Vibration service did not stop during cleanup",
                waitForSystemVibration(instrumentation, false, 3_000L)
            );
            assertFalse(AlarmVibrationService.isVibratingForTest());
        }
    }

    private void writePendingState(Context context) throws Exception {
        writeState(context, true);
    }

    private void writeState(Context context, boolean enabled) throws Exception {
        JSONObject reminder = new JSONObject();
        reminder.put("enabled", enabled);
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
    }

    private boolean waitForSystemVibration(
        Instrumentation instrumentation,
        boolean expected,
        long timeoutMillis
    ) throws IOException {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (isAppVibrationRunning(instrumentation) == expected) {
                return true;
            }
            SystemClock.sleep(100L);
        }
        return false;
    }

    private boolean waitForServiceFlag(
        boolean expected,
        long timeoutMillis
    ) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (AlarmVibrationService.isVibratingForTest() == expected) {
                return true;
            }
            SystemClock.sleep(100L);
        }
        return false;
    }

    private boolean isAppVibrationRunning(Instrumentation instrumentation)
        throws IOException {
        String dump = executeShell(
            instrumentation,
            "dumpsys vibrator_manager"
        );
        int start = dump.indexOf("CurrentVibration:");
        int end = dump.indexOf("NextVibration:", start);
        if (start < 0 || end < 0) {
            return false;
        }
        String current = dump.substring(start, end);
        return (
            current.contains("status = running") &&
            current.contains("opPkg=com.dailyrecord.app")
        );
    }

    private String executeShell(
        Instrumentation instrumentation,
        String command
    ) throws IOException {
        ParcelFileDescriptor descriptor =
            instrumentation.getUiAutomation().executeShellCommand(command);
        try (
            ParcelFileDescriptor ignored = descriptor;
            FileInputStream input =
                new FileInputStream(descriptor.getFileDescriptor());
            ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
