param([int]$Port = 4173)

$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

function Send-Response {
    param($Client, [int]$Status, [byte[]]$Body, [string]$ContentType = 'text/plain; charset=utf-8')
    $reason = if ($Status -eq 200) { 'OK' } elseif ($Status -eq 404) { 'Not Found' } else { 'Bad Request' }
    $header = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $stream = $Client.GetStream()
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length) { $stream.Write($Body, 0, $Body.Length) }
    $stream.Flush()
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch {
    Write-Host "Port $Port is already in use. Opening the existing address..." -ForegroundColor Yellow
    Start-Process "http://127.0.0.1:$Port/"
    Read-Host 'If Party Cats did not open, close the program using this port and retry. Press Enter to exit'
    exit 1
}

$url = "http://127.0.0.1:$Port/"
Clear-Host
Write-Host 'Party Cats is running' -ForegroundColor Green
Write-Host "Address: $url"
Write-Host 'No network, login, or activation is required. Close this window to stop.' -ForegroundColor Cyan
Write-Host ''
Start-Process $url

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $reader = [IO.StreamReader]::new($client.GetStream(), [Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            while (($line = $reader.ReadLine()) -ne $null -and $line -ne '') { }
            if (-not $requestLine -or $requestLine -notmatch '^(GET|HEAD)\s+([^\s]+)\s+HTTP/') {
                Send-Response $client 400 ([Text.Encoding]::UTF8.GetBytes('Bad Request'))
                continue
            }

            $method = $Matches[1]
            $rawPath = ($Matches[2] -split '\?')[0]
            $relative = [Uri]::UnescapeDataString($rawPath).TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
            $filePath = [IO.Path]::GetFullPath((Join-Path $siteRoot $relative))

            if (-not $filePath.StartsWith($siteRoot, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($filePath)) {
                Send-Response $client 404 ([Text.Encoding]::UTF8.GetBytes('Not Found'))
                continue
            }

            $body = if ($method -eq 'HEAD') { [byte[]]::new(0) } else { [IO.File]::ReadAllBytes($filePath) }
            $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
            $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
            Send-Response $client 200 $body $contentType
        } catch {
            # A browser may cancel speculative requests; keep serving the game.
        } finally {
            $client.Dispose()
        }
    }
} finally {
    $listener.Stop()
}
