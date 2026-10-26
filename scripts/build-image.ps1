# Build the browser image from PowerShell.
# Uses Docker Desktop if `docker` is on PATH, otherwise Docker Engine in the WSL distro Ubuntu-24.04.
#
#   .\scripts\build-image.ps1 [-Tag enclave-browser:dev]
param([string]$Tag = "enclave-browser:dev")
$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "build-image.sh"
if (Get-Command docker -ErrorAction SilentlyContinue) {
    bash $script $Tag
} else {
    $wslPath = (wsl -d Ubuntu-24.04 wslpath -a ($script -replace '\\', '/')).Trim()
    wsl -d Ubuntu-24.04 -u root -- bash $wslPath $Tag
}
exit $LASTEXITCODE
