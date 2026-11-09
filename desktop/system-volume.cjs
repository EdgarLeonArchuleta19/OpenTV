'use strict';
/*
 * Windows master volume (the speaker icon in the taskbar), for the TV
 * volume slider. Electron has no API for it, so one hidden PowerShell
 * process hosts a tiny Core Audio (IAudioEndpointVolume) wrapper and answers
 * line commands on stdin:  "get" | "set 0.42" | "mute 1"  ->  "ok 0.42 0".
 * The process starts on first use and stops when the app quits.
 */
const { spawn } = require('node:child_process');

const CSHARP = `
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class OTAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float GetVolume() { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void SetVolume(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), Guid.Empty)); }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, Guid.Empty)); }
}
`;

const LOOP = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${CSHARP}
'@
$inv = [Globalization.CultureInfo]::InvariantCulture
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    if ($line.StartsWith('set ')) { [OTAudio]::SetVolume([float]::Parse($line.Substring(4), $inv)) }
    elseif ($line.StartsWith('mute ')) { [OTAudio]::SetMute($line.Substring(5) -eq '1') }
    $v = [OTAudio]::GetVolume().ToString('0.000', $inv)
    $m = if ([OTAudio]::GetMute()) { '1' } else { '0' }
    [Console]::Out.WriteLine('ok ' + $v + ' ' + $m)
  } catch {
    [Console]::Out.WriteLine('err ' + ($_.Exception.Message -replace '\\s+', ' '))
  }
  [Console]::Out.Flush()
}
`;

let child = null;
let buffer = '';
const waiting = [];

function start() {
  if (child || process.platform !== 'win32') return child;
  const encoded = Buffer.from(LOOP, 'utf16le').toString('base64');
  child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const next = waiting.shift();
      if (next) next(line);
    }
  });
  const fail = () => {
    child = null;
    while (waiting.length) waiting.shift()('err el control de volumen se cerró');
  };
  child.on('exit', fail);
  child.on('error', fail);
  return child;
}

function send(command) {
  return new Promise((resolve) => {
    const proc = start();
    if (!proc) { resolve({ error: 'Solo disponible en Windows' }); return; }
    const timer = setTimeout(() => resolve({ error: 'Sin respuesta del control de volumen' }), 8000);
    waiting.push((line) => {
      clearTimeout(timer);
      const parts = line.split(' ');
      if (parts[0] === 'ok') resolve({ volume: parseFloat(parts[1]), muted: parts[2] === '1' });
      else resolve({ error: line.replace(/^err\s*/, '') });
    });
    proc.stdin.write(command + '\n');
  });
}

function systemVolume(command, value) {
  if (command === 'set') {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    return send('set ' + v.toFixed(3));
  }
  if (command === 'mute') return send('mute ' + (value ? '1' : '0'));
  return send('get');
}

function stop() {
  if (child) { try { child.stdin.end(); child.kill(); } catch { /* already gone */ } child = null; }
}

module.exports = { systemVolume, stop };
