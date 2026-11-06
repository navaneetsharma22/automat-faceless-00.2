$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\..\tools\local-mp4-splitter\LocalSplitterProcess.psm1'
Import-Module (Resolve-Path -LiteralPath $modulePath).Path -Force
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$temporaryDirectory = Join-Path $env:TEMP ('local-splitter-process-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

function Write-NodeFixture([string]$Name, [string]$Source) {
  $path = Join-Path $temporaryDirectory $Name
  [System.IO.File]::WriteAllText($path, $Source, [System.Text.UTF8Encoding]::new($false))
  '"' + $path + '"'
}

function Quote-TestArgument([string]$Value) {
  '"' + $Value.Replace('"', '\"') + '"'
}

function Assert-Equal($Expected, $Actual, [string]$Label) {
  if ($Expected -cne $Actual) {
    throw "$Label mismatch. Expected '$Expected'; received '$Actual'."
  }
}

try {
  $cityPath = Join-Path $temporaryDirectory 'City.mp4'
  $yugveraPath = Join-Path $temporaryDirectory 'YUGVERA.mp4'
  [System.IO.File]::WriteAllText($cityPath, 'city fixture')
  [System.IO.File]::WriteAllText($yugveraPath, 'yugvera fixture')
  $successScript = Write-NodeFixture 'success.js' @'
process.stdout.write(JSON.stringify({
  sourceRetained: true,
  outputs: [
    { filename: 'City.mp4', path: process.argv[2], expectedVideoFrameCount: 300, expectedDurationSeconds: 10, verifiedDurationSeconds: 10, audioStreamVerified: true, bytes: 12 },
    { filename: 'YUGVERA.mp4', path: process.argv[3], expectedVideoFrameCount: 301, expectedDurationSeconds: 10.033333, verifiedDurationSeconds: 10.033333, audioStreamVerified: true, bytes: 15 }
  ]
}));
process.stderr.write('success-stderr');
'@
  $successArguments = $successScript + ' ' + (Quote-TestArgument $cityPath) + ' ' + (Quote-TestArgument $yugveraPath)
  $success = Invoke-LocalSplitterProcess -FilePath $nodeCommand.Source -Arguments $successArguments
  Assert-LocalSplitterExitCode -ProcessResult $success
  Assert-Equal 0 $success.ExitCode 'Successful fixture exit code'
  Assert-Equal 'success-stderr' $success.Stderr 'Successful fixture stderr'
  $successSummary = $success.Stdout | ConvertFrom-Json
  Assert-Equal $true $successSummary.sourceRetained 'Successful fixture stdout JSON'
  Assert-Equal 'City.mp4' $successSummary.outputs[0].filename 'Successful fixture output'
  Assert-LocalSplitterSummary -Summary $successSummary -OutputDirectory $temporaryDirectory
  Write-Output 'PASS: success JSON stdout, including integral and fractional duration fields, remains separate from stderr and exit code 0.'

  $failureScript = Write-NodeFixture 'failure.js' @'
process.stdout.write(JSON.stringify({ sourceRetained: true, outputs: [{ filename: 'not-success.mp4' }] }));
process.stderr.write('fixture-failure-detail');
process.exitCode = 7;
'@
  $failure = Invoke-LocalSplitterProcess -FilePath $nodeCommand.Source -Arguments $failureScript
  Assert-Equal 7 $failure.ExitCode 'Failing fixture numeric exit code'
  Assert-Equal 'fixture-failure-detail' $failure.Stderr 'Failing fixture stderr'
  $failureSummary = $failure.Stdout | ConvertFrom-Json
  Assert-Equal 'not-success.mp4' $failureSummary.outputs[0].filename 'Failing fixture stdout JSON'
  $failureWasRaised = $false
  try {
    Assert-LocalSplitterExitCode -ProcessResult $failure
  } catch {
    $failureWasRaised = $true
    if (
      -not $_.Exception.Message.Contains('exit code 7') -or
      -not $_.Exception.Message.Contains("STDERR:`nfixture-failure-detail") -or
      -not $_.Exception.Message.Contains("STDOUT:`n$($failure.Stdout.Trim())")
    ) {
      throw "Nonzero failure diagnostic did not preserve code and separately labeled streams: $($_.Exception.Message)"
    }
  }
  if (-not $failureWasRaised) { throw 'Nonzero splitter exit was not raised as a failure.' }
  Write-Output 'PASS: nonzero exit code 7 is retained independently of valid-looking JSON stdout.'
} finally {
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
