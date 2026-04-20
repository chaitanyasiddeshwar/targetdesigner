import FFT from 'fft.js';

const USER_TEMPLATE_STORAGE_KEY = 'td:user-templates:v1';
const TARGET_CURVES_API_PATH = '/api/target-curves';
const TARGET_CURVES_STATIC_PATH = '/target_curves';

function sanitizeName(name) {
  const clean = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');
  return clean || 'target';
}

function parseCurveText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const nums = trimmed.match(/[-+]?\d+(?:[.,]\d+)?/g);
    if (!nums || nums.length < 2) continue;
    const freq = parseFloat(nums[0].replace(',', '.'));
    const db = parseFloat(nums[1].replace(',', '.'));
    if (Number.isFinite(freq) && Number.isFinite(db)) {
      points.push({ freq, db });
    }
  }
  return points;
}

function decodeCurveIdentifier(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeExternalCurveList(payload) {
  const rawEntries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.curves)
      ? payload.curves
      : [];

  return rawEntries
    .map((entry) => {
      const fileName = String(entry?.fileName || '').trim();
      if (!fileName) return null;

      const name = String(entry?.name || fileName.replace(/\.txt$/i, '')).trim();
      if (!name) return null;

      return {
        name,
        fileName,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listExternalTargetCurves() {
  let response;
  try {
    response = await fetch(TARGET_CURVES_API_PATH, { cache: 'no-store' });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  try {
    const payload = await response.json();
    return normalizeExternalCurveList(payload);
  } catch {
    return [];
  }
}

async function saveExternalTargetCurve(name, text, overwrite = false) {
  let response;
  try {
    response = await fetch(TARGET_CURVES_API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, text, overwrite: Boolean(overwrite) }),
    });
  } catch {
    return null;
  }

  if (response.status === 404 || response.status === 405) {
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage = String(payload?.error || '').trim();
    throw new Error(errorMessage || `Unable to save template: HTTP ${response.status}`);
  }

  const fileName = String(payload?.fileName || '').trim() || `${name}.txt`;
  return {
    filePath: `external:${fileName}`,
  };
}

function readUserTemplates() {
  try {
    const raw = localStorage.getItem(USER_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        name: sanitizeName(item.name),
        text: String(item.text || ''),
        updatedAt: item.updatedAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function writeUserTemplates(templates) {
  localStorage.setItem(USER_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

function downloadText(text, fileName) {
  const blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function pickSingleFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files && input.files[0] ? input.files[0] : null;
      resolve(file);
    };
    input.click();
  });
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function irToResponse(ir, sampleRate = 48000) {
  const clean = Array.isArray(ir) ? ir.map((v) => Number(v) || 0) : [];
  if (clean.length < 16) return [];

  const n = nextPow2(clean.length);
  const input = new Array(n).fill(0);
  for (let i = 0; i < clean.length; i += 1) input[i] = clean[i];

  const fft = new FFT(n);
  const out = fft.createComplexArray();
  fft.realTransform(out, input);
  fft.completeSpectrum(out);

  const half = Math.floor(n / 2);
  const freqRes = sampleRate / n;
  const dbBins = new Float64Array(half + 1);

  for (let k = 0; k <= half; k += 1) {
    const re = out[2 * k];
    const im = out[2 * k + 1];
    const mag = Math.hypot(re, im);
    dbBins[k] = 20 * Math.log10(Math.max(mag, 1e-12));
  }

  const interpDb = (freq) => {
    const idx = freq / freqRes;
    const i0 = Math.max(0, Math.min(half - 1, Math.floor(idx)));
    const i1 = i0 + 1;
    const t = Math.max(0, Math.min(1, idx - i0));
    return dbBins[i0] + (dbBins[i1] - dbBins[i0]) * t;
  };

  const MIN_FREQ = 10;
  const MAX_FREQ = 24000;
  const PPO = 48;
  const SPL_OFFSET = 75.0;
  const pts = [];
  const minOct = Math.log2(MIN_FREQ);
  const maxOct = Math.log2(MAX_FREQ);

  for (let oct = minOct; oct <= maxOct + 1e-9; oct += 1 / PPO) {
    const f = Math.pow(2, oct);
    pts.push({ f, spl: interpDb(f) + SPL_OFFSET });
  }

  return pts;
}

export async function listTargetCurves() {
  const user = readUserTemplates();
  const userCurves = user
    .map((item) => ({
      name: item.name,
      filePath: `user:${item.name}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const externalCurves = await listExternalTargetCurves();
  const builtins = externalCurves.map((item) => ({
    name: item.name,
    filePath: `external:${item.fileName}`,
  }));

  return [...builtins, ...userCurves];
}

export async function readTargetCurve(filePath) {
  if (String(filePath).startsWith('external:')) {
    const encodedFileName = String(filePath).slice('external:'.length);
    const fileName = decodeCurveIdentifier(encodedFileName);
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error('Invalid built-in template path.');
    }

    let response;
    try {
      response = await fetch(`${TARGET_CURVES_STATIC_PATH}/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
    } catch (error) {
      throw new Error(`Unable to load built-in template: ${error?.message || 'Network error.'}`);
    }

    if (!response.ok) {
      throw new Error(`Built-in template unavailable: HTTP ${response.status}`);
    }

    return parseCurveText(await response.text());
  }

  if (String(filePath).startsWith('builtin:')) {
    const legacyName = String(filePath).slice('builtin:'.length).trim();
    const legacyFileName = /\.txt$/i.test(legacyName) ? legacyName : `${legacyName}.txt`;
    return readTargetCurve(`external:${legacyFileName}`);
  }

  if (String(filePath).startsWith('user:')) {
    const name = String(filePath).slice('user:'.length);
    const user = readUserTemplates();
    const found = user.find((item) => item.name === name);
    if (!found) throw new Error('Saved template not found.');
    return parseCurveText(found.text);
  }

  throw new Error('Unsupported curve identifier.');
}

export async function saveTargetCurve(name, points, overwrite = false) {
  const safeName = sanitizeName(name);

  const text = (points || [])
    .map((p) => `${Number(p.freq).toFixed(6)} ${Number(p.db).toFixed(3)}`)
    .join('\n') + '\n';

  const externalResult = await saveExternalTargetCurve(safeName, text, overwrite);
  if (externalResult) {
    return externalResult;
  }

  const user = readUserTemplates();
  const idx = user.findIndex((item) => item.name.toLowerCase() === safeName.toLowerCase());
  if (idx >= 0 && !overwrite) {
    throw new Error(`File "${safeName}.txt" already exists.`);
  }

  const next = {
    name: safeName,
    text,
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) user[idx] = next;
  else user.push(next);

  writeUserTemplates(user);
  return { filePath: `user:${safeName}` };
}

export async function exportTargetCurve(text, defaultName = 'target.txt') {
  const safe = sanitizeName(defaultName).replace(/\.txt$/i, '') + '.txt';
  downloadText(text, safe);
  return { filePath: safe };
}

export async function importTargetCurveFile() {
  const file = await pickSingleFile('.txt,.frd,.csv');
  if (!file) return null;
  const text = await file.text();
  const name = file.name.replace(/\.[^.]+$/, '');
  return { name, text };
}

export async function importADYMeasurements() {
  const file = await pickSingleFile('.ady,.json');
  if (!file) return null;

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`Invalid ADY file: ${error?.message || 'Unable to parse JSON.'}`);
  }

  const channels = Array.isArray(parsed?.detectedChannels) ? parsed.detectedChannels : [];
  if (!channels.length) {
    throw new Error('ADY file does not contain detectedChannels.');
  }

  const measurements = [];
  for (const channel of channels) {
    const commandId = String(channel?.commandId || '').trim();
    const ir = channel?.responseData?.['0'];
    if (!commandId || !Array.isArray(ir) || !ir.length) continue;
    const pts = irToResponse(ir, 48000);
    if (!pts.length) continue;
    measurements.push({ name: commandId, pts });
  }

  if (!measurements.length) {
    throw new Error('No valid channel impulse responses found in ADY file.');
  }

  return {
    name: file.name.replace(/\.[^.]+$/, ''),
    measurements,
  };
}

export async function importFromREW() {
  let response;
  try {
    response = await fetch('http://localhost:4735/measurements');
  } catch (error) {
    throw new Error(`REW API unavailable: ${error?.message || 'Network error.'}`);
  }

  if (!response.ok) {
    throw new Error(`REW API unavailable: HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('Invalid REW API response');
  }
}
