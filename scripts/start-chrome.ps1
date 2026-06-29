param(
    [int]$port = 0,
    [string]$profileDir = ""
)

$ErrorActionPreference = "Stop"

if ($port -eq 0) {
    $port = if ($env:FLOW_CDP_PORT) { [int]$env:FLOW_CDP_PORT } else { 9222 }
}

$projectRoot = Split-Path -Parent $PSScriptRoot

if ($profileDir -eq "") {
    $profileDir = Join-Path $projectRoot ".chrome-profile"
}

# Ensure profileDir is absolute!
if (-not [System.IO.Path]::IsPathRooted($profileDir)) {
    $profileDir = Join-Path $projectRoot $profileDir
}

$flowUrl = "https://labs.google/fx/vi/tools/flow"

# 1. Port safety check: Is the port already occupied?
$conn = Get-NetTCPConnection -LocalPort $port -LocalAddress "127.0.0.1" -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $procId = $conn.OwningProcess
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if ($proc) {
        $cmdLine = $proc.CommandLine
        # If the listening process is Chrome but NOT our profile, abort!
        if ($cmdLine -and ($cmdLine -match "chrome.exe") -and ($cmdLine -notmatch [regex]::Escape($profileDir))) {
            Write-Error "Port $port is occupied by another Chrome instance (personal profile). Please clear the CDP port in workspace settings or use a different port."
            exit 1
        }
    }
}

$chromeAlive = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1
    $chromeAlive = $true
} catch {
    # No debuggable Chrome is listening yet.
}

if ($chromeAlive) {
    $tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2
    $flowTab = $tabs | Where-Object {
        $_.url -like "https://labs.google/fx/vi/tools/flow*"
    } | Select-Object -First 1
    if (-not $flowTab) {
        $encodedFlowUrl = [Uri]::EscapeDataString($flowUrl)
        $null = Invoke-RestMethod `
            -Method Put `
            -Uri "http://127.0.0.1:$port/json/new?$encodedFlowUrl" `
            -TimeoutSec 5
        Write-Host "Opened a new Google Flow tab in the automation profile."
    }
    Write-Host "Chrome automation is already available on port $port."
    exit 0
}

$chromeCandidates = @(@(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if ($chromeCandidates.Count -eq 0) {
    throw "Google Chrome was not found. Install Chrome or edit scripts/start-chrome.ps1 with its path."
}

New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

$arguments = @(
    "--user-data-dir=$profileDir",
    "--remote-debugging-port=$port",
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    $flowUrl
)

$chromePath = $chromeCandidates[0]

Write-Host "Starting dedicated Chrome profile:"
Write-Host "  Profile Dir: $profileDir"
Write-Host "  CDP Port: $port"
Write-Host "  Flow URL: $flowUrl"
Write-Host "  Chrome Exe: $chromePath"

Start-Process -FilePath $chromePath -ArgumentList $arguments
Write-Host "Started the dedicated Flow Chrome profile on port $port."
