/**
 * Platform-native text recognition for the secret shield. Nothing leaves the
 * machine: Windows uses Windows.Media.Ocr, macOS uses the Vision framework.
 * Linux has no built-in engine, so only manual redaction is available there.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseOcrOutput, type OcrResult } from './detect';

export type OcrOutcome =
  | { status: 'ok'; result: OcrResult; ms: number }
  | { status: 'unavailable' }
  | { status: 'failed'; reason: 'timeout' | 'error' };

export const OCR_TIMEOUT_MS = 8000;

/** Reads the image path from $env:SHIELD_IMAGE so no path is interpolated into code. */
export const WINDOWS_OCR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait() | Out-Null; $task.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:SHIELD_IMAGE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { throw 'No OCR language installed' }
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = foreach ($line in $result.Lines) { @{ words = @(foreach ($w in $line.Words) { @{ text = $w.Text; x = $w.BoundingRect.X; y = $w.BoundingRect.Y; w = $w.BoundingRect.Width; h = $w.BoundingRect.Height } }) } }
  [Console]::Out.Write((@{ lines = @($lines) } | ConvertTo-Json -Depth 5 -Compress))
} finally { $stream.Dispose() }
`;

/**
 * JXA + Vision. Word boxes come from boundingBoxForRange on each recognized
 * line; Vision coordinates are normalized with the origin at the bottom left.
 * Untested in CI (Windows/Linux runners); failures fall back to a manual preview.
 */
export const MACOS_OCR_SCRIPT = String.raw`
ObjC.import('Foundation'); ObjC.import('AppKit'); ObjC.import('Vision');
function run() {
  const env = $.NSProcessInfo.processInfo.environment;
  const imagePath = ObjC.unwrap(env.objectForKey('SHIELD_IMAGE'));
  const url = $.NSURL.fileURLWithPath(imagePath);
  const rep = $.NSBitmapImageRep.imageRepWithData($.NSData.dataWithContentsOfURL(url));
  const width = Number(rep.pixelsWide), height = Number(rep.pixelsHigh);
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = false;
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), null)) throw new Error('Vision request failed');
  const lines = [];
  const results = request.results;
  for (let i = 0; i < Number(results.count); i++) {
    const candidate = results.objectAtIndex(i).topCandidates(1).objectAtIndex(0);
    const text = ObjC.unwrap(candidate.string);
    const words = [];
    const re = /\S+/g; let m;
    while ((m = re.exec(text)) !== null) {
      const obs = candidate.boundingBoxForRangeError($.NSMakeRange(m.index, m[0].length), null);
      if (!obs || obs.isNil()) continue;
      const box = obs.boundingBox;
      words.push({ text: m[0], x: box.origin.x * width, y: (1 - box.origin.y - box.size.height) * height, w: box.size.width * width, h: box.size.height * height });
    }
    lines.push({ words });
  }
  return JSON.stringify({ lines });
}
`;

interface Runner {
  command: string;
  args: string[];
}

function runnerFor(platform: NodeJS.Platform): Runner | null {
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    return {
      command: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WINDOWS_OCR_SCRIPT, 'utf16le').toString('base64')],
    };
  }
  if (platform === 'darwin') {
    return { command: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MACOS_OCR_SCRIPT] };
  }
  return null;
}

export function isOcrAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return runnerFor(platform) !== null;
}

/** Recognize text in a PNG. The image is written to a private temp file that is always removed. */
export async function recognizeText(png: Buffer, platform: NodeJS.Platform = process.platform, timeoutMs = OCR_TIMEOUT_MS): Promise<OcrOutcome> {
  const runner = runnerFor(platform);
  if (!runner) return { status: 'unavailable' };

  const started = Date.now();
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'screenshot-ai-shield-'));
  const imagePath = path.join(dir, 'capture.png');
  try {
    await fs.promises.writeFile(imagePath, png, { mode: 0o600 });
    const output = await new Promise<string>((resolve, reject) => {
      execFile(runner.command, runner.args, {
        env: { ...process.env, SHIELD_IMAGE: imagePath },
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    const result = parseOcrOutput(output);
    if (!result) return { status: 'failed', reason: 'error' };
    return { status: 'ok', result, ms: Date.now() - started };
  } catch (error) {
    const timedOut = (error as { killed?: boolean; signal?: string })?.killed === true;
    return { status: 'failed', reason: timedOut ? 'timeout' : 'error' };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
