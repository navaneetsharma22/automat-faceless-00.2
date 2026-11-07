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

function Confirm-FixedDurationPlan([object]$Plan, [string]$SelectedSourcePath) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Review fixed-duration split plan'
  $form.StartPosition = 'CenterScreen'
  $form.Width = 780
  $form.Height = 730
  $form.MinimizeBox = $false
  $form.MaximizeBox = $false

  $summary = New-Object System.Windows.Forms.Label
  $summary.Left = 16; $summary.Top = 16; $summary.Width = 730; $summary.Height = 164
  $summary.Text = ('Source video duration: {0:N3}s; {1} decoded frames; {2}x{3}; timestamp-derived average frame rate {4:N3} fps.' -f $Plan.sourceDurationSeconds, $Plan.sourceFrameCount, $Plan.sourceWidth, $Plan.sourceHeight, $Plan.timestampDerivedAverageFrameRate) + "`r`n" +
    ('Requested: {0:N3}s per clip; expected clips: {1}; proposed clips: {2}.' -f $Plan.secondsPerClip, $Plan.expectedClipCount, $Plan.actualClipCount) + "`r`n" +
    ('Vids document: {0}; attempt: {1}; Chrome download ID: {2}.' -f $Plan.documentId, $Plan.downloadAttemptId, $Plan.chromeDownloadId)
  if ($Plan.hasShortRemainder) { $summary.Text += "`r`nShort final remainder included: $([Math]::Round([double]$Plan.remainderSeconds, 3))s." }
  if ([double]$Plan.footageBeyondExpectedSeconds -gt 0.000001) { $summary.Text += "`r`nFootage beyond expected total duration: $([Math]::Round([double]$Plan.footageBeyondExpectedSeconds, 3))s; it remains included in proposed ranges." }
  if ($Plan.countMismatch) { $summary.Text += "`r`nCOUNT MISMATCH: expected $($Plan.expectedClipCount), proposed $($Plan.actualClipCount)." }
  $selectedFileName = [System.IO.Path]::GetFileName($SelectedSourcePath)
  $sourceNameMismatch = $Plan.sourceFileName -and $Plan.sourceFileName -cne $selectedFileName
  if ($Plan.sourceFileName) { $summary.Text += "`r`nSettings source filename: '$($Plan.sourceFileName)'; selected: '$selectedFileName'." }
  $form.Controls.Add($summary)

  $rangeList = New-Object System.Windows.Forms.TextBox
  $rangeList.Left = 16; $rangeList.Top = 184; $rangeList.Width = 730; $rangeList.Height = 380
  $rangeList.Multiline = $true; $rangeList.ReadOnly = $true; $rangeList.ScrollBars = 'Vertical'; $rangeList.WordWrap = $false
  $rangeList.Font = New-Object System.Drawing.Font('Consolas', 9)
  $rangeList.Text = (($Plan.clips | ForEach-Object {
    '{0}: frames [{1}, {2})  {3:N6}s – {4:N6}s  duration {5:N6}s  ({6} frames)' -f $_.name, $_.startFrameIndex, $_.endFrameIndexExclusive, $_.startSeconds, $_.endSeconds, $_.durationSeconds, $_.expectedFrameCount
  }) -join "`r`n")
  $form.Controls.Add($rangeList)

  $requiresChoice = [bool]$Plan.hasShortRemainder -or [bool]$Plan.countMismatch -or [double]$Plan.footageBeyondExpectedSeconds -gt 0.000001 -or [bool]$sourceNameMismatch
  $ack = New-Object System.Windows.Forms.CheckBox
  $ack.Left = 16; $ack.Top = 570; $ack.Width = 730; $ack.Height = 42
  $ack.Text = 'I choose to include all source footage using the actual proposed frame-aligned ranges shown above and have reviewed any count, remainder, or source-name warning.'
  $ack.Visible = $requiresChoice
  $form.Controls.Add($ack)

  $confirm = New-Object System.Windows.Forms.Button
  $confirm.Left = 390; $confirm.Top = 625; $confirm.Width = 230; $confirm.Height = 30
  $confirm.Text = if ($requiresChoice) { "Proceed with $($Plan.actualClipCount) clips" } else { 'Confirm and split' }
  $confirm.Enabled = -not $requiresChoice
  $confirm.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Controls.Add($confirm)
  if ($requiresChoice) { $ack.Add_CheckedChanged({ $confirm.Enabled = $ack.Checked }) }

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Left = 630; $cancel.Top = 625; $cancel.Width = 116; $cancel.Height = 30
  $cancel.Text = 'Cancel'
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.Controls.Add($cancel)
  $form.AcceptButton = $confirm
  $form.CancelButton = $cancel
  $dialogResult = $form.ShowDialog()
  $form.Dispose()
  return $dialogResult -eq [System.Windows.Forms.DialogResult]::OK
}

