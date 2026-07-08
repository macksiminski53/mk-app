# Queries Windows' System Media Transport Controls (the same API that feeds
# the "now playing" widget in the volume flyout) for the current track.
# Prints "Title||Artist" if something is playing, or NOT_PLAYING / NOT_RUNNING.

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

try {
    $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
    Write-Output "NOT_RUNNING"
    exit
}

$sessions = $manager.GetSessions()
if (-not $sessions -or $sessions.Count -eq 0) {
    Write-Output "NOT_RUNNING"
    exit
}

# Prefer a session whose source app looks like Apple Music; otherwise fall back
# to whatever Windows currently considers the "current" session.
$session = $null
foreach ($s in $sessions) {
    if ($s.SourceAppUserModelId -match 'Music') {
        $session = $s
        break
    }
}
if (-not $session) {
    $session = $manager.GetCurrentSession()
}
if (-not $session) {
    Write-Output "NOT_RUNNING"
    exit
}

$playback = $session.GetPlaybackInfo()
$Playing = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
if ($playback.PlaybackStatus -ne $Playing) {
    Write-Output "NOT_PLAYING"
    exit
}

$info = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
if (-not $info -or -not $info.Title) {
    Write-Output "NOT_PLAYING"
    exit
}

Write-Output ($info.Title + "||" + $info.Artist)
