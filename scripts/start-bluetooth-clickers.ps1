param(
    [switch]$CheckOnly,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\test-bluetooth-clickers.ps1" -Control -CheckOnly:$CheckOnly -SelfTest:$SelfTest
