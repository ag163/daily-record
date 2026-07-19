package com.dailyrecord.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "ReminderStore")
public class ReminderStorePlugin extends Plugin {
    @PluginMethod
    public void loadState(PluginCall call) {
        String value = preferences().getString(ReminderScheduler.STATE_KEY, null);
        JSObject result = new JSObject();
        result.put("value", value);
        call.resolve(result);
    }

    @PluginMethod
    public void saveState(PluginCall call) {
        String value = call.getString("value");
        if (value == null) {
            call.reject("Missing state value");
            return;
        }

        try {
            new JSONObject(value);
        } catch (JSONException error) {
            call.reject("Invalid state JSON");
            return;
        }

        boolean saved = preferences()
            .edit()
            .putString(ReminderScheduler.STATE_KEY, value)
            .commit();
        if (!saved) {
            call.reject("Failed to persist reminder state");
            return;
        }
        ReminderScheduler.sync(getContext(), true);
        call.resolve(toJSObject(ReminderScheduler.scheduleStatus(getContext())));
    }

    @PluginMethod
    public void syncReminders(PluginCall call) {
        ReminderScheduler.sync(getContext(), false);
        call.resolve(toJSObject(ReminderScheduler.scheduleStatus(getContext())));
    }


    @PluginMethod
    public void fireTestNotification(PluginCall call) {
        ReminderScheduler.fireTestNotification(getContext());
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void scheduleTestInSeconds(PluginCall call) {
        Integer seconds = call.getInt("seconds", 60);
        long at = ReminderScheduler.scheduleInSeconds(getContext(), seconds == null ? 60 : seconds);
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("nextAlarmAt", at);
        call.resolve(result);
    }

    @PluginMethod
    public void getScheduleStatus(PluginCall call) {
        call.resolve(toJSObject(ReminderScheduler.scheduleStatus(getContext())));
    }

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        boolean ignoring = ReminderScheduler.isIgnoringBatteryOptimizations(context);
        result.put("ignoringBatteryOptimizations", ignoring);

        if (ignoring || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            result.put("opened", true);
        } catch (Exception error) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                result.put("opened", true);
                result.put("fallback", true);
            } catch (Exception ignored) {
                result.put("opened", false);
            }
        }

        call.resolve(result);
    }

    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        String[][] candidates = new String[][] {
            { "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },
            { "com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity" },
            { "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
            { "com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity" },
            { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
            { "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },
            { "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
        };

        boolean opened = false;
        for (String[] candidate : candidates) {
            try {
                Intent intent = new Intent();
                intent.setClassName(candidate[0], candidate[1]);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                opened = true;
                result.put("vendor", candidate[0]);
                break;
            } catch (Exception ignored) {
            }
        }

        if (!opened) {
            try {
                Intent appDetails = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                appDetails.setData(Uri.parse("package:" + context.getPackageName()));
                appDetails.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(appDetails);
                opened = true;
                result.put("fallback", "app-details");
            } catch (Exception ignored) {
                opened = false;
            }
        }

        result.put("opened", opened);
        call.resolve(result);
    }

    @PluginMethod
    public void requestFullScreenIntentPermission(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        boolean allowed = ReminderScheduler.canUseFullScreenIntent(context);
        result.put("allowed", allowed);

        if (allowed || Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            result.put("opened", true);
        } catch (Exception error) {
            result.put("opened", false);
        }
        call.resolve(result);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(
            ReminderScheduler.PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
    }

    private JSObject toJSObject(JSONObject source) {
        JSObject result = new JSObject();
        if (source == null) {
            return result;
        }
        result.put("enabled", source.optBoolean("enabled", false));
        result.put("resolvedToday", source.optBoolean("resolvedToday", false));
        result.put("nextAlarmAt", source.optLong("nextAlarmAt", 0L));
        result.put("nextAlarmAction", source.optString("nextAlarmAction", ""));
        result.put(
            "hasExactAlarmPermission",
            source.optBoolean("hasExactAlarmPermission", true)
        );
        result.put(
            "canUseFullScreenIntent",
            source.optBoolean("canUseFullScreenIntent", true)
        );
        result.put(
            "ignoringBatteryOptimizations",
            source.optBoolean("ignoringBatteryOptimizations", false)
        );
        result.put("now", source.optLong("now", System.currentTimeMillis()));
        result.put("reminderTime", source.optString("reminderTime", "08:00"));
        return result;
    }
}
