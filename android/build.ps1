[CmdletBinding()]
param(
    [string] $Jdk = $env:JAVA_HOME,
    [string] $BuildTools,
    [string] $AndroidJar,
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$android = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$project = (Resolve-Path -LiteralPath (Join-Path $android '..')).Path
$sdk = $env:ANDROID_HOME
if (!$sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (!$sdk -and $env:LOCALAPPDATA) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!$BuildTools -and $sdk) { $BuildTools = Join-Path $sdk 'build-tools/35.0.0' }
if (!$AndroidJar -and $sdk) { $AndroidJar = Join-Path $sdk 'platforms/android-35/android.jar' }
if (!$Jdk -or !$BuildTools -or !$AndroidJar) {
    throw 'Provide -Jdk, -BuildTools and -AndroidJar, or configure JAVA_HOME and ANDROID_HOME.'
}
$java = Join-Path $Jdk 'bin/java.exe'
$javac = Join-Path $Jdk 'bin/javac.exe'
$keytool = Join-Path $Jdk 'bin/keytool.exe'
$aapt2 = Join-Path $BuildTools 'aapt2.exe'
$zipalign = Join-Path $BuildTools 'zipalign.exe'
$d8 = Join-Path $BuildTools 'lib/d8.jar'
$signer = Join-Path $BuildTools 'lib/apksigner.jar'
$manifest = Join-Path $android 'AndroidManifest.xml'
$resources = Join-Path $android 'res'
foreach ($required in @($java, $javac, $keytool, $aapt2, $zipalign, $d8, $signer, $AndroidJar, $manifest)) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing Android build input: $required" }
}

[xml] $manifestXml = Get-Content -Raw -LiteralPath $manifest
$package = $manifestXml.DocumentElement.GetAttribute('package')
$androidXmlNs = 'http://schemas.android.com/apk/res/android'
$version = $manifestXml.DocumentElement.GetAttribute('versionName', $androidXmlNs)
$minSdk = $manifestXml.manifest.'uses-sdk'.GetAttribute('minSdkVersion', $androidXmlNs)
if (!$package -or $minSdk -notmatch '^\d+$') { throw 'Specify package and minSdkVersion in AndroidManifest.xml.' }
if (!$OutputPath) {
    if ($version -notmatch '^\d+(\.\d+)*$') { throw 'Specify a numeric versionName or provide -OutputPath.' }
    $OutputPath = Join-Path $project "MONO-$version.apk"
}
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$v1 = ([int] $minSdk -lt 24).ToString().ToLowerInvariant()

function Invoke-MonoBuildTool([string] $Executable, [string[]] $Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Executable) failed with exit code $LASTEXITCODE." }
}