$temporaryFiles = @()
$outputDirectory = $null

try {
  Import-Module (Join-Path $PSScriptRoot 'LocalSplitterProcess.psm1') -Force -ErrorAction Stop
  Write-Host 'Vids local split: choose existing source files and an output parent.' -ForegroundColor Cyan
  Write-Host '[1/5] Select the combined MP4.'
  $inputPath = Select-File 'Select existing combined Vids MP4' 'MP4 video (*.mp4)|*.mp4'
  if (-not $inputPath) { Write-Host 'Canceled; no files were changed.'; exit 0 }

  Write-Host '[2/5] Select a measured-boundary manifest or fixed-duration settings JSON.'
  $manifestPath = Select-File 'Select split manifest or fixed-duration settings' 'JSON manifest/settings (*.json)|*.json'
  if (-not $manifestPath) { Write-Host 'Canceled; no files were changed.'; exit 0 }

  if ([System.IO.Path]::GetExtension($inputPath) -ine '.mp4') {
    throw 'The selected source must be an .mp4 file.'
  }
  if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    throw 'The selected combined MP4 is missing or is not a regular file.'
  }
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The selected boundary manifest is missing or is not a regular file.'
  }
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  } catch {
    throw "Boundary manifest is not valid JSON: $($_.Exception.Message)"
  }
  $fixedDurationMode = $manifest.version -eq 1 -and $manifest.mode -eq 'fixed_duration'
  if ($fixedDurationMode) {
    if ($manifest.sourceDownload.provider -ne 'Vids' -or -not $manifest.sourceDownload.documentId -or
      [double]$manifest.secondsPerClip -le 0 -or [int]$manifest.expectedClipCount -lt 1) {
      throw 'Fixed-duration settings are missing their Vids download binding, duration, or expected count.'
    }
  } elseif ($manifest.version -ne 1 -or -not $manifest.clips -or @($manifest.clips).Count -lt 1) {
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

  $fixedDurationPlan = $null
  if ($fixedDurationMode) {
    Write-Host '[3/7] Probing source video timestamps and proposing frame-aligned duration ranges.' -ForegroundColor Yellow
    $planArguments = @(
      (Quote-ProcessArgument $splitterPath),
      '--input', (Quote-ProcessArgument $inputPath),
      '--settings', (Quote-ProcessArgument $manifestPath),
      '--plan'
    ) -join ' '
    $planProcess = Invoke-LocalSplitterProcess -FilePath $nodeCommand.Source -Arguments $planArguments -ProgressStatus 'Probing local source frames and preparing preview.'
    Assert-LocalSplitterExitCode -ProcessResult $planProcess
    try { $fixedDurationPlan = $planProcess.Stdout | ConvertFrom-Json }
    catch { throw "The local media probe returned invalid plan JSON: $($_.Exception.Message)" }
    if (-not $fixedDurationPlan.clips -or @($fixedDurationPlan.clips).Count -lt 1) { throw 'The local media probe produced no split ranges.' }
    if (-not (Confirm-FixedDurationPlan $fixedDurationPlan $inputPath)) { Write-Host 'Canceled at preview; no outputs were created.'; exit 0 }
  }

  $parentProgress = if ($fixedDurationMode) { '[5/7]' } else { '[3/5]' }
  Write-Host "$parentProgress Select a parent folder for a new output directory."
  $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $folderDialog.Description = 'Choose where a new VidsSplit folder will be created'
  $folderDialog.ShowNewFolderButton = $true
  if ($folderDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Canceled; no files were changed.'
    exit 0
  }
  $outputParent = $folderDialog.SelectedPath
  if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
    throw 'The selected output parent folder is no longer available.'
  }

  $outputName = 'VidsSplit-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
  $outputDirectory = Join-Path $outputParent $outputName
  New-Item -ItemType Directory -Path $outputDirectory -ErrorAction Stop | Out-Null
  if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    throw 'Could not create the new split output directory.'
  }

  $splitManifestPath = $manifestPath
  if ($fixedDurationMode) {
    $splitManifestPath = Join-Path $outputDirectory 'generated-fixed-duration-ranges.json'
    $generatedManifest = [ordered]@{
      version = 1
      mode = 'fixed_duration'
      sourceDownload = $manifest.sourceDownload
      secondsPerClip = $fixedDurationPlan.secondsPerClip
      expectedClipCount = $fixedDurationPlan.expectedClipCount
      actualClipCount = $fixedDurationPlan.actualClipCount
      rangeGeneration = 'source_frame_timestamps'
      sourceFrameCount = $fixedDurationPlan.sourceFrameCount
      timestampDerivedAverageFrameRate = $fixedDurationPlan.timestampDerivedAverageFrameRate
      sourceWidth = $fixedDurationPlan.sourceWidth
      sourceHeight = $fixedDurationPlan.sourceHeight
      includedShortRemainder = $fixedDurationPlan.hasShortRemainder
      remainderSeconds = $fixedDurationPlan.remainderSeconds
      clips = @($fixedDurationPlan.clips | ForEach-Object {
        [ordered]@{ name = $_.name; startFrameIndex = $_.startFrameIndex; endFrameIndexExclusive = $_.endFrameIndexExclusive; startSeconds = $_.startSeconds; endSeconds = $_.endSeconds }
      })
    }
    $generatedJson = $generatedManifest | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($splitManifestPath, $generatedJson, [System.Text.UTF8Encoding]::new($false))
  }

  $arguments = @(
    (Quote-ProcessArgument $splitterPath),
    '--input', (Quote-ProcessArgument $inputPath),
    '--manifest', (Quote-ProcessArgument $splitManifestPath),
    '--output-dir', (Quote-ProcessArgument $outputDirectory)
  ) -join ' '

  $splitProgress = if ($fixedDurationMode) { '[6/7]' } else { '[4/5]' }
  $completeProgress = if ($fixedDurationMode) { '[7/7]' } else { '[5/5]' }
  Write-Host "$splitProgress Running the existing splitter. It validates frame boundaries, encodes each clip, and verifies results with ffprobe." -ForegroundColor Yellow
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
  if ($fixedDurationMode -and @($splitOutputs | Where-Object { $_.frameCadenceVerified -ne $true }).Count -gt 0) {
    throw 'Fixed-duration output did not verify source frame cadence for every clip.'
  }

  $verification = [ordered]@{
    schemaVersion = 1
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    inputPath = [System.IO.Path]::GetFullPath($inputPath)
    boundaryManifestPath = [System.IO.Path]::GetFullPath($manifestPath)
    generatedRangesPath = if ($fixedDurationMode) { [System.IO.Path]::GetFullPath($splitManifestPath) } else { $null }
    fixedDurationPlan = $fixedDurationPlan
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
      $persisted.verification.outputs[$index].frameCadenceVerified -ne $splitOutputs[$index].frameCadenceVerified -or
      $persisted.verification.outputs[$index].audioStreamVerified -ne $splitOutputs[$index].audioStreamVerified
    ) {
      throw "Persisted verification summary differs from splitter output for '$($splitOutputs[$index].filename)': $verificationPath"
    }
  }

  Write-Host "$completeProgress Complete; splitter verification summary retained." -ForegroundColor Green
  foreach ($output in $splitterResult.outputs) {
    Write-Host ("{0}: {1} seconds, {2} video frames, cadence verified={3}, audio verified={4}`n  {5}" -f $output.filename, $output.verifiedDurationSeconds, $output.expectedVideoFrameCount, $output.frameCadenceVerified, $output.audioStreamVerified, $output.path)
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
