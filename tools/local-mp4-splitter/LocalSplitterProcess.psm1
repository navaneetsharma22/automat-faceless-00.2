function Invoke-LocalSplitterProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [string]$ProgressActivity = 'Splitting and verifying local MP4',
    [string]$ProgressStatus = 'Checking explicit boundaries, encoding clips, and verifying with ffprobe.'
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      throw "Could not start child process: $FilePath"
    }

    # Read both redirected pipes asynchronously so a full stderr buffer cannot block exit.
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    while (-not $process.WaitForExit(500)) {
      Write-Progress -Activity $ProgressActivity -Status $ProgressStatus
    }
    $process.WaitForExit()
    $process.Refresh()

    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) {
      throw 'Child process exited, but Windows did not provide a numeric exit code.'
    }

    return [pscustomobject]@{
      ExitCode = [int]$exitCode
      Stdout   = $stdoutTask.GetAwaiter().GetResult()
      Stderr   = $stderrTask.GetAwaiter().GetResult()
    }
  } finally {
    Write-Progress -Activity $ProgressActivity -Completed -ErrorAction SilentlyContinue
    $process.Dispose()
  }
}

function Assert-LocalSplitterSummary {
  param(
    [Parameter(Mandatory = $true)][object]$Summary,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
  )

  if ($Summary.sourceRetained -ne $true) {
    throw 'Splitter summary does not confirm that the combined source was retained.'
  }
  $outputs = @($Summary.outputs)
  if ($outputs.Count -lt 1) {
    throw 'Splitter summary contains no output clips.'
  }

  $numericTypeCodes = @(
    [TypeCode]::SByte, [TypeCode]::Byte, [TypeCode]::Int16, [TypeCode]::UInt16,
    [TypeCode]::Int32, [TypeCode]::UInt32, [TypeCode]::Int64, [TypeCode]::UInt64,
    [TypeCode]::Single, [TypeCode]::Double, [TypeCode]::Decimal
  )
  $outputDirectoryFullPath = [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

  foreach ($output in $outputs) {
    if ([string]::IsNullOrWhiteSpace($output.filename) -or [string]::IsNullOrWhiteSpace($output.path)) {
      throw 'Splitter summary is missing an output filename or path.'
    }
    if ($output.expectedVideoFrameCount -isnot [int] -or $output.expectedVideoFrameCount -lt 1) {
      throw "Splitter summary has an invalid video frame count for '$($output.filename)'."
    }
    foreach ($durationField in @('expectedDurationSeconds', 'verifiedDurationSeconds')) {
      $duration = $output.$durationField
      if (
        $null -eq $duration -or
        $numericTypeCodes -notcontains [Type]::GetTypeCode($duration.GetType()) -or
        [double]$duration -le 0 -or
        [double]::IsNaN([double]$duration) -or
        [double]::IsInfinity([double]$duration)
      ) {
        throw "Splitter summary has an invalid $durationField for '$($output.filename)'."
      }
    }
    if ($output.audioStreamVerified -isnot [bool]) {
      throw "Splitter summary has no audio stream verification state for '$($output.filename)'."
    }
    $outputFullPath = [System.IO.Path]::GetFullPath($output.path)
    if (-not $outputFullPath.StartsWith($outputDirectoryFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Splitter summary output is outside the selected output folder: $outputFullPath"
    }
    if (-not (Test-Path -LiteralPath $outputFullPath -PathType Leaf)) {
      throw "Splitter summary output file is missing: $outputFullPath"
    }
    $file = Get-Item -LiteralPath $outputFullPath
    if ($file.Length -le 0 -or ($output.bytes -is [int] -and $file.Length -ne $output.bytes)) {
      throw "Splitter summary size does not match the output file: $outputFullPath"
    }
  }
}

function Assert-LocalSplitterExitCode {
  param(
    [Parameter(Mandatory = $true)][object]$ProcessResult,
    [string]$OutputDirectory
  )

  if ($ProcessResult.ExitCode -isnot [int]) {
    throw 'Splitter process result did not contain a numeric exit code.'
  }
  if ($ProcessResult.ExitCode -eq 0) { return }

  $failureStreams = @()
  if (-not [string]::IsNullOrWhiteSpace($ProcessResult.Stderr)) {
    $failureStreams += "STDERR:`n$($ProcessResult.Stderr.Trim())"
  }
  if (-not [string]::IsNullOrWhiteSpace($ProcessResult.Stdout)) {
    $failureStreams += "STDOUT:`n$($ProcessResult.Stdout.Trim())"
  }
  if ($failureStreams.Count -eq 0) { $failureStreams = @('Child process returned no diagnostic text.') }
  $message = "Splitter failed with exit code $($ProcessResult.ExitCode).`n$($failureStreams -join "`n")"
  if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $message += "`nOutput folder retained for diagnosis: $OutputDirectory"
  }
  throw $message
}

Export-ModuleMember -Function Invoke-LocalSplitterProcess, Assert-LocalSplitterSummary, Assert-LocalSplitterExitCode
