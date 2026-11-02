'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const config = require('../config');

const SETUP_GUIDANCE = [
  'FFmpeg/FFprobe were not found. The rest of ForenSight still works.',
  '1. Download a Windows build (e.g. "release essentials") from https://www.gyan.dev/ffmpeg/builds/ and extract it to C:\\ffmpeg',
  '2. Add C:\\ffmpeg\\bin to PATH (Settings > System > About > Advanced system settings > Environment Variables), then open a NEW PowerShell window.',
  '3. Verify with: ffmpeg -version ; ffprobe -version',
  '4. Or set FFMPEG_PATH and FFPROBE_PATH in .env to the full .exe paths and restart the server.'
].join('\n');

let toolCache = null;
let active = 0; const waiting = [];

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: config.limits.processTimeoutMs, maxBuffer: config.limits.maxToolOutputBytes, windowsHide: true },
      (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr }));
  });
}
async function withSlot(fn) {
  if (active >= config.limits.maxConcurrentJobs) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; const n = waiting.shift(); if (n) n(); }
}

async function checkTools() {
  if (toolCache && Date.now() - toolCache.at < 30000) return toolCache.value;
  const probe = async bin => { try { const { stdout } = await run(bin, ['-version']); return { available: true, version: (stdout.split('\n')[0] || '').slice(0, 80) }; } catch { return { available: false, version: null }; } };
  const [ffmpeg, ffprobe] = await Promise.all([probe(config.tools.ffmpeg), probe(config.tools.ffprobe)]);
  const value = { ffmpeg, ffprobe, guidance: ffmpeg.available && ffprobe.available ? null : SETUP_GUIDANCE };
  toolCache = { at: Date.now(), value };
  return value;
}

async function probe(filePath) {
  const { stdout } = await withSlot(() => run(config.tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]));
  return JSON.parse(stdout);
}

async function verifyParsable(filePath) {
  const t = await checkTools();
  if (!t.ffprobe.available) return { ok: true, skipped: true, message: 'FFprobe unavailable: container structure was not parser-validated.' };
  try { const p = await probe(filePath); return { ok: (p.streams || []).some(s => s.codec_type === 'video') }; }
  catch { return { ok: false, message: 'The video could not be parsed by FFprobe.' }; }
}

const fps = r => { const m = /^(\d+)\/(\d+)$/.exec(r || ''); return m && +m[2] ? Math.round((+m[1] / +m[2]) * 1000) / 1000 : null; };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, String(o[k]).slice(0, 300)]));

