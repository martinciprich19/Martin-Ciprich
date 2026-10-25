param(
    [string]$SdkRoot = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
if (!$SdkRoot -or !$JavaHome) {
    throw 'Provide -SdkRoot (Android SDK with platform 35/build-tools 35.0.0) and -JavaHome (JDK 17).'
}
$SdkRoot = (Resolve-Path $SdkRoot).Path
$JavaHome = (Resolve-Path $JavaHome).Path
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"
$tools = Join-Path $SdkRoot 'build-tools\35.0.0'
$platform = Join-Path $SdkRoot 'platforms\android-35\android.jar'
$build = Join-Path $PSScriptRoot 'build'
$output = Join-Path $PSScriptRoot 'dist'
foreach ($file in @("$JavaHome\bin\javac.exe", "$tools\aapt2.exe", "$tools\d8.bat", "$tools\apksigner.bat", $platform)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing build tool: $file" }
}
foreach ($folder in @($build, "$build\classes", "$build\dex", $output)) {
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
}
function Invoke-Checked([string]$Tool, [string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Tool failed with exit code $LASTEXITCODE" }
}
Invoke-Checked "$tools\aapt2.exe" @('compile', '--dir', "$PSScriptRoot\res", '-o', "$build\resources.zip")
Invoke-Checked "$tools\aapt2.exe" @('link', '-o', "$build\unsigned.apk",
    '-I', $platform, '--manifest', "$PSScriptRoot\AndroidManifest.xml", "$build\resources.zip")
Invoke-Checked "$JavaHome\bin\javac.exe" @('-encoding', 'UTF-8', '--release', '8',
    '-classpath', $platform, '-d', "$build\classes", "$PSScriptRoot\src\sk\rivapadel\clickerdiagnostic\MainActivity.java")
Invoke-Checked "$JavaHome\bin\jar.exe" @('cf', "$build\classes.jar", '-C', "$build\classes", '.')
Invoke-Checked "$tools\d8.bat" @('--min-api', '23', '--lib', $platform, '--output', "$build\dex", "$build\classes.jar")
Invoke-Checked "$JavaHome\bin\jar.exe" @('uf', "$build\unsigned.apk", '-C', "$build\dex", 'classes.dex')
Invoke-Checked "$tools\zipalign.exe" @('-f', '4', "$build\unsigned.apk", "$build\aligned.apk")
$keyFolder = Join-Path $env:LOCALAPPDATA 'RivaAndroidTools'
New-Item -ItemType Directory -Force -Path $keyFolder | Out-Null
$key = Join-Path $keyFolder 'diagnostic-debug.keystore'
if (!(Test-Path -LiteralPath $key)) {
    Invoke-Checked "$JavaHome\bin\keytool.exe" @('-genkeypair', '-keystore', $key, '-storepass', 'android',
        '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '3650', '-dname', 'CN=RIVA Diagnostic Debug,O=RIVA,C=SK')
}
$apk = Join-Path $output 'riva-clicker-test.apk'
Invoke-Checked "$tools\apksigner.bat" @('sign', '--ks', $key, '--ks-key-alias', 'androiddebugkey',
    '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $apk, "$build\aligned.apk")
Invoke-Checked "$tools\apksigner.bat" @('verify', '--verbose', $apk)
Invoke-Checked "$tools\aapt2.exe" @('dump', 'badging', $apk)
Get-FileHash -Algorithm SHA256 -LiteralPath $apk
Write-Output "APK ready: $apk"