function Get-MonoSigningPassword([string] $Store, [string] $PasswordFile, [string] $Stage) {
    $storeExists = Test-Path -LiteralPath $Store -PathType Leaf
    $passwordExists = Test-Path -LiteralPath $PasswordFile -PathType Leaf
    if ($storeExists -ne $passwordExists) {
        throw 'Restore both files in android/.mono-build/signing to keep previous installs updatable.'
    }
    if ($storeExists) { return [IO.File]::ReadAllText($PasswordFile).Trim() }

    $bytes = [byte[]]::new(32)
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) }
    finally { $random.Dispose() }
    $password = [Convert]::ToBase64String($bytes)
    $stagedSigning = (New-Item -ItemType Directory -Path (Join-Path $Stage 'signing')).FullName
    $stagedStore = Join-Path $stagedSigning (Split-Path -Leaf $Store)
    $stagedPassword = Join-Path $stagedSigning (Split-Path -Leaf $PasswordFile)
    $env:MONO_ANDROID_STORE_PASSWORD = $password
    Invoke-MonoBuildTool $keytool @('-genkeypair', '-keystore', $stagedStore, '-storetype', 'PKCS12', '-alias', 'mono',
        '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=MONO Local Release',
        '-storepass:env', 'MONO_ANDROID_STORE_PASSWORD', '-keypass:env', 'MONO_ANDROID_STORE_PASSWORD') | Out-Null
    [IO.File]::WriteAllText($stagedPassword, $password, [Text.UTF8Encoding]::new($false))
    [IO.Directory]::Move($stagedSigning, (Split-Path -Parent $Store))
    return $password
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$build = (New-Item -ItemType Directory -Force -Path (Join-Path $android '.mono-build')).FullName
$signing = Join-Path $build 'signing'
$stage = (New-Item -ItemType Directory -Path (Join-Path $build ("run-" + [guid]::NewGuid().ToString('N')))).FullName
$previousPassword = $env:MONO_ANDROID_STORE_PASSWORD
try {
    $classesDir = (New-Item -ItemType Directory -Path (Join-Path $stage 'classes')).FullName
    $dexDir = (New-Item -ItemType Directory -Path (Join-Path $stage 'dex')).FullName
    $assets = (New-Item -ItemType Directory -Path (Join-Path $stage 'assets')).FullName
    $generated = (New-Item -ItemType Directory -Path (Join-Path $stage 'generated')).FullName
    foreach ($asset in @('index.html', 'mono-icon.svg', 'app.mjs', 'views.mjs', 'model.mjs', 'feed.mjs', 'instruments.mjs', 'public-stock-feed.mjs', 'stock-history.mjs', 'trend-data.mjs', 'market-chart.mjs', 'chart-navigation.mjs', 'investment-engine.mjs', 'research-data.mjs', 'research-discovery.mjs', 'workspace-analysis.mjs', 'market-research.mjs', 'quant-lab.mjs', 'model-gateway.mjs', 'styles.css', 'views.css', 'market-chart.css', 'InterVariable.woff2', 'Inter-OFL.txt')) {
        Copy-Item -LiteralPath (Join-Path $project $asset) -Destination $assets
    }

    $compiledResources = Join-Path $stage 'resources.zip'
    $unsigned = Join-Path $stage 'unsigned.apk'
    $aligned = Join-Path $stage 'aligned.apk'
    $signed = Join-Path $stage 'signed.apk'
    Invoke-MonoBuildTool $aapt2 @('compile', '--dir', $resources, '-o', $compiledResources)
    Invoke-MonoBuildTool $aapt2 @('link', '--manifest', $manifest, '-I', $AndroidJar, '-A', $assets,
        '--java', $generated, '-o', $unsigned, $compiledResources)

    $sources = @(Get-ChildItem -LiteralPath @((Join-Path $android 'src'), $generated) -Filter '*.java' -Recurse -File | Select-Object -ExpandProperty FullName)
    if (!$sources.Length) { throw 'No Android Java sources found.' }
    Invoke-MonoBuildTool $javac (@('--release', '8', '-encoding', 'UTF-8', '-classpath', $AndroidJar, '-d', $classesDir) + $sources)
    $classes = @(Get-ChildItem -LiteralPath $classesDir -Filter '*.class' -Recurse -File | Select-Object -ExpandProperty FullName)
    Invoke-MonoBuildTool $java (@('-cp', $d8, 'com.android.tools.r8.D8', '--release', '--min-api', $minSdk,
        '--lib', $AndroidJar, '--output', $dexDir) + $classes)

    $archive = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,
            (Join-Path $dexDir 'classes.dex'), 'classes.dex', [IO.Compression.CompressionLevel]::Optimal)
    } finally { $archive.Dispose() }

    $store = Join-Path $signing 'mono.p12'
    $passwordFile = Join-Path $signing 'password.txt'
    $signingLock = [IO.File]::Open((Join-Path $build 'signing.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { $env:MONO_ANDROID_STORE_PASSWORD = Get-MonoSigningPassword $store $passwordFile $stage }
    finally { $signingLock.Dispose() }

    Invoke-MonoBuildTool $zipalign @('-f', '4', $unsigned, $aligned)
    Invoke-MonoBuildTool $java @('-jar', $signer, 'sign', '--ks', $store, '--ks-key-alias', 'mono',
        '--ks-pass', 'env:MONO_ANDROID_STORE_PASSWORD', '--v1-signing-enabled', $v1,
        '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false',
        '--out', $signed, $aligned)
    Invoke-MonoBuildTool $zipalign @('-c', '4', $signed)
    Invoke-MonoBuildTool $java @('-jar', $signer, 'verify', '--verbose', $signed)
    $badging = Invoke-MonoBuildTool $aapt2 @('dump', 'badging', $signed)
    if (!($badging -match "^package: name='$([regex]::Escape($package))'")) { throw 'Unexpected Android package ID.' }
    if (!($badging -match '^launchable-activity:')) { throw 'The APK has no launcher activity.' }

    Copy-Item -LiteralPath $signed -Destination $output -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $output
} finally {
    $env:MONO_ANDROID_STORE_PASSWORD = $previousPassword
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ([StringComparer]::OrdinalIgnoreCase.Equals((Split-Path -Parent $resolvedStage), $build) -and
        (Split-Path -Leaf $resolvedStage) -match '^run-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
