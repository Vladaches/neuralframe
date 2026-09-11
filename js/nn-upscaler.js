/* ============================================
   NeuralFrame — Neural Upscaler (Real-ESRGAN ONNX)
   Loaded AFTER ort CDN, BEFORE app.js
   ============================================ */

class NeuralUpscaler {
  /**
   * Initialize the neural upscaler session.
   * @param {string} modelUrl - Path to the .onnx model file
   * @returns {{ ok: true, session } | { ok: false, reason: string, error?: string }}
   */
  static async init(modelUrl = 'models/realesr-general-x4v3.onnx') {
    if (!window.ort) return { ok: false, reason: 'ort' };
    if (!(navigator.gpu)) return { ok: false, reason: 'webgpu' };
    try {
      const res = await fetch(modelUrl);
      if (!res.ok) return { ok: false, reason: 'fetch' };
      const buf = await res.arrayBuffer();
      const session = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] });

      // Warmup: force WebGPU shader compilation + jsep.wasm download now, not at first video frame
      try {
        const warm = new ort.Tensor('float32', new Float32Array(3 * 32 * 32), [1, 3, 32, 32]);
        await session.run({ [session.inputNames[0]]: warm });
      } catch (e) {
        return { ok: false, reason: 'warmup', error: String(e) };
      }

      return { ok: true, session };
    } catch (e) { return { ok: false, reason: 'create', error: String(e) }; }
  }

  /**
   * Run the Real-ESRGAN x4 model on an RGBA ImageData.
   * @param {ort.InferenceSession} session
   * @param {ImageData} imageData - RGBA uint8, w x h
   * @returns {Promise<ImageData>} - RGBA uint8, (4w) x (4h)
   */
  static async run(session, imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const pixelCount = w * h;

    // Build float32 RGB NCHW input: [1, 3, h, w], values 0..1
    const input = new Float32Array(3 * pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const byteIdx = i * 4;
      input[i] = src[byteIdx] / 255;                      // R plane
      input[pixelCount + i] = src[byteIdx + 1] / 255;     // G plane
      input[2 * pixelCount + i] = src[byteIdx + 2] / 255; // B plane
    }

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    const tensor = new ort.Tensor('float32', input, [1, 3, h, w]);
    const results = await session.run({ [inputName]: tensor });
    const out = results[outputName].data; // Float32Array, shape [1,3,4h,4w]

    const outW = w * 4;
    const outH = h * 4;
    const planeSize = outW * outH;
    const result = new Uint8ClampedArray(planeSize * 4);

    for (let j = 0; j < planeSize; j++) {
      result[j * 4] = Math.round(out[j] * 255);                      // R
      result[j * 4 + 1] = Math.round(out[planeSize + j] * 255);      // G
      result[j * 4 + 2] = Math.round(out[2 * planeSize + j] * 255);  // B
      result[j * 4 + 3] = 255;                                        // A
    }

    return new ImageData(result, outW, outH);
  }
}

window.NeuralUpscaler = NeuralUpscaler;
