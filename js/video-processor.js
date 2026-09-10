/* ============================================
   NeuralFrame — Video Processor (TensorFlow.js)
   ============================================ */

class VideoProcessor {
  constructor() {
    this.isProcessing = false;
    this.aborted = false;
  }

  /* ===================== UPSCALE ===================== */
  async upscale(canvas, scale) {
    const { width, height } = canvas;
    const newWidth = width * scale;
    const newHeight = height * scale;

    const imageData = canvas.getContext('2d').getImageData(0, 0, width, height);

    return tf.tidy(() => {
      const tensor = tf.browser.fromPixels(imageData, 3)
        .toFloat()
        .div(255.0)
        .reshape([1, height, width, 3]);

      const upscaled = tf.image.resizeBilinear(tensor, [newHeight, newWidth]);

      // Sharpen after upscale
      const kernel = tf.tensor4d([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ], [3, 3, 1, 1]);

      const reshaped = upscaled.transpose([0, 3, 1, 2]);
      const sharpened = tf.conv2d(reshaped, kernel, 1, 'same')
        .transpose([0, 2, 3, 1])
        .clipByValue(0, 1);

      const output = sharpened.squeeze().mul(255).cast('int32');
      return output;
    }).then(output => this.tensorToImageData(output, newWidth, newHeight));
  }

  /* ===================== DENOISE ===================== */
  async denoise(canvas) {
    const { width, height } = canvas;
    const imageData = canvas.getContext('2d').getImageData(0, 0, width, height);

    // Simple box blur (fast, no TF needed for denoise)
    const src = imageData.data;
    const dst = new ImageData(width, height);
    const r = 1; // blur radius

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const i = (ny * width + nx) * 4;
              rSum += src[i];
              gSum += src[i + 1];
              bSum += src[i + 2];
              count++;
            }
          }
        }
        const i = (y * width + x) * 4;
        // Blend 70% blurred + 30% original
        dst.data[i]     = Math.round(src[i] * 0.3 + (rSum / count) * 0.7);
        dst.data[i + 1] = Math.round(src[i + 1] * 0.3 + (gSum / count) * 0.7);
        dst.data[i + 2] = Math.round(src[i + 2] * 0.3 + (bSum / count) * 0.7);
        dst.data[i + 3] = 255;
      }
    }

    return dst;
  }

  /* ===================== SHARPEN ===================== */
  async sharpen(canvas) {
    const { width, height } = canvas;
    const imageData = canvas.getContext('2d').getImageData(0, 0, width, height);

    // Unsharp mask with canvas (fast, no TF needed)
    const src = imageData.data;
    const dst = new ImageData(width, height);

    // Simple 3x3 sharpen kernel: center=5, neighbors=-1
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          const i = (y * width + x) * 4 + c;
          const val =
            -src[((y - 1) * width + x) * 4 + c] +
            -src[(y * width + x - 1) * 4 + c] +
            5 * src[i] +
            -src[(y * width + x + 1) * 4 + c] +
            -src[((y + 1) * width + x) * 4 + c];
          dst.data[i] = Math.max(0, Math.min(255, val));
        }
        dst.data[(y * width + x) * 4 + 3] = 255;
      }
    }

    // Fill edges
    for (let x = 0; x < width; x++) {
      dst.data[x * 4 + 3] = 255;
      dst.data[((height - 1) * width + x) * 4 + 3] = 255;
    }
    for (let y = 0; y < height; y++) {
      dst.data[(y * width) * 4 + 3] = 255;
      dst.data[(y * width + width - 1) * 4 + 3] = 255;
    }

    return dst;
  }

  /* ===================== HELPERS ===================== */
  async tensorToImageData(tensor, width, height) {
    const data = await tensor.data();
    const imageData = new ImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      imageData.data[i * 4]     = data[i * 3];
      imageData.data[i * 4 + 1] = data[i * 3 + 1];
      imageData.data[i * 4 + 2] = data[i * 3 + 2];
      imageData.data[i * 4 + 3] = 255;
    }
    return imageData;
  }

  async processFrame(canvas, enhancement) {
    switch (enhancement) {
      case 'upscale2':
        return await this.upscale(canvas, 2);
      case 'upscale4':
        return await this.upscale(canvas, 4);
      case 'denoise':
        return await this.denoise(canvas);
      case 'sharpen':
        return await this.sharpen(canvas);
      default:
        return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    }
  }

  /* ===================== VIDEO PROCESSING ===================== */
  async processVideo(videoFile, enhancement, onProgress, onFrame) {
    this.isProcessing = true;
    this.aborted = false;

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    // Wait for metadata
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Не удалось загрузить видео'));
    });

    const duration = video.duration;
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;

    // Limit dimensions
    const maxDim = 640;
    let srcW = videoW;
    let srcH = videoH;
    if (videoW > maxDim || videoH > maxDim) {
      const ratio = Math.min(maxDim / videoW, maxDim / videoH);
      srcW = Math.round(videoW * ratio);
      srcH = Math.round(videoH * ratio);
    }

    let outW = srcW;
    let outH = srcH;
    if (enhancement === 'upscale2') { outW = srcW * 2; outH = srcH * 2; }
    if (enhancement === 'upscale4') { outW = srcW * 4; outH = srcH * 4; }

    // Source canvas (draw video frames here)
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d');

    // Output canvas (processed frames go here)
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');

    // MediaRecorder
    const stream = outCanvas.captureStream(0); // manual frame capture
    const chunks = [];
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5000000
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordingDone = new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });

    // Start recording
    recorder.start();

    // Process video at 10fps (avoids overwhelming the GPU)
    const targetFps = 10;
    const frameDuration = 1 / targetFps;
    const totalFrames = Math.floor(duration * targetFps);

    // Seek-based frame extraction
    video.currentTime = 0;
    await new Promise(r => { video.onseeked = r; });

    for (let frame = 0; frame < totalFrames; frame++) {
      if (this.aborted) break;

      // Draw current video frame
      srcCtx.drawImage(video, 0, 0, srcW, srcH);

      // Process
      const processed = await this.processFrame(srcCanvas, enhancement);
      outCtx.putImageData(processed, 0, 0);

      // Request a frame capture from the stream
      if (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].requestFrame) {
        stream.getVideoTracks()[0].requestFrame();
      }

      // Send preview
      if (onFrame) onFrame(outCanvas);

      // Update progress
      const progress = ((frame + 1) / totalFrames) * 100;
      if (onProgress) onProgress(Math.min(progress, 100));

      // Seek to next frame
      const nextTime = (frame + 1) * frameDuration;
      if (nextTime < duration) {
        video.currentTime = nextTime;
        await new Promise(r => { video.onseeked = r; });
      }
    }

    // Stop recording
    if (recorder.state === 'recording') {
      recorder.stop();
    }

    const result = await recordingDone;

    URL.revokeObjectURL(video.src);
    this.isProcessing = false;

    return result;
  }

  abort() {
    this.aborted = true;
    this.isProcessing = false;
  }
}

window.VideoProcessor = VideoProcessor;
