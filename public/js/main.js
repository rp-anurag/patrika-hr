/* ═══════════════════════════════════════════
   PATRIKA HR — Public Form JS
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

  // ── Package total calculator ─────────────
  const pkgFields = ['packageFixed', 'packageVariables', 'packageOthers'];
  const totalDisplay = document.getElementById('totalPackageDisplay');

  function updateTotal() {
    if (!totalDisplay) return;
    const total = pkgFields.reduce((sum, id) => {
      const val = parseFloat(document.getElementById(id)?.value) || 0;
      return sum + val;
    }, 0);
    totalDisplay.textContent = `₹${total.toFixed(1)} L`;
  }

  pkgFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateTotal);
  });

  // ── Drop Zone & Live Resume Parsing ──────
  const dropZone = document.getElementById('dropZone');
  const resumeInput = document.getElementById('resume');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const parseStatus = document.getElementById('parseStatus');
  const parseSuccess = document.getElementById('parseSuccess');
  const removeFileBtn = document.getElementById('removeFile');

  if (!dropZone || !resumeInput) return;

  // Drag events
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Push the dragged file into the actual <input> so the form submission includes it
      try {
        const dt = new DataTransfer();
        dt.items.add(files[0]);
        resumeInput.files = dt.files;
      } catch (_) { /* older browsers — file will still parse but may not submit */ }
      handleFile(files[0]);
    }
  });

  resumeInput.addEventListener('change', function () {
    if (this.files.length > 0) handleFile(this.files[0]);
  });

  function handleFile(file) {
    const allowedTypes = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExts = ['.pdf', '.doc', '.docx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    // Firefox sometimes returns empty string for file.type — fall back to extension check
    const typeOk = file.type ? allowedTypes.includes(file.type) : allowedExts.includes(ext);
    if (!typeOk && !allowedExts.includes(ext)) {
      alert('Only PDF, DOC, and DOCX files are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be under 5MB.');
      return;
    }

    // Show file info
    fileName.textContent = file.name;
    parseStatus.textContent = 'Parsing resume... please wait';
    fileInfo.classList.remove('d-none');
    parseSuccess.classList.add('d-none');
    dropZone.classList.add('file-selected');

    // Upload and parse
    const formData = new FormData();
    formData.append('resume', file);

    fetch('/apply/parse-resume', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          autofillForm(data.data);
          parseStatus.textContent = 'Parsing complete!';
          parseSuccess.classList.remove('d-none');
        } else {
          parseStatus.textContent = 'Could not auto-parse — please fill fields manually.';
        }
      })
      .catch(() => {
        parseStatus.textContent = 'Parsing unavailable — please fill fields manually.';
      });
  }

  function autofillForm(data) {
    if (data.name && !document.getElementById('fullName').value) {
      document.getElementById('fullName').value = data.name;
    }
    if (data.email && !document.getElementById('email').value) {
      document.getElementById('email').value = data.email;
    }
    if (data.phone && !document.getElementById('contactNumber').value) {
      // Strip +91 prefix if present
      const cleaned = data.phone.replace(/^\+?91/, '').replace(/\D/g, '');
      document.getElementById('contactNumber').value = cleaned.slice(-10);
    }
    if (data.location && !document.getElementById('currentLocation').value) {
      document.getElementById('currentLocation').value = data.location;
    }
  }

  // Remove file button
  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', () => {
      resumeInput.value = '';
      fileInfo.classList.add('d-none');
      parseSuccess.classList.add('d-none');
      dropZone.classList.remove('file-selected');
    });
  }

  // ── Form validation ───────────────────────
  const form = document.getElementById('applicationForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      let valid = true;
      this.classList.add('was-validated');

      // Check position selected
      const position = form.querySelector('input[name="positionApplying"]:checked');
      const posErr = document.getElementById('positionError');
      if (!position) {
        posErr?.classList.remove('d-none');
        valid = false;
      } else {
        posErr?.classList.add('d-none');
      }

      if (!this.checkValidity() || !valid) {
        e.preventDefault();
        e.stopPropagation();
        // Scroll to first error
        const firstInvalid = this.querySelector(':invalid, .btn-check:not(:checked) ~ .btn-check:not(:checked)');
        firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      // Disable submit to prevent double submission
      const submitBtn = document.getElementById('submitBtn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';
      }
    });
  }

  // ── Scroll to top on success ──────────────
  if (window.location.search.includes('success=1')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
