[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $WebViewPackage,
    [string] $Version,
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$windows = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$project = (Resolve-Path -LiteralPath (Join-Path $windows '..')).Path
if (!$Version) {
    [xml] $manifest = Get-Content -Raw -LiteralPath (Join-Path $project 'android/AndroidManifest.xml')
    $Version = $manifest.DocumentElement.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
}
if ($Version -notmatch '^\d+\.\d+(?:\.\d+){0,2}$') { throw 'Specify a numeric version such as 2.4.' }
if (!$OutputPath) { $OutputPath = Join-Path $project "MONO-$Version-Windows.zip" }
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$package = (Resolve-Path -LiteralPath $WebViewPackage).Path
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The .NET Framework 64-bit C# compiler is unavailable.' }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-MonoIconFrame([int] $size, [xml] $design) {
    $tile = $design.DocumentElement.SelectSingleNode("*[@id='tile']")
    $mark = $design.DocumentElement.SelectSingleNode("*[@id='mark']")
    $period = $design.DocumentElement.SelectSingleNode("*[@id='period']")
    [Drawing.PointF[]] $points = foreach ($pair in ($mark.GetAttribute('points') -split '\s+')) {
        $x, $y = $pair.Split(',')
        [Drawing.PointF]::new([single] $x, [single] $y)
    }
    $width = [single] $tile.GetAttribute('width')
    $height = [single] $tile.GetAttribute('height')
    $diameter = 2 * [single] $tile.GetAttribute('rx')
    $image = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($image)
    $png = [IO.MemoryStream]::new()
    $outline = [Drawing.Drawing2D.GraphicsPath]::new()
    $tileBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($tile.GetAttribute('fill')))
    $markBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($mark.GetAttribute('fill')))
    $periodBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($period.GetAttribute('fill')))
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.ScaleTransform($size / $width, $size / $height)
        $outline.AddArc(0, 0, $diameter, $diameter, 180, 90)
        $outline.AddArc($width - $diameter, 0, $diameter, $diameter, 270, 90)
        $outline.AddArc($width - $diameter, $height - $diameter, $diameter, $diameter, 0, 90)
        $outline.AddArc(0, $height - $diameter, $diameter, $diameter, 90, 90)
        $outline.CloseFigure()
        $graphics.FillPath($tileBrush, $outline)
        $graphics.FillPolygon($markBrush, $points)
        $graphics.FillRectangle($periodBrush, [single] $period.GetAttribute('x'), [single] $period.GetAttribute('y'),
            [single] $period.GetAttribute('width'), [single] $period.GetAttribute('height'))
        $image.Save($png, [Drawing.Imaging.ImageFormat]::Png)
        return [pscustomobject] @{ Size = $size; Bytes = $png.ToArray() }
    } finally {
        $tileBrush.Dispose()
        $markBrush.Dispose()
        $periodBrush.Dispose()
        $outline.Dispose()
        $png.Dispose()
        $graphics.Dispose()
        $image.Dispose()
    }
}

function Write-MonoIcon([string] $Path, [string] $Artwork) {
    [xml] $design = Get-Content -Raw -LiteralPath $Artwork
    $frames = foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)) {
        New-MonoIconFrame $size $design
    }
    $writer = [IO.BinaryWriter]::new([IO.File]::Create($Path))
    try {
        $writer.Write([uint16] 0)
        $writer.Write([uint16] 1)
        $writer.Write([uint16] $frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = [byte] ($frame.Size % 256)
            $writer.Write($dimension)
            $writer.Write($dimension)
            $writer.Write([byte] 0)
            $writer.Write([byte] 0)
            $writer.Write([uint16] 1)
            $writer.Write([uint16] 32)
            $writer.Write([uint32] $frame.Bytes.Length)
            $writer.Write([uint32] $offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]] $frame.Bytes) }
    } finally { $writer.Dispose() }
}

