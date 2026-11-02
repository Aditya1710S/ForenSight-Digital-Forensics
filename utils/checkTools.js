'use strict';
const videoService = require('../services/videoService');
const metadataService = require('../services/metadataService');
(async () => {
  const v = await videoService.checkTools();
  const e = await metadataService.exifToolStatus();
  console.log('FFmpeg  :', v.ffmpeg.available ? 'OK  ' + v.ffmpeg.version : 'NOT FOUND');
  console.log('FFprobe :', v.ffprobe.available ? 'OK  ' + v.ffprobe.version : 'NOT FOUND');
  console.log('ExifTool:', e.available ? 'OK  ' + e.version : 'NOT FOUND (built-in EXIF fallback will be used)');
  if (v.guidance) console.log('\n' + v.guidance);
})();
