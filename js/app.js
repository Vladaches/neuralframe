/* ============================================
   NeuralFrame — App Logic
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  const processor = new VideoProcessor();

  /* ===================== UI ELEMENTS ===================== */
  const nnStatus = document.getElementById('nnStatus');

  /* ===================== BURGER MENU ===================== */
  const burger = document.getElementById('burger');
  const mobileNav = document.getElementById('mobileNav');

  burger.addEventListener('click', () => {
    burger.classList.toggle('active');
    if (mobileNav) mobileNav.classList.toggle('active');
  });

  document.querySelectorAll('.mobile-nav .nav-link').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('active');
      mobileNav.classList.remove('active');
    });
  });

  document.addEventListener('click', (e) => {
    if (!burger.contains(e.target) && !mobileNav?.contains(e.target)) {
      burger.classList.remove('active');
      if (mobileNav) mobileNav.classList.remove('active');
    }
  });

  /* ===================== SMOOTH SCROLL ===================== */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = 70;
        const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ===================== FILE UPLOAD ===================== */
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const previewArea = document.getElementById('previewArea');
  const originalVideo = document.getElementById('originalVideo');
  const enhancedCanvas = document.getElementById('enhancedCanvas');
  const enhancedPlaceholder = document.getElementById('enhancedPlaceholder');
  const enhancementSelect = document.getElementById('enhancementSelect');
  const processBtn = document.getElementById('processBtn');
  const progressArea = document.getElementById('progressArea');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const downloadArea = document.getElementById('downloadArea');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');

  let currentFile = null;
  let processedBlob = null;
  let processedEnhancement = null;

  // Click to upload
  uploadArea.addEventListener('click', () => fileInput.click());

  // Drag & drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('video/')) {
      handleFile(files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    currentFile = file;
    processedBlob = null;
    const url = URL.createObjectURL(file);
    if (originalVideo.src) URL.revokeObjectURL(originalVideo.src);
    originalVideo.src = url;

    uploadArea.classList.add('hidden');
    previewArea.classList.remove('hidden');
    enhancedPlaceholder.classList.remove('hidden');
    enhancedCanvas.style.display = 'none';

    // Reset states
    downloadArea.classList.add('hidden');
    processBtn.classList.remove('hidden');
    progressArea.classList.add('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = 'Обработка... 0%';
  }

  /* ===================== PROCESS VIDEO ===================== */
  processBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    processBtn.classList.add('hidden');
    progressArea.classList.remove('hidden');
    downloadArea.classList.add('hidden');
    enhancedPlaceholder.classList.remove('hidden');
    enhancedCanvas.style.display = 'none';

    const enhancement = enhancementSelect.value;
    processedEnhancement = enhancement;

    try {
      progressText.textContent = 'Обработка...';

      processedBlob = await processor.processVideo(
        currentFile,
        enhancement,
        // onProgress
        (progress) => {
          progressFill.style.width = progress + '%';
          progressText.textContent = `Обработка... ${Math.round(progress)}%`;
        },
        // onFrame (preview of latest frame)
        (frameCanvas) => {
          enhancedPlaceholder.classList.add('hidden');
          enhancedCanvas.style.display = 'block';
          enhancedCanvas.width = frameCanvas.width;
          enhancedCanvas.height = frameCanvas.height;
          const ctx = enhancedCanvas.getContext('2d');
          ctx.drawImage(frameCanvas, 0, 0);
        },
        // onStatus (transient stage messages, e.g. first-frame shader compile)
        (msg) => { progressText.textContent = msg; }
      );

      onComplete();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Processing error:', err);
      const msg = err.message || 'Неизвестная ошибка';
      progressText.textContent = 'Ошибка: ' + msg;
      progressFill.style.width = '0%';
      processBtn.classList.remove('hidden');
    }
  });

  function onComplete() {
    progressText.textContent = 'Обработка завершена!';
    setTimeout(() => {
      progressArea.classList.add('hidden');
      downloadArea.classList.remove('hidden');

      if (processedBlob) {
        const url = URL.createObjectURL(processedBlob);
        downloadBtn.href = url;
        downloadBtn.download = `neuralframe_${processedEnhancement}.webm`;
      }
    }, 500);
  }

  /* ===================== RESET ===================== */
  resetBtn.addEventListener('click', () => {
    processor.abort();
    currentFile = null;
    processedBlob = null;
    processedEnhancement = null;
    if (originalVideo.src) URL.revokeObjectURL(originalVideo.src);
    originalVideo.src = '';

    previewArea.classList.add('hidden');
    uploadArea.classList.remove('hidden');
    progressArea.classList.add('hidden');
    downloadArea.classList.add('hidden');
    processBtn.classList.remove('hidden');

    progressFill.style.width = '0%';
    progressText.textContent = 'Обработка... 0%';
    enhancedPlaceholder.classList.remove('hidden');
    enhancedCanvas.style.display = 'none';
  });

  /* ===================== INTERSECTION OBSERVER ===================== */
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  document.querySelectorAll('.feature-card, .step').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(el);
  });

  /* ===================== NEURAL NETWORK INIT (non-blocking) ===================== */
  // All UI handlers are attached synchronously above, so the model download +
  // WebGPU shader compilation below never blocks the interface.
  neuralInit();

  async function neuralInit() {
    if (!window.NeuralUpscaler) {
      nnStatus.classList.add('hidden');
      return;
    }
    nnStatus.classList.remove('hidden');
    nnStatus.textContent = 'ИИ: загрузка модели и компиляция шейдеров WebGPU (первый запуск до ~1 мин)...';
    try {
      const r = await NeuralUpscaler.init();
      if (r.ok) {
        processor.setNeuralSession(r.session);
        nnStatus.textContent = 'ИИ-режим активен: апскейлинг 2x/4x через нейросеть (WebGPU)';
        nnStatus.classList.add('ok');
      } else {
        const reasons = {
          ort: 'библиотека ИИ не загрузилась',
          webgpu: 'нужен Chrome/Edge с поддержкой WebGPU',
          fetch: 'не удалось загрузить модель',
          create: 'не удалось создать сессию ИИ'
        };
        const detail = r.error ? String(r.error).slice(0, 140) : '';
        nnStatus.textContent = 'ИИ-ускорение недоступно (' + (reasons[r.reason] || 'ошибка') + '). Используется обычный алгоритм.' + (detail ? ' (' + detail + ')' : '');
        nnStatus.classList.add('warn');
        console.error('Neural init failed:', r.reason, r.error);
      }
    } catch (e) {
      const detail = String(e).slice(0, 140);
      nnStatus.textContent = 'ИИ-ускорение недоступно (ошибка инициализации). Используется обычный алгоритм.' + (detail ? ' (' + detail + ')' : '');
      nnStatus.classList.add('warn');
      console.error('Neural init error:', e);
    }
  }

});