$build = (New-Item -ItemType Directory -Force -Path (Join-Path $windows '.mono-build')).FullName
$stage = (New-Item -ItemType Directory -Path (Join-Path $build ('run-' + [guid]::NewGuid().ToString('N')))).FullName
try {
    $release = (New-Item -ItemType Directory -Path (Join-Path $stage 'MONO')).FullName
    $sdkFiles = @{
        'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'Microsoft.Web.WebView2.WinForms.dll'
        'build/native/x64/WebView2Loader.dll' = 'WebView2Loader.dll'
        'LICENSE.txt' = 'WebView2-LICENSE.txt'
        'NOTICE.txt' = 'WebView2-NOTICE.txt'
    }
    $archive = [IO.Compression.ZipFile]::OpenRead($package)
    try {
        foreach ($file in $sdkFiles.GetEnumerator()) {
            $entry = $archive.GetEntry($file.Key)
            if (!$entry) { throw "Required SDK file not found: $($file.Key)" }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $release $file.Value))
        }
    } finally { $archive.Dispose() }

    $icon = Join-Path $stage 'MONO.ico'
    Write-MonoIcon $icon (Join-Path $project 'mono-icon.svg')
    $assemblyInfo = Join-Path $stage 'AssemblyInfo.cs'
    $assemblyVersion = [version] $Version
    $fileVersion = '{0}.{1}.{2}.{3}' -f $assemblyVersion.Major, $assemblyVersion.Minor, [Math]::Max(0, $assemblyVersion.Build), [Math]::Max(0, $assemblyVersion.Revision)
    [IO.File]::WriteAllText($assemblyInfo, @"
using System.Reflection;
[assembly: AssemblyTitle("MONO")]
[assembly: AssemblyDescription("MONO Investment Intelligence")]
[assembly: AssemblyProduct("MONO")]
[assembly: AssemblyVersion("$fileVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$Version")]
"@, [Text.UTF8Encoding]::new($false))

    $exe = Join-Path $release 'MONO.exe'
    $nativeManifest = Join-Path $windows 'MONO.manifest'
    $bridge = Join-Path $windows 'vault.js'
    $assets = @('index.html', 'mono-icon.svg', 'styles.css', 'views.css', 'market-chart.css', 'app.mjs', 'model.mjs', 'views.mjs',
        'feed.mjs', 'instruments.mjs', 'public-stock-feed.mjs', 'trend-data.mjs', 'stock-history.mjs',
        'market-chart.mjs', 'chart-navigation.mjs', 'investment-engine.mjs', 'research-data.mjs', 'workspace-analysis.mjs',
        'research-discovery.mjs', 'market-research.mjs', 'quant-lab.mjs', 'model-gateway.mjs',
        'InterVariable.woff2', 'Inter-OFL.txt')
    $arguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001',
        "/out:$exe", "/win32icon:$icon", "/win32manifest:$nativeManifest", "/resource:$bridge,Mono.Windows.Vault",
        '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Security.dll', '/reference:System.Web.Extensions.dll')
    $arguments += @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll') | ForEach-Object { '/reference:' + (Join-Path $release $_) }
    $arguments += $assets | ForEach-Object { '/resource:' + (Join-Path $project $_) + ',Mono.Assets.' + $_ }
    $arguments += @((Join-Path $windows 'Main.cs'), (Join-Path $windows 'AlpacaVault.cs'), (Join-Path $windows 'PublicResearch.cs'), $assemblyInfo)
    & $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw "C# compiler failed with exit code $LASTEXITCODE." }

    Copy-Item -LiteralPath (Join-Path $windows '运行 MONO.txt') -Destination $release
    Copy-Item -LiteralPath (Join-Path $project 'Inter-OFL.txt') -Destination $release
    $zip = Join-Path $stage 'MONO-Windows.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($release, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
    Copy-Item -LiteralPath $zip -Destination $output -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $output
} finally {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ([StringComparer]::OrdinalIgnoreCase.Equals((Split-Path -Parent $resolvedStage), $build) -and
        (Split-Path -Leaf $resolvedStage) -match '^run-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