async function analyze(filePath, evidence) {
  const tools = await checkTools();
  const indicators = [];
  const result = {
    kind: 'video', tools: { ffmpeg: tools.ffmpeg.available, ffprobe: tools.ffprobe.available },
    validation: { status: 'unknown', parser: 'ffprobe', message: '' },
    file: { format: evidence.detected_format, mime: evidence.mime_type, sizeBytes: evidence.size_bytes, sha256: evidence.sha256 },
    container: null, video: null, audio: null, creation: null, metadata: { status: 'unavailable' }, indicators,
    setupGuidance: tools.guidance,
    limitations: 'Container metadata is self-reported by the file and can be edited. Indicators are heuristic and do not prove manipulation.'
  };
  if (evidence.format_mismatch) indicators.push({ level: 'Warning', code: 'extension_mismatch', title: 'File extension does not match the detected format', explanation: 'Extensions are not trusted; the content signature decides.' });
  if (!tools.ffprobe.available) {
    result.validation = { status: 'unknown', parser: 'ffprobe', message: 'FFprobe is not installed, so no deep parsing was performed.' };
    indicators.push({ level: 'Warning', code: 'ffprobe_missing', title: 'FFprobe not available', explanation: 'Install FFmpeg to extract codec, duration and creation metadata. See setup guidance.' });
    return result;
  }
  let p;
  try { p = await probe(filePath); }
  catch { result.validation = { status: 'invalid', parser: 'ffprobe', message: 'FFprobe could not parse this file.' }; result.metadata = { status: 'error' }; indicators.push({ level: 'Error', code: 'probe_failed', title: 'Video container could not be parsed', explanation: 'The file may be corrupt or truncated.' }); return result; }
  const v = (p.streams || []).find(s => s.codec_type === 'video'); const a = (p.streams || []).find(s => s.codec_type === 'audio'); const f = p.format || {};
  result.validation = { status: v ? 'valid' : 'invalid', parser: 'ffprobe', message: v ? 'Parsed successfully by FFprobe.' : 'No video stream found.' };
  result.container = { formatName: f.format_name || null, formatLongName: f.format_long_name || null, durationSeconds: num(f.duration), bitRate: num(f.bit_rate), streamCount: (p.streams || []).length };
  if (v) result.video = { codec: v.codec_name, profile: v.profile || null, width: v.width, height: v.height, frameRate: fps(v.avg_frame_rate) || fps(v.r_frame_rate), pixelFormat: v.pix_fmt || null, durationSeconds: num(v.duration), frames: num(v.nb_frames) };
  else indicators.push({ level: 'Error', code: 'no_video_stream', title: 'No video stream detected', explanation: 'The container holds no decodable video stream.' });
  if (a) result.audio = { codec: a.codec_name, channels: a.channels, sampleRate: num(a.sample_rate) };
  const tags = { ...(f.tags || {}) };
  const created = tags.creation_time || (v && v.tags && v.tags.creation_time) || null;
  result.creation = { creationTime: created, encoder: tags.encoder || tags.software || null, tags: pick(tags, Object.keys(tags).slice(0, 25)) };
  result.metadata = { status: Object.keys(tags).length ? 'extracted' : 'none_found' };
  if (!created) indicators.push({ level: 'Informational', code: 'no_creation_time', title: 'No creation timestamp in container metadata', explanation: 'Common for re-encoded or exported video. Not evidence of tampering.' });
  if (result.creation.encoder) indicators.push({ level: 'Informational', code: 'encoder_tag', title: `Encoder/software tag: ${result.creation.encoder}`, explanation: 'Names the tool that wrote the container. Unverified and editable.' });
  if (created && Date.parse(created) > Date.now() + 86400000) indicators.push({ level: 'Warning', code: 'future_creation', title: 'Creation time is in the future', explanation: 'Compared with the server clock; may be a device clock issue.' });
  const cd = result.container.durationSeconds, vd = result.video && result.video.durationSeconds;
  if (cd && vd && Math.abs(cd - vd) > 1) indicators.push({ level: 'Warning', code: 'duration_mismatch', title: 'Container and video-stream durations differ by more than 1 second', explanation: 'May indicate trimming, muxing differences or a damaged file.' });
  if (!indicators.some(i => i.level !== 'Informational')) indicators.push({ level: 'Informational', code: 'no_findings', title: 'No warnings from the available checks', explanation: 'This does not establish authenticity.' });
  return result;
}

async function extractFrame(srcPath, seconds, outPath) {
  await withSlot(() => run(config.tools.ffmpeg, ['-nostdin', '-v', 'error', '-ss', seconds.toFixed(3), '-i', srcPath, '-frames:v', '1', '-an', '-y', outPath]));
  const st = await fs.promises.stat(outPath).catch(() => null);
  if (!st || st.size === 0) throw new Error('No frame was produced at that timestamp.');
  if (st.size > config.limits.maxDerivedBytes) throw new Error('Derived frame exceeds the size limit.');
}

async function contactSheet(srcPath, duration, count, outPath) {
  const cols = Math.min(4, count), rows = Math.ceil(count / cols);
  const rate = (count / Math.max(duration, 0.1)).toFixed(6);
  await withSlot(() => run(config.tools.ffmpeg, ['-nostdin', '-v', 'error', '-i', srcPath, '-vf', `fps=${rate},scale=320:-2,tile=${cols}x${rows}`, '-frames:v', '1', '-an', '-y', outPath]));
  const st = await fs.promises.stat(outPath).catch(() => null);
  if (!st || st.size === 0) throw new Error('No contact sheet was produced.');
  if (st.size > config.limits.maxDerivedBytes) throw new Error('Derived contact sheet exceeds the size limit.');
}

module.exports = { checkTools, analyze, probe, verifyParsable, extractFrame, contactSheet, SETUP_GUIDANCE };
