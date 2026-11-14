import { COUNTERS, type CounterId, type LocalizedCounter } from './parse.js';

/*
 * One-time probe (lote 50.08): a short PowerShell run that
 *  - localizes the English counter paths through PDH (PdhAddEnglishCounter + PdhGetCounterInfo), so typeperf works on
 *    any Windows display language, including counter sets that are not in the Perflib index;
 *  - returns each "Object\Counter" in the console OEM code page, so typeperf's header can be matched byte for byte;
 *  - reads the GPU name, dedicated VRAM size and fixed drives.
 * It exits when done; the result is cached per Windows build, so normal starts do not run PowerShell at all.
 */

export interface ProbeResult {
  osRelease: string;
  counters: Partial<Record<CounterId, LocalizedCounter>>;
  gpuName: string | null;
  vramTotalBytes: number | null;
  drives: string[];
}

export const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NbPdh {
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQuery(string src, IntPtr user, out IntPtr query);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr user, out IntPtr counter);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhGetCounterInfo(IntPtr counter, bool explain, ref uint size, IntPtr buffer);
  [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
  public static string Localize(string english) {
    IntPtr q; if (PdhOpenQuery(null, IntPtr.Zero, out q) != 0) return null;
    try {
      IntPtr c; if (PdhAddEnglishCounter(q, english, IntPtr.Zero, out c) != 0) return null;
      uint size = 0; PdhGetCounterInfo(c, false, ref size, IntPtr.Zero);
      IntPtr buf = Marshal.AllocHGlobal((int)size);
      try {
        if (PdhGetCounterInfo(c, false, ref size, buf) != 0) return null;
        return Marshal.PtrToStringUni(Marshal.ReadIntPtr(buf, 24 + IntPtr.Size * 2));
      } finally { Marshal.FreeHGlobal(buf); }
    } finally { PdhCloseQuery(q); }
  }
}
'@
$oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
$english = ConvertFrom-Json $env:NB_PROBE_COUNTERS
$counters = [ordered]@{}
foreach ($entry in $english.PSObject.Properties) {
  $path = [NbPdh]::Localize($entry.Value)
  if (-not $path) { continue }
  $last = $path.LastIndexOf('\\')
  $objectPart = $path.Substring(1, $last - 1)
  $paren = $objectPart.IndexOf('(')
  $object = if ($paren -ge 0) { $objectPart.Substring(0, $paren) } else { $objectPart }
  $counter = $path.Substring($last + 1)
  $counters[$entry.Name] = [ordered]@{ path = $path; object = [Convert]::ToBase64String($oem.GetBytes($object)); counter = [Convert]::ToBase64String($oem.GetBytes($counter)) }
}
$gpuName = $null; $vram = $null
try {
  $classKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
  foreach ($key in Get-ChildItem $classKey -ErrorAction SilentlyContinue) {
    $p = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    $size = $p.'HardwareInformation.qwMemorySize'
    if ($size -and ($vram -eq $null -or [int64]$size -gt $vram)) { $vram = [int64]$size; $gpuName = $p.DriverDesc }
  }
} catch {}
if (-not $gpuName) { try { $gpuName = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name } catch {} }
$drives = @()
try { $drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID + '\\' }) } catch {}
[ordered]@{ counters = $counters; gpuName = $gpuName; vramTotalBytes = $vram; drives = $drives } | ConvertTo-Json -Compress -Depth 5
`;

export function probeEnv(): Record<string, string> {
  return { NB_PROBE_COUNTERS: JSON.stringify(COUNTERS) };
}

interface RawProbe {
  counters?: Record<string, { path: string; object: string; counter: string }>;
  gpuName?: string | null;
  vramTotalBytes?: number | null;
  drives?: string[];
}

/** Decodes the probe JSON; OEM base64 becomes latin1 text, the form typeperf's header is read in. */
export function parseProbe(stdout: string, osRelease: string): ProbeResult {
  const start = stdout.indexOf('{');
  const raw = JSON.parse(stdout.slice(start)) as RawProbe;
  const counters: Partial<Record<CounterId, LocalizedCounter>> = {};
  for (const [id, entry] of Object.entries(raw.counters ?? {})) {
    if (!(id in COUNTERS)) continue;
    counters[id as CounterId] = { path: entry.path, object: Buffer.from(entry.object, 'base64').toString('latin1'), counter: Buffer.from(entry.counter, 'base64').toString('latin1') };
  }
  return { osRelease, counters, gpuName: raw.gpuName ?? null, vramTotalBytes: typeof raw.vramTotalBytes === 'number' && raw.vramTotalBytes > 0 ? raw.vramTotalBytes : null, drives: Array.isArray(raw.drives) ? raw.drives.filter(isDrive) : [] };
}

/** A counter path becomes a typeperf argument: it must look like "\Object(instance)\Counter", never like an option. */
const isCounterPath = (value: unknown): value is string => typeof value === 'string' && value.length < 512 && value.startsWith('\\') && ![...value].some((char) => char === '"' || char.charCodeAt(0) < 32);
const isDrive = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z]:\\$/.test(value);

/**
 * Lote 50.12 (security review): the cached probe lives in the data folder and feeds typeperf's arguments and statfs, so
 * it is read as untrusted input. Anything that does not look like a counter path or a drive root is dropped; a cache
 * with no valid counter is ignored and the probe simply runs again.
 */
export function sanitizeProbe(value: unknown): ProbeResult | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw['osRelease'] !== 'string') return null;
  const counters: Partial<Record<CounterId, LocalizedCounter>> = {};
  const source = raw['counters'] && typeof raw['counters'] === 'object' ? raw['counters'] as Record<string, unknown> : {};
  for (const [id, entry] of Object.entries(source)) {
    if (!(id in COUNTERS) || !entry || typeof entry !== 'object') continue;
    const { path, object, counter } = entry as Record<string, unknown>;
    if (isCounterPath(path) && typeof object === 'string' && typeof counter === 'string') counters[id as CounterId] = { path, object, counter };
  }
  if (Object.keys(counters).length === 0) return null;
  const vram = raw['vramTotalBytes'];
  return {
    osRelease: raw['osRelease'],
    counters,
    gpuName: typeof raw['gpuName'] === 'string' ? raw['gpuName'].slice(0, 200) : null,
    vramTotalBytes: typeof vram === 'number' && Number.isFinite(vram) && vram > 0 ? vram : null,
    drives: Array.isArray(raw['drives']) ? raw['drives'].filter(isDrive) : [],
  };
}
