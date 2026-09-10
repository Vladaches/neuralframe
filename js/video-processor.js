/* ============================================
   NeuralFrame — Video Processor (TensorFlow.js)
   ============================================ */

class VideoProcessor {
  constructor() {
    this.canvas = document.getElementById('processingCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.isProcessing = false;
    this.abortController = null;
  }

  /* ===================== UPSCALE 2x ===================== */
  async upscale2x(frame) {
    return await this.upscale(frame, 2);
  }

  /* ===================== UPSCALE 4x ===================== */
  async upscale4x(frame) {
    return await this.upscale(frame, 4);
  }

  /* ===================== UPSCALE (base) ===================== */
  async upscale(frame, scale) {
    const { width, height } = frame;
    const newWidth = width * scale;
    const newHeight = height * scale;

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;

    // Draw original to small canvas for sampling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(frame, 0, 0);

    const imageData = tempCtx.getImageData(0, 0, width, height);
    const tensor = tf.browser.fromPixels(imageData, 3)
      .toFloat()
      .div(255.0)
      .reshape([1, height, width, 3]);

    // Simple upscale using bicubic-like upsampling via tf.image.resizeBilinear
    const upscaled = tf.image.resizeBilinear(tensor, [newHeight, newWidth]);

    // Apply sharpening kernel
    const sharpened = this.sharpenTensor(upscaled);

    // Convert back to image data
    const output = sharpened.squeeze().mul(255).cast('int32');
    const outputData = await output.data();

    // Create RGBA ImageData
    const outputImageData = this.ctx.createImageData(newWidth, newHeight);
    for (let i = 0; i < outputData.length; i++) {
      outputImageData.data[i * 4] = outputData[i * 3];
      outputImageData.data[i * 4 + 1] = outputData[i * 3 + 1];
      outputImageData.data[i * 4 + 2] = outputData[i * 3 + 2];
      outputImageData.data[i * 4 + 3] = 255;
    }

    // Cleanup tensors
    tf.dispose([tensor, upscaled, sharpened, output]);

    return outputImageData;
  }

  /* ===================== DENOISE ===================== */
  async denoise(frame) {
    const { width, height } = frame;

    this.canvas.width = width;
    this.canvas.height = height;

    const imageData = this.ctx.getImageData(0, 0, width, height);

    const tensor = tf.browser.fromPixels(imageData, 3)
      .toFloat()
      .div(255.0)
      .reshape([1, height, width, 3]);

    // Apply Gaussian blur as denoising approximation
    const blurred = this.gaussianBlur(tensor, 1.5);

    // Blend: 70% blurred + 30% original (preserve some detail)
    const blended = tf.add(
      blurred.mul(0.7),
      tensor.mul(0.3)
    );

    const output = blended.squeeze().mul(255).cast('int32');
    const outputData = await output.data();

    const outputImageData = this.ctx.createImageData(width, height);
    for (let i = 0; i < outputData.length; i++) {
      outputImageData.data[i * 4] = outputData[i * 3];
      outputImageData.data[i * 4 + 1] = outputData[i * 3 + 1];
      outputImageData.data[i * 4 + 2] = outputData[i * 3 + 2];
      outputImageData.data[i * 4 + 3] = 255;
    }

    tf.dispose([tensor, blurred, blended, output]);

    return outputImageData;
  }

  /* ===================== SHARPEN ===================== */
  async sharpen(frame) {
    const { width, height } = frame;

    this.canvas.width = width;
    this.canvas.height = height;

    const imageData = this.ctx.getImageData(0, 0, width, height);

    const tensor = tf.browser.fromPixels(imageData, 3)
      .toFloat()
      .div(255.0)
      .reshape([1, height, width, 3]);

    // Unsharp mask: original + (original - blurred) * amount
    const blurred = this.gaussianBlur(tensor, 2.0);
    const detail = tf.sub(tensor, blurred);
    const sharpened = tf.add(tensor, detail.mul(1.5)).clipByValue(0, 1);

    const output = sharpened.squeeze().mul(255).cast('int32');
    const outputData = await output.data();

    const outputImageData = this.ctx.createImageData(width, height);
    for (let i = 0; i < outputData.length; i++) {
      outputImageData.data[i * 4] = outputData[i * 3];
      outputImageData.data[i * 4 + 1] = outputData[i * 3 + 1];
      outputImageData.data[i * 4 + 2] = outputData[i * 3 + 2];
      outputImageData.data[i * 4 + 3] = 255;
    }

    tf.dispose([tensor, blurred, detail, sharpened, output]);

    return outputImageData;
  }

  /* ===================== HELPERS ===================== */
  gaussianBlur(tensor, sigma) {
    const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = this.createGaussianKernel(kernelSize, sigma);
    const padding = Math.floor(kernelSize / 2);

    return tf.tidy(() => {
      const reshaped = tensor.transpose([0, 3, 1, 2]);
      const conv = tf.conv2d(reshaped, kernel, 1, 'same');
      return conv.transpose([0, 2, 3, 1]);
    });
  }

  createGaussianKernel(size, sigma) {
    const values = new Float32Array(size * size);
    const center = Math.floor(size / 2);
    let sum = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        values[y * size + x] = value;
        sum += value;
      }
    }

