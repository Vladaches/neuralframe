/* ============================================
   NeuralFrame — Video Processor v3 + Neural
   ============================================ */

class VideoProcessor {
  constructor() {
    this.isProcessing = false;
    this.aborted = false;
    this.nnSession = null;
  }

  get neuralAvailable() {
    return !!this.nnSession;
  }

  setNeuralSession(session) {
    this.nnSession = session;
  }

  /* ===================== ENHANCE (canvas fallback) ===================== */
  enhance(srcCanvas, type) {
    const { width: w, height: h } = srcCanvas;
    const srcCtx = srcCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, w, h);
    const px = srcData.data;

    if (type === 'denoise') {
      const out = new ImageData(w, h);
      const d = out.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const i = (ny * w + nx) * 4;
                r += px[i]; g += px[i+1]; b += px[i+2]; n++;
              }
            }
          }
          const i = (y * w + x) * 4;
          d[i]   = Math.round(px[i] * 0.3 + (r/n) * 0.7);
          d[i+1] = Math.round(px[i+1] * 0.3 + (g/n) * 0.7);
          d[i+2] = Math.round(px[i+2] * 0.3 + (b/n) * 0.7);
          d[i+3] = 255;
        }
      }
      return out;
    }

    if (type === 'sharpen') {
      const out = new ImageData(w, h);
      const d = out.data;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let c = 0; c < 3; c++) {
            const i = (y * w + x) * 4 + c;
            const v =
              -px[((y-1)*w+x)*4+c] - px[(y*w+x-1)*4+c]
              + 5*px[i]
              - px[(y*w+x+1)*4+c] - px[((y+1)*w+x)*4+c];
            d[i] = Math.max(0, Math.min(255, v));
          }
          d[(y*w+x)*4+3] = 255;
        }
      }
      // Copy edges (RGB + alpha from source)
      for (let x = 0; x < w; x++) {
        d[x*4] = px[x*4]; d[x*4+1] = px[x*4+1]; d[x*4+2] = px[x*4+2]; d[x*4+3] = 255;
        const bi = ((h-1)*w+x)*4;
        d[bi] = px[bi]; d[bi+1] = px[bi+1]; d[bi+2] = px[bi+2]; d[bi+3] = 255;
      }
      for (let y = 0; y < h; y++) {
        const li = (y*w)*4;
        d[li] = px[li]; d[li+1] = px[li+1]; d[li+2] = px[li+2]; d[li+3] = 255;
        const ri = (y*w+w-1)*4;
        d[ri] = px[ri]; d[ri+1] = px[ri+1]; d[ri+2] = px[ri+2]; d[ri+3] = 255;
      }
      return out;
    }

    // Upscale: use canvas drawImage for bicubic resize
    if (type === 'upscale2' || type === 'upscale4') {
      const scale = type === 'upscale4' ? 4 : 2;
      const outW = w * scale, outH = h * scale;

      // First pass: upscale via canvas (bilinear)
      const tmp = document.createElement('canvas');
      tmp.width = outW; tmp.height = outH;
      const tmpCtx = tmp.getContext('2d');
      tmpCtx.imageSmoothingEnabled = true;
      tmpCtx.imageSmoothingQuality = 'high';
      tmpCtx.drawImage(srcCanvas, 0, 0, outW, outH);

      // Second pass: sharpen the upscaled result
      const upData = tmpCtx.getImageData(0, 0, outW, outH);
      const upPx = upData.data;
      const out = new ImageData(outW, outH);
      const d = out.data;

      for (let y = 1; y < outH - 1; y++) {
        for (let x = 1; x < outW - 1; x++) {
          for (let c = 0; c < 3; c++) {
            const i = (y * outW + x) * 4 + c;
            const v =
              -upPx[((y-1)*outW+x)*4+c] - upPx[(y*outW+x-1)*4+c]
              + 5*upPx[i]
              - upPx[(y*outW+x+1)*4+c] - upPx[((y+1)*outW+x)*4+c];
            d[i] = Math.max(0, Math.min(255, Math.round(upPx[i] * 0.6 + v * 0.4)));
          }
          d[(y*outW+x)*4+3] = 255;
        }
      }
      for (let x = 0; x < outW; x++) {
        d[x*4] = upPx[x*4]; d[x*4+1] = upPx[x*4+1]; d[x*4+2] = upPx[x*4+2]; d[x*4+3] = 255;
        const bi = ((outH-1)*outW+x)*4;
        d[bi] = upPx[bi]; d[bi+1] = upPx[bi+1]; d[bi+2] = upPx[bi+2]; d[bi+3] = 255;
      }
      for (let y = 0; y < outH; y++) {
        const li = (y*outW)*4;
        d[li] = upPx[li]; d[li+1] = upPx[li+1]; d[li+2] = upPx[li+2]; d[li+3] = 255;
        const ri = (y*outW+outW-1)*4;
        d[ri] = upPx[ri]; d[ri+1] = upPx[ri+1]; d[ri+2] = upPx[ri+2]; d[ri+3] = 255;
      }
      return out;
    }

    return srcData;
  }

  /* ===================== VIDEO PROCESSING ===================== */
  async processVideo(videoFile, enhancement, onProgress, onFrame, onStatus) {
    this.isProcessing = true;
    this.aborted = false;

    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;

      const cleanup = () => {
        URL.revokeObjectURL(video.src);
        this.isProcessing = false;
      };

      video.onerror = () => {
        cleanup();
        reject(new Error('Не удалось загрузить видеофайл'));
      };

      // Seek helper with 10s timeout (shared between neural and canvas paths)
      const seekTo = (targetTime) => new Promise((res, rej) => {
        if (Math.abs((video.currentTime || 0) - targetTime) < 0.001) {
          res();
          return;
        }
        let timer = null;
        const onSeeked = () => {
          clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          res();
        };
        timer = setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          rej(new Error('Таймаут seeks — видео слишком большое или повреждено'));
        }, 10000);
        video.addEventListener('seeked', onSeeked);
        video.currentTime = targetTime;
      });

      video.onloadedmetadata = () => {
        try {
          const duration = video.duration;
          const srcW = video.videoWidth;
          const srcH = video.videoHeight;

          // Guard: invalid dimensions or duration
          if (!srcW || !srcH) {
            cleanup();
            reject(new Error('Не удалось определить размер видео'));
            return;
          }

          if (!duration || duration <= 0 || !isFinite(duration)) {
            cleanup();
            reject(new Error('Видео слишком короткое'));
            return;
          }

          // Limit source to 640px for performance
          const maxDim = 640;
          let drawW = srcW, drawH = srcH;
          if (srcW > maxDim || srcH > maxDim) {
            const ratio = Math.min(maxDim / srcW, maxDim / srcH);
            drawW = Math.round(srcW * ratio);
            drawH = Math.round(srcH * ratio);
          }

          // Neural branch: two-pass pipeline (render then record)
          const useNeural = (enhancement === 'upscale2' || enhancement === 'upscale4') && this.nnSession;
          if (useNeural) {
            this._runNeuralPipeline({
              video, duration, drawW, drawH, enhancement,
              srcW, srcH, cleanup, resolve, reject, seekTo,
              onProgress, onFrame, onStatus
            });
            return;
          }

          // ===== Canvas fallback path (unchanged) =====
          const scale = (enhancement === 'upscale4') ? 4 : (enhancement === 'upscale2') ? 2 : 1;
          const outW = drawW * scale;
          const outH = drawH * scale;

          // Source canvas
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = drawW;
          srcCanvas.height = drawH;
          const srcCtx = srcCanvas.getContext('2d');

          // Output canvas for recording
          const outCanvas = document.createElement('canvas');
          outCanvas.width = outW;
          outCanvas.height = outH;
          const outCtx = outCanvas.getContext('2d');

          // Setup MediaRecorder
          const fps = 10;
          let mimeType = 'video/webm;codecs=vp9';
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

          let stream;
          try {
            stream = outCanvas.captureStream(fps);
          } catch (e) {
            cleanup();
            reject(new Error('Ваш браузер не поддерживает запись видео. Попробуйте Chrome.'));
            return;
          }

          const chunks = [];
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
          recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

          const done = new Promise(res => {
            recorder.onstop = () => res(new Blob(chunks, { type: 'video/webm' }));
          });

          recorder.start(100);

          const totalFrames = Math.max(1, Math.ceil(duration * fps));
          let processed = 0;
          let lastDrawnTime = -Infinity;

          // Draw, enhance, and notify for a single frame (sync)
          const drawFrame = () => {
            srcCtx.drawImage(video, 0, 0, drawW, drawH);
            const enhanced = this.enhance(srcCanvas, enhancement);
            outCtx.putImageData(enhanced, 0, 0);
            if (onFrame) onFrame(outCanvas);
            processed++;
            if (onProgress) onProgress(Math.min(100, (processed / totalFrames) * 100));
          };

          // Stop recorder, then resolve or reject
          const finish = (success) => {
            if (recorder.state === 'recording') recorder.stop();
            if (!success) {
              cleanup();
              reject(new DOMException('Обработка отменена', 'AbortError'));
              return;
            }
            done.then(result => { cleanup(); resolve(result); });
          };

          // Start real-time playback capture
          video.play();

          if (video.requestVideoFrameCallback) {
            // Modern browsers: rVFC gives precise media-time timestamps
            const tick = (_now, metadata) => {
              if (this.aborted) { finish(false); return; }
              const mediaTime = Math.min(metadata.mediaTime, duration);
              if (mediaTime - lastDrawnTime >= 1000 / fps) {
                drawFrame();
                lastDrawnTime = mediaTime;
              }
              if (metadata.mediaTime >= duration || video.ended) {
                finish(true);
                return;
              }
              video.requestVideoFrameCallback(tick);
            };
            video.requestVideoFrameCallback(tick);
          } else {
            // Fallback: rAF + video.currentTime for throttled drawing
            const tick = () => {
              if (this.aborted) { finish(false); return; }
              const ct = video.currentTime;
              if (ct - lastDrawnTime >= 1000 / fps) {
                drawFrame();
                lastDrawnTime = ct;
              }
              if (video.ended || ct >= duration) {
                finish(true);
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }

        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      video.src = URL.createObjectURL(videoFile);
    });
  }

  /* ===================== NEURAL PIPELINE ===================== */

  _maxNeuralFrames(drawW, drawH, outW, outH) {
    const NN_PIX = (drawW * 4) * (drawH * 4);
    const workingBytes = NN_PIX * 16 + drawW * drawH * 16;
    const blobBytes = outW * outH * 0.35;
    const memGB = (navigator.deviceMemory && navigator.deviceMemory > 0) ? navigator.deviceMemory : 4;
    const budget = memGB * 1073741824 * 0.55 - 67108864;
    const available = Math.max(0, budget - workingBytes * 2);
    const maxFrames = Math.max(60, Math.min(Math.floor(available / (blobBytes || 1)), 600));
    console.info('[NeuralPipeline] Smart limit: ' + maxFrames + ' frames (~' + Math.round(maxFrames / 10) + ' s), deviceMemory=' + memGB + ' GiB, est. blobs ~' + Math.round(maxFrames * blobBytes / 1048576) + ' MB');
    return maxFrames;
  }

  async _runNeuralPipeline({ video, duration, drawW, drawH, enhancement, cleanup, resolve, reject, seekTo, onProgress, onFrame, onStatus = () => {} }) {
    const fps = 10;
    const totalFrames = Math.max(1, Math.ceil(duration * fps));

    // Output dimensions: NN always produces 4×; upscale4 keeps it, upscale2 downscales
    const factor = 4;
    const nnW = drawW * factor;
    const nnH = drawH * factor;
    const outW = (enhancement === 'upscale2') ? drawW * 2 : nnW;
    const outH = (enhancement === 'upscale2') ? drawH * 2 : nnH;

    // Memory guard: dynamic per-device limit
    const maxFrames = this._maxNeuralFrames(drawW, drawH, outW, outH);
    if (totalFrames > maxFrames) {
      cleanup();
      reject(new Error(`Слишком длинное видео для ИИ-режима (макс. ~${Math.round(maxFrames / 10)} сек). Уменьшите длительность или используйте обычный режим.`));
      return;
    }

    // Canvases
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = drawW;
    srcCanvas.height = drawH;
    const srcCtx = srcCanvas.getContext('2d');

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');

    // Temp 4× canvas (only used for upscale2 downscale path)
    let tmp4xCanvas = null;
    if (enhancement === 'upscale2') {
      tmp4xCanvas = document.createElement('canvas');
      tmp4xCanvas.width = nnW;
      tmp4xCanvas.height = nnH;
    }

    // Cleanup helper
    const neuralCleanup = () => {
      URL.revokeObjectURL(video.src);
      this.isProcessing = false;
    };

    // ======================================================
    // PASS 1 — RENDER: seek, extract, neural-run, store blobs
    // ======================================================
    const frames = [];
    let processed = 0;

    try {
      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.aborted) {
          neuralCleanup();
          reject(new DOMException('Обработка отменена', 'AbortError'));
          return;
        }

        const time = frame / fps;
        await seekTo(time);

        srcCtx.drawImage(video, 0, 0, drawW, drawH);
        const srcImg = srcCtx.getImageData(0, 0, drawW, drawH);

        // First frame: shader compile is normally handled by the warmup in init(),
        // but a 60 s budget still protects against a WebGPU stall; later frames get 20 s.
        if (frame === 0 && onStatus) onStatus('ИИ: подготовка первого кадра (компиляция шейдеров WebGPU)...');

        const runStart = performance.now();
        const frameBudgetMs = (frame === 0) ? 60000 : 20000;
        const hiRes = await Promise.race([
          NeuralUpscaler.run(this.nnSession, srcImg), // 4× RGBA
          new Promise((_, rej) => setTimeout(() => rej(new Error(
            'ИИ-обработка не отвечает (возможно, проблема с WebGPU в вашем браузере). Попробуйте ещё раз или используйте обычный режим.'
          )), frameBudgetMs))
        ]);
        const ms = performance.now() - runStart;
        if (ms > 5000) console.warn('[NeuralPipeline] Frame ' + frame + ' took ' + ms + ' ms');

        if (enhancement === 'upscale2') {
          // put hiRes (4×) onto tmp canvas, then downscale to 2× outCanvas
          const tmpCtx = tmp4xCanvas.getContext('2d');
          tmpCtx.putImageData(hiRes, 0, 0);
          outCtx.imageSmoothingEnabled = true;
          outCtx.imageSmoothingQuality = 'high';
          outCtx.drawImage(tmp4xCanvas, 0, 0, outW, outH);
        } else {
          outCtx.putImageData(hiRes, 0, 0);
        }

        // Store frame as JPEG blob to save memory
        const blob = await new Promise(res => outCanvas.toBlob(res, 'image/jpeg', 0.92));
        frames.push(blob);
        processed++;
        if (onProgress) onProgress((processed / totalFrames) * 50); // 0..50% during pass 1

        if (onFrame) onFrame(outCanvas);

        // Yield to keep UI responsive
        await new Promise(r => setTimeout(r, 0));
      }

      // Memory estimate
      const totalBlobBytes = frames.reduce((sum, b) => sum + b.size, 0);
      console.info(`[NeuralPipeline] Pass 1 done. ${frames.length} frames, ~${(totalBlobBytes / 1048576).toFixed(1)} MB in blobs.`);

    } catch (err) {
      neuralCleanup();
      reject(err);
      return;
    }

    // ======================================================
    // PASS 2 — RECORD: replay blobs at real-time 10fps
    // ======================================================
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

    let stream;
    try {
      stream = outCanvas.captureStream(fps);
    } catch (e) {
      neuralCleanup();
      reject(new Error('Ваш браузер не поддерживает запись видео. Попробуйте Chrome.'));
      return;
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const done = new Promise(res => {
      recorder.onstop = () => res(new Blob(chunks, { type: 'video/webm' }));
    });

    recorder.start(100);

    try {
      const T0 = performance.now();

      for (let i = 0; i < frames.length; i++) {
        if (this.aborted) {
          if (recorder.state === 'recording') recorder.stop();
          neuralCleanup();
          reject(new DOMException('Обработка отменена', 'AbortError'));
          return;
        }

        const bitmap = await createImageBitmap(frames[i]);
        outCtx.clearRect(0, 0, outW, outH);
        outCtx.drawImage(bitmap, 0, 0, outW, outH);
        bitmap.close();

        // Wait until real-time moment
        const targetTime = T0 + (i + 1) * (1000 / fps);
        const delay = targetTime - performance.now();
        if (delay > 0) await new Promise(r => setTimeout(r, delay));

        if (onProgress) onProgress(50 + ((i + 1) / frames.length) * 50); // 50..100%
        if (onFrame) onFrame(outCanvas);
      }

      recorder.stop();
      const result = await done;
      neuralCleanup();
      resolve(result);

    } catch (err) {
      if (recorder.state === 'recording') recorder.stop();
      neuralCleanup();
      reject(err);
    }
  }

  abort() {
    this.aborted = true;
    this.isProcessing = false;
  }
}

window.VideoProcessor = VideoProcessor;
