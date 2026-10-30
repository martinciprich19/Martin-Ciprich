param([string]$SdkRoot = $env:ANDROID_HOME, [string]$JavaHome = $env:JAVA_HOME)
& "$PSScriptRoot\..\clicker-diagnostic\build.ps1" -SdkRoot $SdkRoot -JavaHome $JavaHome -ProjectRoot $PSScriptRoot -ApkName 'riva-padel-test'