    // Normalize
    for (let i = 0; i < values.length; i++) {
      values[i] /= sum;
    }

    return tf.tensor4d(values, [size, size, 1, 1]);
  }

  sharpenTensor(tensor) {
    return tf.tidy(() => {
      const kernel = tf.tensor4d([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ], [3, 3, 1, 1]);

      const reshaped = tensor.transpose([0, 3, 1, 2]);
      const conv = tf.conv2d(reshaped, kernel, 1, 'same');
      return conv.transpose([0, 2, 3, 1]).clipByValue(0, 1);
    });
  }

  /* ===================== VIDEO PROCESSING ===================== */
  async processVideo(videoFile, enhancement, onProgress, onFrame) {
    this.isProcessing = true;
    this.abortController = new AbortController();

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });

    const { duration, videoWidth, videoHeight } = video;

    // Limit to 720p processing for performance
    const maxDim = 720;
    let processWidth = videoWidth;
    let processHeight = videoHeight;

    if (videoWidth > maxDim || videoHeight > maxDim) {
      const ratio = Math.min(maxDim / videoWidth, maxDim / videoHeight);
      processWidth = Math.round(videoWidth * ratio);
      processHeight = Math.round(videoHeight * ratio);
    }

    // Setup offscreen canvas
    const offCanvas = document.createElement('canvas');
    offCanvas.width = processWidth;
    offCanvas.height = processHeight;
    const offCtx = offCanvas.getContext('2d');

    // Setup output canvas for recording
    const outputCanvas = document.createElement('canvas');
    let outputWidth = processWidth;
    let outputHeight = processHeight;

    if (enhancement === 'upscale2') {
      outputWidth = processWidth * 2;
      outputHeight = processHeight * 2;
    } else if (enhancement === 'upscale4') {
      outputWidth = processWidth * 4;
      outputHeight = processHeight * 4;
    }

    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputCtx = outputCanvas.getContext('2d');

    // Setup MediaRecorder
    const stream = outputCanvas.captureStream(30);
    const chunks = [];

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8000000
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordingDone = new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };
    });

    // Start recording
    recorder.start();

    // Play video
    video.currentTime = 0;
    await video.play();

    // Process frame by frame
    const fps = 30;
    const totalFrames = Math.floor(duration * fps);
    let currentFrame = 0;

    const processFrame = async () => {
      if (!this.isProcessing || this.abortController.signal.aborted) {
        video.pause();
        recorder.stop();
        return;
      }

      if (video.ended || video.paused) {
        recorder.stop();
        return;
      }

      // Draw current frame
      offCtx.drawImage(video, 0, 0, processWidth, processHeight);

      // Process with selected enhancement
      let processedImageData;
      switch (enhancement) {
        case 'upscale2':
          processedImageData = await this.upscale2x(offCanvas);
          break;
        case 'upscale4':
          processedImageData = await this.upscale4x(offCanvas);
          break;
        case 'denoise':
          processedImageData = await this.denoise(offCanvas);
          break;
        case 'sharpen':
          processedImageData = await this.sharpen(offCanvas);
          break;
        default:
          processedImageData = offCtx.getImageData(0, 0, processWidth, processHeight);
      }

      // Draw processed frame to output
      outputCtx.putImageData(processedImageData, 0, 0);

      // Send frame for preview
      if (onFrame) {
        onFrame(outputCanvas);
      }

      currentFrame++;
      const progress = (currentFrame / totalFrames) * 100;
      if (onProgress) onProgress(Math.min(progress, 100));

      // Schedule next frame
      if (currentFrame < totalFrames) {
        requestAnimationFrame(processFrame);
      } else {
        recorder.stop();
      }
    };

    // Start processing when video plays
    video.onplaying = () => {
      processFrame();
    };

    // Wait for recording to finish
    const result = await recordingDone;

    // Cleanup
    URL.revokeObjectURL(video.src);
    this.isProcessing = false;

    return result;
  }

  /* ===================== SINGLE FRAME PROCESS ===================== */
  async processFrame(canvas, enhancement) {
    switch (enhancement) {
      case 'upscale2':
        return await this.upscale2x(canvas);
      case 'upscale4':
        return await this.upscale4x(canvas);
      case 'denoise':
        return await this.denoise(canvas);
      case 'sharpen':
        return await this.sharpen(canvas);
      default:
        return this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
  }

  abort() {
    this.isProcessing = false;
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

// Export
window.VideoProcessor = VideoProcessor;
