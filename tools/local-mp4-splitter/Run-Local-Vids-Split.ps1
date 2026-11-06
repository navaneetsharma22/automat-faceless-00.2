$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

function Show-Message([string]$Text, [string]$Title, [System.Windows.Forms.MessageBoxIcon]$Icon) {
  [void][System.Windows.Forms.MessageBox]::Show(
    $Text,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $Icon
  )
}

function Quote-ProcessArgument([string]$Value) {
  '"' + $Value.Replace('"', '\"') + '"'
}

function Select-File([string]$Title, [string]$Filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = $Title
  $dialog.Filter = $Filter
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  $dialog.FileName
}

$temporaryFiles = @()
$outputDirectory = $null

try {
  Import-Module (Join-Path $PSScriptRoot 'LocalSplitterProcess.psm1') -Force -ErrorAction Stop
  Write-Host 'Vids local split: choose existing source files and an output parent.' -ForegroundColor Cyan
  Write-Host '[1/5] Select the combined MP4.'
  $inputPath = Select-File 'Select existing combined Vids MP4' 'MP4 video (*.mp4)|*.mp4'
  if (-not $inputPath) { Write-Host 'Canceled; no files were changed.'; exit 0 }

  Write-Host '[2/5] Select the explicit frame-boundary JSON manifest.'
  $manifestPath = Select-File 'Select existing boundary manifest' 'JSON manifest (*.json)|*.json'
  if (-not $manifestPath) { Write-Host 'Canceled; no files were changed.'; exit 0 }

  Write-Host '[3/5] Select a parent folder for a new output directory.'
  $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $folderDialog.Description = 'Choose where a new VidsSplit folder will be created'
  $folderDialog.ShowNewFolderButton = $true
  if ($folderDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Canceled; no files were changed.'
    exit 0
  }
  $outputParent = $folderDialog.SelectedPath

  if ([System.IO.Path]::GetExtension($inputPath) -ine '.mp4') {
    throw 'The selected source must be an .mp4 file.'
  }
  if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    throw 'The selected combined MP4 is missing or is not a regular file.'
  }
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The selected boundary manifest is missing or is not a regular file.'
  }
  if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
    throw 'The selected output parent folder is no longer available.'
  }

  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  } catch {
    throw "Boundary manifest is not valid JSON: $($_.Exception.Message)"
  }
  if ($manifest.version -ne 1 -or -not $manifest.clips -or @($manifest.clips).Count -lt 1) {
    throw 'Boundary manifest must contain version 1 and an explicit, non-empty clips array.'
  }

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
  if (-not $nodeCommand) { throw 'Node.js 20 or newer was not found on PATH. Install Node.js and reopen the launcher.' }
  $nodeVersionText = (& $nodeCommand.Source --version 2>$null | Select-Object -First 1)
  if ($nodeVersionText -notmatch '^v?(\d+)\.') { throw 'Could not read the installed Node.js version.' }
  if ([int]$Matches[1] -lt 20) { throw "Node.js 20 or newer is required; found $nodeVersionText." }

  foreach ($toolName in @('ffmpeg.exe', 'ffprobe.exe')) {
    if (-not (Get-Command $toolName -ErrorAction SilentlyContinue)) {
      throw "$toolName was not found on PATH. Install FFmpeg and add its bin folder to PATH, then reopen the launcher."
    }
  }

  $splitterPath = Join-Path $PSScriptRoot 'split-combined-mp4.mjs'
  if (-not (Test-Path -LiteralPath $splitterPath -PathType Leaf)) {
    throw "The existing splitter CLI is missing: $splitterPath"
  }

  $outputName = 'VidsSplit-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
  $outputDirectory = Join-Path $outputParent $outputName
  New-Item -ItemType Directory -Path $outputDirectory -ErrorAction Stop | Out-Null
  if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    throw 'Could not create the new split output directory.'
  }

  $arguments = @(
    (Quote-ProcessArgument $splitterPath),
    '--input', (Quote-ProcessArgument $inputPath),
    '--manifest', (Quote-ProcessArgument $manifestPath),
    '--output-dir', (Quote-ProcessArgument $outputDirectory)
  ) -join ' '

  Write-Host '[4/5] Running the existing splitter. It validates frame boundaries, encodes each clip, and verifies results with ffprobe.' -ForegroundColor Yellow
  Write-Host "Output folder: $outputDirectory"
  $processResult = Invoke-LocalSplitterProcess -FilePath $nodeCommand.Source -Arguments $arguments
  Assert-LocalSplitterExitCode -ProcessResult $processResult -OutputDirectory $outputDirectory

  try {
    $splitterResult = $processResult.Stdout | ConvertFrom-Json
  } catch {
    throw "Splitter completed but returned invalid verification JSON: $($_.Exception.Message)`nOutput folder: $outputDirectory"
  }
  Assert-LocalSplitterSummary -Summary $splitterResult -OutputDirectory $outputDirectory
  $splitOutputs = @($splitterResult.outputs)

  $verification = [ordered]@{
    schemaVersion = 1
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    inputPath = [System.IO.Path]::GetFullPath($inputPath)
    boundaryManifestPath = [System.IO.Path]::GetFullPath($manifestPath)
    verification = $splitterResult
  }
  $verificationPath = Join-Path $outputDirectory 'verification-results.json'
  if (Test-Path -LiteralPath $verificationPath) {
    throw "Refusing to overwrite existing verification results: $verificationPath"
  }
  $json = $verification | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($verificationPath, $json, [System.Text.UTF8Encoding]::new($false))
  if (-not (Test-Path -LiteralPath $verificationPath -PathType Leaf)) {
    throw "Verification summary was not persisted: $verificationPath"
  }
  try {
    $persisted = Get-Content -LiteralPath $verificationPath -Raw | ConvertFrom-Json
  } catch {
    throw "Persisted verification summary could not be read as JSON: $($_.Exception.Message)`nFile: $verificationPath"
  }
  if (
    $persisted.verification.sourceRetained -ne $true -or
    $persisted.inputPath -cne [System.IO.Path]::GetFullPath($inputPath) -or
    $persisted.boundaryManifestPath -cne [System.IO.Path]::GetFullPath($manifestPath) -or
    @($persisted.verification.outputs).Count -ne $splitOutputs.Count
  ) {
    throw "Persisted verification summary failed its read-back check: $verificationPath"
  }
  Assert-LocalSplitterSummary -Summary $persisted.verification -OutputDirectory $outputDirectory
  for ($index = 0; $index -lt $splitOutputs.Count; $index++) {
    if (
      $persisted.verification.outputs[$index].filename -cne $splitOutputs[$index].filename -or
      $persisted.verification.outputs[$index].path -cne $splitOutputs[$index].path -or
      $persisted.verification.outputs[$index].expectedVideoFrameCount -ne $splitOutputs[$index].expectedVideoFrameCount -or
      $persisted.verification.outputs[$index].verifiedDurationSeconds -ne $splitOutputs[$index].verifiedDurationSeconds -or
      $persisted.verification.outputs[$index].audioStreamVerified -ne $splitOutputs[$index].audioStreamVerified
    ) {
      throw "Persisted verification summary differs from splitter output for '$($splitOutputs[$index].filename)': $verificationPath"
    }
  }

  Write-Host '[5/5] Complete; splitter verification summary retained.' -ForegroundColor Green
  foreach ($output in $splitterResult.outputs) {
    Write-Host ("{0}: {1} seconds, {2} video frames, audio verified={3}`n  {4}" -f $output.filename, $output.verifiedDurationSeconds, $output.expectedVideoFrameCount, $output.audioStreamVerified, $output.path)
  }
  Write-Host "Verification results: $verificationPath"
  $outputSummary = $splitterResult.outputs | ForEach-Object {
    '{0} — {1}s — {2}' -f $_.filename, $_.verifiedDurationSeconds, $_.path
  }
  Show-Message ("Split and local verification completed.`n`n" + ($outputSummary -join "`n") + "`n`nVerification results:`n$verificationPath") 'Vids local split complete' ([System.Windows.Forms.MessageBoxIcon]::Information)
  exit 0
} catch {
  Write-Progress -Activity 'Splitting and verifying local MP4' -Completed -ErrorAction SilentlyContinue
  $message = $_.Exception.Message
  Write-Host "FAILED: $message" -ForegroundColor Red
  if ($outputDirectory) { Write-Host "Any completed files and diagnostics remain in: $outputDirectory" -ForegroundColor Yellow }
  Show-Message $message 'Vids local split failed' ([System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}
