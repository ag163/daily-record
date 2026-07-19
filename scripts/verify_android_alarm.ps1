param(
    [string]$ApkPath = "",
    [string]$AdbPath = "D:\Android\Sdk\platform-tools\adb.exe"
)

$ErrorActionPreference = "Stop"
$packageName = "com.dailyrecord.app"
$expectedChannelId = "daily_record_active_alarm_v3"

if (-not (Test-Path -LiteralPath $AdbPath)) {
    throw "adb not found: $AdbPath"
}

$deviceState = (& $AdbPath get-state 2>$null).Trim()
if ($deviceState -ne "device") {
    throw "No ready Android device/emulator"
}

if ($ApkPath) {
    $resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
    & $AdbPath install -r $resolvedApk | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "APK install failed"
    }
}

& $AdbPath shell pm grant $packageName android.permission.POST_NOTIFICATIONS 2>$null
& $AdbPath shell cmd appops set $packageName SCHEDULE_EXACT_ALARM allow 2>$null

# The requested reminder is vibration-only. Keep notification audio muted and
# put the alarm stream at Android's minimum accepted level; the app contains no
# playback path and the verification below only accepts its vibration service.
& $AdbPath shell cmd media_session volume --stream 5 --set 0 | Out-Null
& $AdbPath shell cmd media_session volume --stream 4 --set 1 | Out-Null

$deviceNow = (& $AdbPath shell "date +%Y-%m-%dT%H:%M:%S").Trim()
$now = [datetime]::ParseExact(
    $deviceNow,
    "yyyy-MM-ddTHH:mm:ss",
    [Globalization.CultureInfo]::InvariantCulture
)
$today = $now.ToString("yyyy-MM-dd")
$state = @{
    version = 1
    trackingStartedOn = $today
    records = @{}
    reminder = @{
        enabled = $true
        time = "00:00"
        repeatMinutes = 10
    }
} | ConvertTo-Json -Compress

$escapedState = [System.Security.SecurityElement]::Escape($state)
$xml = @"
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="state">$escapedState</string>
</map>
"@
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($xml))

& $AdbPath shell am force-stop $packageName | Out-Null
& $AdbPath shell "run-as $packageName mkdir -p shared_prefs" | Out-Null
& $AdbPath shell "run-as $packageName sh -c 'echo $base64 | base64 -d > shared_prefs/daily_record.xml'" | Out-Null
& $AdbPath logcat -c
& $AdbPath shell am start -n "$packageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 1

& $AdbPath shell "run-as $packageName am broadcast --user 0 -a com.dailyrecord.app.action.MAIN_REMINDER -n $packageName/.ReminderReceiver" | Out-Null
Start-Sleep -Seconds 2

$logs = (& $AdbPath logcat -d -s "ReminderScheduler:I" "AlarmVibrationService:I" "*:S") -join "`n"
if ($logs -notmatch "Vibration service requested") {
    throw "Alarm receiver ran without requesting the vibration service.`n$logs"
}

$notificationDump = (& $AdbPath shell dumpsys notification --noredact) -join "`n"
$recordPattern = "(?s)NotificationRecord\([^\n]*pkg=$([regex]::Escape($packageName))[^\n]*id=5101.*?(?=\n\s*NotificationRecord\(|\n\s*Notification attention state:)"
$recordMatch = [regex]::Match($notificationDump, $recordPattern)
if (-not $recordMatch.Success) {
    throw "Active reminder notification not found"
}

$record = $recordMatch.Value
$serviceDump = (& $AdbPath shell dumpsys activity services $packageName) -join "`n"
$vibratorDump = (& $AdbPath shell dumpsys vibrator_manager) -join "`n"
$currentVibration = [regex]::Match(
    $vibratorDump,
    "(?s)CurrentVibration:.*?(?=\r?\n\s*NextVibration:)"
).Value
$checks = [ordered]@{
    receiverFired = $true
    channel = $record -match "Notification\(channel=$expectedChannelId\b"
    ongoingAlarm = $record -match "flags=[^\r\n]*ONGOING_EVENT"
    vibrationService = $serviceDump -match "AlarmVibrationService"
    persistentVibration = $logs -match "Persistent vibration started"
    systemVibration = (
        $currentVibration -match "status = running" -and
        $currentVibration -match "opPkg=$([regex]::Escape($packageName))" -and
        $currentVibration -match "mUsage=ALARM"
    )
}

$checks.GetEnumerator() | ForEach-Object {
    "{0}={1}" -f $_.Key, $_.Value
} | Out-Host

& $AdbPath shell "run-as $packageName am stopservice --user 0 -n $packageName/.AlarmVibrationService" | Out-Null

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
if ($failed.Count -gt 0) {
    $summary = ($failed | ForEach-Object Key) -join ", "
    throw "Alarm vibration verification failed: $summary"
}

Write-Host "PASS: reminder starts a persistent vibration-only foreground service"
