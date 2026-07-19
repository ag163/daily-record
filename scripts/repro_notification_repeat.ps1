param(
    [string]$ApkPath = "",
    [string]$AdbPath = "D:\Android\Sdk\platform-tools\adb.exe"
)

$ErrorActionPreference = "Stop"
$packageName = "com.dailyrecord.app"

if (-not (Test-Path -LiteralPath $AdbPath)) {
    throw "adb not found: $AdbPath"
}

if ((& $AdbPath get-state 2>$null).Trim() -ne "device") {
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

function Get-ReminderRecord {
    $dump = (& $AdbPath shell dumpsys notification --noredact) -join "`n"
    $pattern = "(?s)NotificationRecord\([^\n]*pkg=$([regex]::Escape($packageName))[^\n]*id=5101.*?(?=\n\s*NotificationRecord\(|\n\s*Notification attention state:)"
    return [regex]::Match($dump, $pattern).Value
}

function Get-CurrentVibration {
    $dump = (& $AdbPath shell dumpsys vibrator_manager) -join "`n"
    return [regex]::Match(
        $dump,
        "(?s)CurrentVibration:.*?(?=\r?\n\s*NextVibration:)"
    ).Value
}

function Test-AppVibrationRunning([string]$currentVibration) {
    return (
        $currentVibration -match "status = running" -and
        $currentVibration -match "opPkg=$([regex]::Escape($packageName))" -and
        $currentVibration -match "mUsage=ALARM"
    )
}

& $AdbPath shell am force-stop $packageName | Out-Null
& $AdbPath shell "run-as $packageName mkdir -p shared_prefs" | Out-Null
& $AdbPath shell "run-as $packageName sh -c 'echo $base64 | base64 -d > shared_prefs/daily_record.xml'" | Out-Null
& $AdbPath shell am start -n "$packageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 1

& $AdbPath shell "run-as $packageName am broadcast --user 0 -a com.dailyrecord.app.action.MAIN_REMINDER -n $packageName/.ReminderReceiver" | Out-Null
Start-Sleep -Milliseconds 1200

$record = Get-ReminderRecord
if (-not $record) {
    throw "Initial reminder notification not found"
}

$fullScreenRecord = [regex]::Match(
    $record,
    "fullscreenIntent=.*?PendingIntentRecord\{([0-9a-f]+)"
).Groups[1].Value
$contentRecord = [regex]::Match(
    $record,
    "contentIntent=.*?PendingIntentRecord\{([0-9a-f]+)"
).Groups[1].Value
$packageDump = (& $AdbPath shell dumpsys package $packageName) -join "`n"
$initialVibration = Test-AppVibrationRunning (Get-CurrentVibration)

# Reproduce the Redmi symptom where notification interaction/system policy
# cancels the motor while the foreground service process remains alive.
& $AdbPath shell cmd vibrator_manager cancel | Out-Null
Start-Sleep -Milliseconds 400
& $AdbPath shell "run-as $packageName am broadcast --user 0 -a com.dailyrecord.app.action.MAIN_REMINDER -n $packageName/.ReminderReceiver" | Out-Null
Start-Sleep -Milliseconds 1200

$checks = [ordered]@{
    initialVibration = $initialVibration
    notificationTapUsesMainApp = (
        $fullScreenRecord -and
        $contentRecord -and
        $fullScreenRecord -ne $contentRecord -and
        $packageDump -notmatch "AlarmActivity"
    )
    secondVibrationRestarts = Test-AppVibrationRunning (Get-CurrentVibration)
}

$checks.GetEnumerator() | ForEach-Object {
    "{0}={1}" -f $_.Key, $_.Value
} | Out-Host

& $AdbPath shell "run-as $packageName am stopservice --user 0 -n $packageName/.AlarmVibrationService" | Out-Null

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
if ($failed.Count -gt 0) {
    $summary = ($failed | ForEach-Object Key) -join ", "
    throw "Notification/repeat regression reproduced: $summary"
}

Write-Host "PASS: notification tap opens the main app and every trigger restarts vibration"
