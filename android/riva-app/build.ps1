param(
    [string]$SdkRoot = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path $PSScriptRoot).Path
if (!$SdkRoot -or !$JavaHome) {
    throw 'Provide -SdkRoot (Android SDK with platform 35/build-tools 35.0.0) and -JavaHome (JDK 17).'
}
$SdkRoot = (Resolve-Path $SdkRoot).Path
$JavaHome = (Resolve-Path $JavaHome).Path
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:PATH = "$JavaHome\bin;$env:PATH"

$googleServices = Join-Path $ProjectRoot 'app\google-services.json'
if (!(Test-Path -LiteralPath $googleServices -PathType Leaf)) {
    throw 'Missing android\riva-app\app\google-services.json. Register sk.rivapadel.apptest as an Android app in the existing Firebase project and save its config here.'
}

$sdkTools = Join-Path $SdkRoot 'build-tools\35.0.0'
foreach ($file in @("$JavaHome\bin\java.exe", "$sdkTools\apksigner.bat", "$sdkTools\aapt2.exe")) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing build tool: $file" }
}

$gradleVersion = '8.9'
$gradleHome = Join-Path $env:LOCALAPPDATA "RivaAndroidTools\gradle-$gradleVersion"
$gradle = Join-Path $gradleHome "gradle-$gradleVersion\bin\gradle.bat"
if (!(Test-Path -LiteralPath $gradle -PathType Leaf)) {
    $cache = Join-Path $env:LOCALAPPDATA 'RivaAndroidTools\gradle-cache'
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $archive = Join-Path $cache "gradle-$gradleVersion-bin.zip"
    $distribution = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
    Invoke-WebRequest -Uri $distribution -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $gradleHome -Force
    Remove-Item -LiteralPath $archive
}
if (!(Test-Path -LiteralPath $gradle -PathType Leaf)) { throw "Gradle $gradleVersion was not installed correctly." }

$key = Join-Path $env:LOCALAPPDATA 'RivaAndroidTools\diagnostic-debug.keystore'
if (!(Test-Path -LiteralPath $key -PathType Leaf)) {
    throw "Missing existing debug signing key: $key"
}

Push-Location $ProjectRoot
try {
    & $gradle --no-daemon --stacktrace :app:assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$apk = Join-Path $ProjectRoot 'dist\riva-padel-test.apk'
New-Item -ItemType Directory -Force -Path (Split-Path $apk) | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'app\build\outputs\apk\debug\app-debug.apk') -Destination $apk -Force
& "$sdkTools\apksigner.bat" verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
& "$sdkTools\aapt2.exe" dump badging $apk
if ($LASTEXITCODE -ne 0) { throw 'APK metadata verification failed.' }
Get-FileHash -Algorithm SHA256 -LiteralPath $apk
Write-Output "APK ready: $apk"
