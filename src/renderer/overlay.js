(function initializeOverlay() {
  'use strict';

  const geometry = window.SnapGeometry;
  const canvas = document.querySelector('#capture-canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const magnifierCanvas = document.querySelector('#magnifier-canvas');
  const magnifierContext = magnifierCanvas.getContext('2d', { alpha: false });
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

  const elements = {
    cancel: document.querySelector('#cancel-button'),
    colorAnchor: document.querySelector('#color-anchor'),
    colorButton: document.querySelector('#color-button'),
    colorPopover: document.querySelector('#color-popover'),
    colorPreview: document.querySelector('#color-preview'),
    copy: document.querySelector('#copy-button'),
    customColorButton: document.querySelector('#custom-color-button'),
    customColorHex: document.querySelector('#custom-color-hex'),
    customColorHue: document.querySelector('#custom-color-hue'),
    customColorHueValue: document.querySelector('#custom-color-hue-value'),
    customColorLightness: document.querySelector('#custom-color-lightness'),
    customColorLightnessValue: document.querySelector('#custom-color-lightness-value'),
    customColorPanel: document.querySelector('#custom-color-panel'),
    customColorPreview: document.querySelector('#custom-color-preview'),
    customColorSaturation: document.querySelector('#custom-color-saturation'),
    customColorSaturationValue: document.querySelector('#custom-color-saturation-value'),
    instruction: document.querySelector('#instruction'),
    loading: document.querySelector('#loading-panel'),
    magnifier: document.querySelector('#magnifier'),
    pixelHex: document.querySelector('#pixel-hex'),
    pixelPosition: document.querySelector('#pixel-position'),
    pixelSwatch: document.querySelector('#pixel-swatch'),
    redo: document.querySelector('#redo-button'),
    save: document.querySelector('#save-button'),
    sizeBadge: document.querySelector('#size-badge'),
    sizeButton: document.querySelector('#size-button'),
    sizeLabel: document.querySelector('#size-label'),
    sizePopover: document.querySelector('#size-popover'),
    sizePreview: document.querySelector('#size-preview'),
    sizePreviewMark: document.querySelector('#size-preview-mark'),
    sizeRange: document.querySelector('#size-range'),
    sizeValue: document.querySelector('#size-value'),
    srStatus: document.querySelector('#sr-status'),
    textEditor: document.querySelector('#text-editor'),
    toast: document.querySelector('#toast'),
    toolbar: document.querySelector('#toolbar'),
    undo: document.querySelector('#undo-button'),
  };

  const MIN_SELECTION_SIZE = 8;
  const HANDLE_RADIUS = 9;
  const COLORS = ['#ef4444', '#f59e0b', '#0d9488', '#3b82f6', '#ffffff', '#111827'];

  const state = {
    image: null,
    pixelatedImage: null,
    viewSize: { width: window.innerWidth, height: window.innerHeight },
    pixelSize: { width: 0, height: 0 },
    selection: null,
    windowRects: [],
    hoverWindow: null,
    phase: 'idle',
    tool: 'select',
    color: COLORS[0],
    toolSettings: {
      rect: { color: COLORS[0], size: 4 },
      ellipse: { color: COLORS[0], size: 4 },
      arrow: { color: COLORS[0], size: 4 },
      pen: { color: COLORS[0], size: 4 },
      mosaic: { size: 24 },
      text: { color: COLORS[0], size: 22 },
    },
    annotations: [],
    redoStack: [],
    draft: null,
    dragStart: null,
    baseSelection: null,
    baseAnnotations: null,
    baseRedoStack: null,
    activeHandle: null,
    pointer: { x: 0, y: 0 },
    pointerOnCanvas: false,
    pointerInUi: false,
    magnifierEnabled: true,
    textAnchor: null,
    textEditorMaxHeight: 180,
    textEditorSession: 0,
    isComposing: false,
    busy: false,
    toastTimer: null,
    announceTimer: null,
    popoverDismissedAt: 0,
  };

  function viewBounds() {
    return { x: 0, y: 0, width: state.viewSize.width, height: state.viewSize.height };
  }

  function copyAnnotations(annotations) {
    return annotations.map((annotation) => ({
      ...annotation,
      ...(annotation.points
        ? { points: annotation.points.map((point) => ({ x: point.x, y: point.y })) }
        : {}),
    }));
  }

  function pointFromEvent(event) {
    return {
      x: geometry.clamp(event.clientX, 0, state.viewSize.width),
      y: geometry.clamp(event.clientY, 0, state.viewSize.height),
    };
  }

  function distance(left, right) {
    return Math.hypot(right.x - left.x, right.y - left.y);
  }

  function normalizeHexColor(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
  }

  function hexToHsl(hex) {
    const normalized = normalizeHexColor(hex) || '#EF4444';
    const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
    const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    if (max === min) return { hue: 0, saturation: 0, lightness: Math.round(lightness * 100) };
    const delta = max - min;
    const saturation = lightness > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min);
    let hue;
    if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    return {
      hue: Math.round(hue * 60),
      saturation: Math.round(saturation * 100),
      lightness: Math.round(lightness * 100),
    };
  }

  function hslToHex(hue, saturation, lightness) {
    const h = ((Number(hue) % 360) + 360) % 360;
    const s = geometry.clamp(Number(saturation), 0, 100) / 100;
    const l = geometry.clamp(Number(lightness), 0, 100) / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const segment = h / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    let red = 0;
    let green = 0;
    let blue = 0;
    if (segment < 1) [red, green] = [chroma, x];
    else if (segment < 2) [red, green] = [x, chroma];
    else if (segment < 3) [green, blue] = [chroma, x];
    else if (segment < 4) [green, blue] = [x, chroma];
    else if (segment < 5) [red, blue] = [x, chroma];
    else [red, blue] = [chroma, x];
    const match = l - chroma / 2;
    return `#${[red, green, blue]
      .map((component) => Math.round((component + match) * 255).toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase();
  }

  function applyColor(color) {
    const normalized = normalizeHexColor(color);
    if (!normalized || state.busy || !state.toolSettings[state.tool]?.color) return false;
    state.color = normalized.toLowerCase();
    state.toolSettings[state.tool].color = state.color;
    elements.textEditor.style.color = state.color;
    elements.customColorPreview.style.backgroundColor = state.color;
    elements.customColorHex.value = normalized;
    updateToolbarState();
    return true;
  }

  function syncCustomColorControls(color = state.color) {
    const normalized = normalizeHexColor(color) || '#EF4444';
    const hsl = hexToHsl(normalized);
    elements.customColorHue.value = String(hsl.hue);
    elements.customColorSaturation.value = String(hsl.saturation);
    elements.customColorLightness.value = String(hsl.lightness);
    elements.customColorHueValue.textContent = `${hsl.hue}°`;
    elements.customColorSaturationValue.textContent = `${hsl.saturation}%`;
    elements.customColorLightnessValue.textContent = `${hsl.lightness}%`;
    elements.customColorHex.value = normalized;
    elements.customColorPreview.style.backgroundColor = normalized;
  }

  function applyCustomColorControls() {
    const hue = Number(elements.customColorHue.value);
    const saturation = Number(elements.customColorSaturation.value);
    const lightness = Number(elements.customColorLightness.value);
    elements.customColorHueValue.textContent = `${hue}°`;
    elements.customColorSaturationValue.textContent = `${saturation}%`;
    elements.customColorLightnessValue.textContent = `${lightness}%`;
    applyColor(hslToHex(hue, saturation, lightness));
  }

  function physicalScale() {
    return {
      x: state.image ? state.image.width / state.viewSize.width : 1,
      y: state.image ? state.image.height / state.viewSize.height : 1,
    };
  }

  function physicalSelection() {
    if (!state.selection || !state.image) return null;
    const scale = physicalScale();
    const left = geometry.clamp(Math.round(state.selection.x * scale.x), 0, state.image.width - 1);
    const top = geometry.clamp(Math.round(state.selection.y * scale.y), 0, state.image.height - 1);
    const right = geometry.clamp(
      Math.round((state.selection.x + state.selection.width) * scale.x),
      left + 1,
      state.image.width,
    );
    const bottom = geometry.clamp(
      Math.round((state.selection.y + state.selection.height) * scale.y),
      top + 1,
      state.image.height,
    );
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function snapSelectionToPixels(selection) {
    if (!selection || !state.image) return selection;
    const scale = physicalScale();
    const left = geometry.clamp(Math.round(selection.x * scale.x), 0, state.image.width - 1);
    const top = geometry.clamp(Math.round(selection.y * scale.y), 0, state.image.height - 1);
    const right = geometry.clamp(
      Math.round((selection.x + selection.width) * scale.x),
      left + 1,
      state.image.width,
    );
    const bottom = geometry.clamp(
      Math.round((selection.y + selection.height) * scale.y),
      top + 1,
      state.image.height,
    );
    return {
      x: left / scale.x,
      y: top / scale.y,
      width: (right - left) / scale.x,
      height: (bottom - top) / scale.y,
    };
  }

  function rectsEqual(left, right) {
    if (!left || !right) return left === right;
    const epsilon = 1e-7;
    return (
      Math.abs(left.x - right.x) < epsilon &&
      Math.abs(left.y - right.y) < epsilon &&
      Math.abs(left.width - right.width) < epsilon &&
      Math.abs(left.height - right.height) < epsilon
    );
  }

  function snapCurrentSelection(translateAnnotationsWithOrigin = false) {
    if (!state.selection) return false;
    const previous = state.selection;
    const snapped = snapSelectionToPixels(previous);
    const deltaX = snapped.x - previous.x;
    const deltaY = snapped.y - previous.y;
    state.selection = snapped;
    if (translateAnnotationsWithOrigin && (deltaX || deltaY)) {
      state.annotations = state.annotations.map((annotation) =>
        translateAnnotation(annotation, deltaX, deltaY),
      );
    }
    return !rectsEqual(previous, snapped);
  }

  function selectFullScreen() {
    state.selection = snapSelectionToPixels(viewBounds());
    state.annotations = [];
    state.redoStack = [];
    state.phase = 'ready';
  }

  function selectedStrokeSize() {
    return state.toolSettings[state.tool]?.size || 4;
  }

  function selectedMosaicSize() {
    return state.toolSettings.mosaic.size;
  }

  function selectedFontSize() {
    return state.toolSettings.text.size;
  }

  function windowAtPoint(point) {
    return state.windowRects.find((rect) => geometry.containsPoint(rect, point)) || null;
  }

  function setCanvasTransform() {
    context.setTransform(
      canvas.width / state.viewSize.width,
      0,
      0,
      canvas.height / state.viewSize.height,
      0,
      0,
    );
  }

  function traceSmoothPath(target, points) {
    if (!points.length) return;
    target.beginPath();
    target.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      target.lineTo(points[0].x + 0.01, points[0].y + 0.01);
      return;
    }
    for (let index = 1; index < points.length - 1; index += 1) {
      const midpoint = {
        x: (points[index].x + points[index + 1].x) / 2,
        y: (points[index].y + points[index + 1].y) / 2,
      };
      target.quadraticCurveTo(points[index].x, points[index].y, midpoint.x, midpoint.y);
    }
    const last = points[points.length - 1];
    target.lineTo(last.x, last.y);
  }

  function addMosaicMaskPath(target, points, radius) {
    target.beginPath();
    if (!points.length) return;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (index === 0) {
        target.moveTo(point.x + radius, point.y);
        target.arc(point.x, point.y, radius, 0, Math.PI * 2);
        continue;
      }
      const previous = points[index - 1];
      const segmentLength = distance(previous, point);
      const steps = Math.max(1, Math.ceil(segmentLength / Math.max(2, radius * 0.45)));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        const x = previous.x + (point.x - previous.x) * ratio;
        const y = previous.y + (point.y - previous.y) * ratio;
        target.moveTo(x + radius, y);
        target.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
  }

  function drawMosaic(target, annotation) {
    if (!state.pixelatedImage || !annotation.points.length) return;
    target.save();
    addMosaicMaskPath(target, annotation.points, annotation.brushSize / 2);
    target.clip();
    target.imageSmoothingEnabled = false;
    target.drawImage(
      state.pixelatedImage,
      0,
      0,
      state.pixelatedImage.width,
      state.pixelatedImage.height,
      0,
      0,
      state.viewSize.width,
      state.viewSize.height,
    );
    target.restore();
  }

  function drawArrow(target, annotation) {
    const dx = annotation.x2 - annotation.x1;
    const dy = annotation.y2 - annotation.y1;
    const angle = Math.atan2(dy, dx);
    const headLength = Math.max(10, annotation.width * 4.2);
    const spread = Math.PI / 7;
    target.beginPath();
    target.moveTo(annotation.x1, annotation.y1);
    target.lineTo(annotation.x2, annotation.y2);
    target.moveTo(annotation.x2, annotation.y2);
    target.lineTo(
      annotation.x2 - headLength * Math.cos(angle - spread),
      annotation.y2 - headLength * Math.sin(angle - spread),
    );
    target.moveTo(annotation.x2, annotation.y2);
    target.lineTo(
      annotation.x2 - headLength * Math.cos(angle + spread),
      annotation.y2 - headLength * Math.sin(angle + spread),
    );
    target.stroke();
  }

  function wrapTextLines(target, text, maxWidth) {
    if (!maxWidth || maxWidth <= 0) return text.split('\n');
    const output = [];
    text.split('\n').forEach((paragraph) => {
      if (!paragraph) {
        output.push('');
        return;
      }
      let line = '';
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && target.measureText(candidate).width > maxWidth) {
          output.push(line);
          line = character;
        } else {
          line = candidate;
        }
      }
      output.push(line);
    });
    return output;
  }

  function drawAnnotation(target, annotation) {
    target.save();
    target.lineCap = 'round';
    target.lineJoin = 'round';
    target.strokeStyle = annotation.color || state.color;
    target.fillStyle = annotation.color || state.color;
    target.lineWidth = annotation.width || selectedStrokeSize();

    if (annotation.type === 'rect' || annotation.type === 'ellipse') {
      const rect = geometry.rectFromPoints(
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 },
      );
      if (annotation.type === 'rect') {
        target.strokeRect(rect.x, rect.y, rect.width, rect.height);
      } else {
        target.beginPath();
        target.ellipse(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          Math.max(0.1, rect.width / 2),
          Math.max(0.1, rect.height / 2),
          0,
          0,
          Math.PI * 2,
        );
        target.stroke();
      }
    } else if (annotation.type === 'arrow') {
      drawArrow(target, annotation);
    } else if (annotation.type === 'pen') {
      traceSmoothPath(target, annotation.points);
      target.stroke();
    } else if (annotation.type === 'mosaic') {
      drawMosaic(target, annotation);
    } else if (annotation.type === 'text') {
      target.font = `700 ${annotation.fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      target.textBaseline = 'top';
      target.shadowColor = 'rgba(0, 0, 0, 0.42)';
      target.shadowBlur = 2;
      target.shadowOffsetY = 1;
      const lineHeight = annotation.fontSize * 1.35;
      wrapTextLines(target, annotation.text, annotation.maxWidth).forEach((line, index) => {
        target.fillText(line, annotation.x, annotation.y + index * lineHeight);
      });
    }
    target.restore();
  }

  function drawAnnotations(target, includeDraft = true) {
    state.annotations.forEach((annotation) => drawAnnotation(target, annotation));
    if (includeDraft && state.draft) drawAnnotation(target, state.draft);
  }

  function drawSelectionFrame(target) {
    const selection = state.selection;
    if (!selection) return;
    target.save();
    target.strokeStyle = '#2dd4bf';
    target.lineWidth = 1.5;
    target.shadowColor = 'rgba(0, 0, 0, 0.72)';
    target.shadowBlur = 2;
    target.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.width - 1, selection.height - 1);
    target.shadowColor = 'transparent';

    if (state.phase !== 'selecting') {
      const handles = geometry.getHandlePoints(selection);
      Object.values(handles).forEach((handle) => {
        target.fillStyle = '#ffffff';
        target.fillRect(handle.x - 4, handle.y - 4, 8, 8);
        target.strokeStyle = '#0d9488';
        target.lineWidth = 1.5;
        target.strokeRect(handle.x - 4, handle.y - 4, 8, 8);
      });
    }
    target.restore();
  }

  function render() {
    if (!state.image) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    setCanvasTransform();
    context.imageSmoothingEnabled = true;
    context.drawImage(state.image, 0, 0, state.viewSize.width, state.viewSize.height);

    if (!state.selection && state.hoverWindow) {
      context.save();
      context.fillStyle = 'rgba(0, 0, 0, 0.43)';
      context.beginPath();
      context.rect(0, 0, state.viewSize.width, state.viewSize.height);
      context.rect(
        state.hoverWindow.x,
        state.hoverWindow.y,
        state.hoverWindow.width,
        state.hoverWindow.height,
      );
      context.fill('evenodd');
      context.strokeStyle = '#2dd4bf';
      context.lineWidth = 1.5;
      context.strokeRect(
        state.hoverWindow.x + 0.5,
        state.hoverWindow.y + 0.5,
        state.hoverWindow.width - 1,
        state.hoverWindow.height - 1,
      );
      context.restore();
    } else if (!state.selection) {
      context.fillStyle = 'rgba(0, 0, 0, 0.43)';
      context.fillRect(0, 0, state.viewSize.width, state.viewSize.height);
    } else {
      context.save();
      context.beginPath();
      context.rect(state.selection.x, state.selection.y, state.selection.width, state.selection.height);
      context.clip();
      drawAnnotations(context, true);
      context.restore();

      context.save();
      context.fillStyle = 'rgba(0, 0, 0, 0.48)';
      context.beginPath();
      context.rect(0, 0, state.viewSize.width, state.viewSize.height);
      context.rect(
        state.selection.x,
        state.selection.y,
        state.selection.width,
        state.selection.height,
      );
      context.fill('evenodd');
      context.restore();
      drawSelectionFrame(context);
    }
    positionFloatingUi();
  }

  function buildPixelatedImage() {
    if (!state.image) return;
    const blockSize = 11;
    const pixelated = document.createElement('canvas');
    pixelated.width = Math.max(1, Math.ceil(state.viewSize.width / blockSize));
    pixelated.height = Math.max(1, Math.ceil(state.viewSize.height / blockSize));
    const pixelContext = pixelated.getContext('2d', { alpha: false });
    pixelContext.imageSmoothingEnabled = true;
    pixelContext.drawImage(state.image, 0, 0, pixelated.width, pixelated.height);
    state.pixelatedImage = pixelated;
  }

  function selectionDescription() {
    const physical = physicalSelection();
    if (!physical) return '尚未选择截图区域';
    return `截图区域，左 ${physical.x}，上 ${physical.y}，宽 ${physical.width}，高 ${physical.height} 像素`;
  }

  function announce(message, delay = 0) {
    if (state.announceTimer) window.clearTimeout(state.announceTimer);
    elements.srStatus.textContent = '';
    state.announceTimer = window.setTimeout(() => {
      elements.srStatus.textContent = message;
    }, delay);
  }

  function announceSelection() {
    announce(selectionDescription(), 220);
  }

  function positionFloatingUi() {
    if (!state.selection) {
      elements.toolbar.hidden = true;
      elements.sizeBadge.hidden = true;
      elements.instruction.hidden = false;
      canvas.setAttribute(
        'aria-label',
        '截图区域。单击选择窗口，拖动自由框选，按 Escape 取消。',
      );
      return;
    }

    const physical = physicalSelection();
    elements.instruction.hidden = true;
    elements.sizeBadge.hidden = false;
    elements.sizeBadge.textContent = `${physical.width} × ${physical.height} px`;
    elements.sizeBadge.style.left = `${geometry.clamp(state.selection.x, 6, state.viewSize.width - 116)}px`;
    elements.sizeBadge.style.top = `${state.selection.y >= 32 ? state.selection.y - 29 : state.selection.y + 6}px`;
    canvas.setAttribute('aria-label', selectionDescription());

    if (state.phase === 'selecting') {
      elements.toolbar.hidden = true;
      return;
    }
    elements.toolbar.hidden = false;
    const toolbarPosition = geometry.toolbarPosition(
      state.selection,
      { width: elements.toolbar.offsetWidth, height: elements.toolbar.offsetHeight },
      state.viewSize,
      10,
    );
    elements.toolbar.style.left = `${toolbarPosition.x}px`;
    elements.toolbar.style.top = `${toolbarPosition.y}px`;
    positionOpenPopovers();
  }

  function positionPopover(popover, button) {
    if (!popover.classList.contains('is-open')) return;
    const buttonRect = button.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const gap = 9;
    const left = geometry.clamp(
      buttonRect.left + buttonRect.width / 2 - popoverRect.width / 2,
      8,
      Math.max(8, state.viewSize.width - popoverRect.width - 8),
    );
    const above = buttonRect.top - popoverRect.height - gap;
    const below = buttonRect.bottom + gap;
    const top = above >= 8
      ? above
      : geometry.clamp(
        below,
        8,
        Math.max(8, state.viewSize.height - popoverRect.height - 8),
      );
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function positionOpenPopovers() {
    positionPopover(elements.colorPopover, elements.colorButton);
    positionPopover(elements.sizePopover, elements.sizeButton);
  }

  function hasOpenPopover() {
    return (
      elements.colorPopover.classList.contains('is-open') ||
      elements.sizePopover.classList.contains('is-open')
    );
  }

  function closePopovers(restoreFocus = false) {
    const focusTarget = elements.colorPopover.classList.contains('is-open')
      ? elements.colorButton
      : elements.sizePopover.classList.contains('is-open')
        ? elements.sizeButton
        : null;
    elements.colorPopover.classList.remove('is-open');
    elements.sizePopover.classList.remove('is-open');
    elements.customColorPanel.hidden = true;
    elements.customColorButton.setAttribute('aria-expanded', 'false');
    elements.colorButton.setAttribute('aria-expanded', 'false');
    elements.sizeButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) focusTarget?.focus();
  }

  function togglePopover(popover, button) {
    if (state.busy) return;
    const opening = !popover.classList.contains('is-open');
    closePopovers();
    if (opening) {
      popover.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      positionPopover(popover, button);
      popover.querySelector('button, input')?.focus();
    }
  }

  function updateToolbarState() {
    document.querySelectorAll('[data-tool]').forEach((button) => {
      const selected = button.dataset.tool === state.tool;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = state.busy;
    });
    elements.undo.disabled = state.busy || state.annotations.length === 0;
    elements.redo.disabled = state.busy || state.redoStack.length === 0;
    const settings = state.toolSettings[state.tool];
    const supportsColor = Boolean(settings?.color);
    const supportsSize = Boolean(settings);
    if (supportsColor) state.color = settings.color;
    elements.colorAnchor.hidden = !supportsColor;
    elements.sizeButton.closest('.popover-anchor').hidden = !supportsSize;
    elements.colorButton.disabled = state.busy || !supportsColor;
    elements.sizeButton.disabled = state.busy || !supportsSize;
    elements.copy.disabled = state.busy;
    elements.save.disabled = state.busy;
    elements.cancel.disabled = state.busy;
    elements.colorPreview.style.backgroundColor = state.color;
    document.querySelectorAll('[data-color]').forEach((button) => {
      const selected = button.dataset.color === state.color;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = state.busy;
    });
    const sizeConfig = state.tool === 'text'
      ? { min: 12, max: 72, step: 1, label: '文字大小' }
      : state.tool === 'mosaic'
        ? { min: 6, max: 64, step: 1, label: '马赛克笔刷' }
        : { min: 1, max: 20, step: 0.5, label: '线条粗细' };
    elements.sizeRange.min = String(sizeConfig.min);
    elements.sizeRange.max = String(sizeConfig.max);
    elements.sizeRange.step = String(sizeConfig.step);
    elements.sizeRange.value = String(settings?.size ?? 4);
    elements.sizeRange.disabled = state.busy || !supportsSize;
    elements.sizeLabel.textContent = sizeConfig.label;
    elements.sizeValue.textContent = `${settings?.size ?? 4} px`;
    elements.sizePreview.classList.toggle('is-text', state.tool === 'text');
    elements.sizePreview.classList.toggle('is-mosaic', state.tool === 'mosaic');
    if (state.tool === 'text') {
      elements.sizePreviewMark.textContent = 'Aa';
      elements.sizePreviewMark.style.fontSize = `${Math.min(settings?.size ?? 22, 30)}px`;
      elements.sizePreviewMark.style.height = 'auto';
    } else if (state.tool === 'mosaic') {
      elements.sizePreviewMark.textContent = '';
      elements.sizePreviewMark.style.fontSize = '';
      elements.sizePreviewMark.style.height = 'auto';
      elements.sizePreview.style.setProperty(
        '--mosaic-preview-size',
        `${Math.min(settings?.size ?? 24, 32)}px`,
      );
    } else {
      elements.sizePreviewMark.textContent = '';
      elements.sizePreviewMark.style.fontSize = '';
      elements.sizePreviewMark.style.height = `${Math.min(settings?.size ?? 4, 20)}px`;
    }
    if (elements.sizePopover.classList.contains('is-open')) {
      positionPopover(elements.sizePopover, elements.sizeButton);
    }
    elements.sizeButton.setAttribute(
      'aria-label',
      state.tool === 'text'
        ? '选择文字大小'
        : state.tool === 'mosaic'
          ? '选择马赛克笔刷大小'
          : '选择线条粗细',
    );
  }

  function setTool(tool) {
    if (state.busy) return;
    if (!['select', 'rect', 'ellipse', 'arrow', 'pen', 'mosaic', 'text'].includes(tool)) return;
    if (!elements.textEditor.hidden) commitText();
    state.tool = tool;
    if (state.toolSettings[tool]?.color) state.color = state.toolSettings[tool].color;
    state.draft = null;
    state.phase = state.selection ? 'ready' : 'idle';
    closePopovers();
    updateToolbarState();
    updateCursor(state.pointer);
    render();
  }

  function constrainedEnd(start, current, type, shiftKey) {
    if (!shiftKey) return geometry.clampPoint(current, viewBounds());
    if (type === 'rect' || type === 'ellipse') {
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const directionX = Math.sign(dx || 1);
      const directionY = Math.sign(dy || 1);
      const availableX = directionX > 0 ? state.viewSize.width - start.x : start.x;
      const availableY = directionY > 0 ? state.viewSize.height - start.y : start.y;
      const side = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), availableX, availableY);
      return {
        x: start.x + directionX * side,
        y: start.y + directionY * side,
      };
    }
    if (type === 'arrow') {
      const length = distance(start, current);
      const angle = Math.atan2(current.y - start.y, current.x - start.x);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return geometry.clampPoint(
        {
          x: start.x + Math.cos(snapped) * length,
          y: start.y + Math.sin(snapped) * length,
        },
        viewBounds(),
      );
    }
    return geometry.clampPoint(current, viewBounds());
  }

  function translateAnnotation(annotation, deltaX, deltaY) {
    const translated = { ...annotation };
    ['x', 'x1', 'x2'].forEach((key) => {
      if (typeof translated[key] === 'number') translated[key] += deltaX;
    });
    ['y', 'y1', 'y2'].forEach((key) => {
      if (typeof translated[key] === 'number') translated[key] += deltaY;
    });
    if (translated.points) {
      translated.points = translated.points.map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      }));
    }
    return translated;
  }

  function updateCursor(point) {
    if (!state.selection || state.tool !== 'select') {
      canvas.style.cursor = 'crosshair';
      return;
    }
    const handle = geometry.hitTestHandle(state.selection, point, HANDLE_RADIUS);
    const cursors = {
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      nw: 'nwse-resize',
      se: 'nwse-resize',
    };
    if (handle) {
      canvas.style.cursor = cursors[handle];
    } else if (geometry.containsPoint(state.selection, point)) {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }

  function createDraft(point) {
    if (state.tool === 'rect' || state.tool === 'ellipse' || state.tool === 'arrow') {
      return {
        type: state.tool,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        color: state.color,
        width: selectedStrokeSize(),
      };
    }
    if (state.tool === 'pen') {
      return {
        type: 'pen',
        points: [{ ...point }],
        color: state.color,
        width: selectedStrokeSize(),
      };
    }
    if (state.tool === 'mosaic') {
      return {
        type: 'mosaic',
        points: [{ ...point }],
        brushSize: selectedMosaicSize(),
      };
    }
    return null;
  }

  function pushAnnotation(annotation) {
    state.annotations.push(annotation);
    state.redoStack = [];
    updateToolbarState();
  }

  function undo() {
    if (state.busy || !state.annotations.length) return;
    if (!elements.textEditor.hidden) commitText();
    state.redoStack.push(state.annotations.pop());
    updateToolbarState();
    render();
    announce('已撤销');
  }

  function redo() {
    if (state.busy || !state.redoStack.length) return;
    state.annotations.push(state.redoStack.pop());
    updateToolbarState();
    render();
    announce('已重做');
  }

  function resizeTextEditor() {
    elements.textEditor.style.height = 'auto';
    elements.textEditor.style.height = `${Math.min(
      state.textEditorMaxHeight,
      elements.textEditor.scrollHeight,
    )}px`;
  }

  function startTextEditor(point) {
    if (
      state.busy ||
      !state.selection ||
      !geometry.containsPoint(state.selection, point)
    ) {
      return;
    }
    state.phase = 'text';
    state.textEditorSession += 1;
    elements.textEditor.hidden = false;
    elements.textEditor.value = '';
    elements.textEditor.style.color = state.color;
    elements.textEditor.style.fontSize = `${selectedFontSize()}px`;
    const selectionRight = state.selection.x + state.selection.width;
    const selectionBottom = state.selection.y + state.selection.height;
    const availableWidth = selectionRight - point.x;
    const width = Math.min(
      state.selection.width,
      Math.max(72, Math.min(260, availableWidth)),
    );
    const minimumHeight = Math.min(42, state.selection.height);
    const left = geometry.clamp(point.x, state.selection.x, selectionRight - width);
    const top = geometry.clamp(
      point.y,
      state.selection.y,
      selectionBottom - minimumHeight,
    );
    state.textEditorMaxHeight = Math.max(1, selectionBottom - top);
    elements.textEditor.style.width = `${width}px`;
    elements.textEditor.style.minHeight = `${minimumHeight}px`;
    elements.textEditor.style.maxHeight = `${state.textEditorMaxHeight}px`;
    elements.textEditor.style.left = `${left}px`;
    elements.textEditor.style.top = `${top}px`;
    resizeTextEditor();
    state.textAnchor = {
      x: left + elements.textEditor.clientLeft + 8,
      y: top + elements.textEditor.clientTop + 6,
    };
    window.setTimeout(() => elements.textEditor.focus(), 0);
  }

  function cancelText() {
    if (elements.textEditor.hidden) return false;
    elements.textEditor.hidden = true;
    state.textEditorSession += 1;
    elements.textEditor.value = '';
    state.textAnchor = null;
    state.phase = 'ready';
    canvas.focus();
    return true;
  }

  function commitText() {
    if (elements.textEditor.hidden) return false;
    const text = elements.textEditor.value.replace(/\s+$/u, '');
    if (text.trim() && state.textAnchor) {
      const maxWidth = Math.max(1, elements.textEditor.clientWidth - 16);
      pushAnnotation({
        type: 'text',
        x: state.textAnchor.x,
        y: state.textAnchor.y,
        text,
        color: state.color,
        fontSize: selectedFontSize(),
        maxWidth,
      });
    }
    elements.textEditor.hidden = true;
    state.textEditorSession += 1;
    elements.textEditor.value = '';
    state.textAnchor = null;
    state.phase = 'ready';
    render();
    return true;
  }

  function beginPointerAction(event) {
    if (!state.image || state.busy || event.button !== 0) return;
    if (!elements.textEditor.hidden && state.isComposing) {
      event.preventDefault();
      return;
    }
    if (!elements.textEditor.hidden) commitText();
    if (hasOpenPopover()) state.popoverDismissedAt = Date.now();
    closePopovers();
    const point = pointFromEvent(event);
    state.pointer = point;
    state.dragStart = point;

    if (!state.selection) {
      state.hoverWindow = windowAtPoint(point);
      state.phase = state.hoverWindow ? 'pending-window-snap' : 'selecting';
      state.selection = state.hoverWindow
        ? null
        : { x: point.x, y: point.y, width: 0, height: 0 };
      state.annotations = [];
      state.redoStack = [];
    } else if (state.tool === 'select') {
      const handle = geometry.hitTestHandle(state.selection, point, HANDLE_RADIUS);
      if (handle) {
        state.phase = 'resizing';
        state.activeHandle = handle;
        state.baseSelection = { ...state.selection };
      } else if (geometry.containsPoint(state.selection, point)) {
        state.phase = 'moving';
        state.baseSelection = { ...state.selection };
        state.baseAnnotations = copyAnnotations(state.annotations);
      } else {
        state.phase = 'pending-selection';
        state.baseSelection = { ...state.selection };
        state.baseAnnotations = copyAnnotations(state.annotations);
        state.baseRedoStack = copyAnnotations(state.redoStack);
      }
    } else if (geometry.containsPoint(state.selection, point)) {
      if (state.tool === 'text') {
        startTextEditor(point);
        state.dragStart = null;
        render();
        return;
      }
      state.draft = createDraft(point);
      state.phase = state.draft ? 'drawing' : 'ready';
    } else {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    updateToolbarState();
    render();
    updateMagnifier(point);
  }

  function movePointer(event) {
    if (!state.image) return;
    const point = pointFromEvent(event);
    state.pointer = point;
    state.pointerOnCanvas = true;

    if (state.phase === 'pending-window-snap') {
      if (distance(state.dragStart, point) >= 4) {
        state.phase = 'selecting';
        state.hoverWindow = null;
        state.selection = geometry.clampRect(
          geometry.rectFromPoints(state.dragStart, point),
          viewBounds(),
        );
      }
    } else if (state.phase === 'pending-selection') {
      if (distance(state.dragStart, point) >= 4) {
        state.phase = 'selecting';
        state.selection = geometry.clampRect(
          geometry.rectFromPoints(state.dragStart, point),
          viewBounds(),
        );
        state.annotations = [];
        state.redoStack = [];
      }
    } else if (state.phase === 'selecting') {
      state.selection = geometry.clampRect(
        geometry.rectFromPoints(state.dragStart, point),
        viewBounds(),
      );
    } else if (state.phase === 'moving') {
      const requestedDelta = {
        x: point.x - state.dragStart.x,
        y: point.y - state.dragStart.y,
      };
      const moved = geometry.moveRect(state.baseSelection, requestedDelta, viewBounds());
      const actualX = moved.x - state.baseSelection.x;
      const actualY = moved.y - state.baseSelection.y;
      state.selection = moved;
      state.annotations = state.baseAnnotations.map((annotation) =>
        translateAnnotation(annotation, actualX, actualY),
      );
    } else if (state.phase === 'resizing') {
      state.selection = geometry.resizeRect(
        state.baseSelection,
        state.activeHandle,
        point,
        viewBounds(),
        MIN_SELECTION_SIZE,
      );
    } else if (state.phase === 'drawing' && state.draft) {
      if (['rect', 'ellipse', 'arrow'].includes(state.draft.type)) {
        const end = constrainedEnd(state.dragStart, point, state.draft.type, event.shiftKey);
        state.draft.x2 = end.x;
        state.draft.y2 = end.y;
      } else if (state.draft.points) {
        const previous = state.draft.points[state.draft.points.length - 1];
        if (distance(previous, point) >= 1.2) state.draft.points.push({ ...point });
      }
    } else {
      if (!state.selection) state.hoverWindow = windowAtPoint(point);
      updateCursor(point);
    }

    render();
    updateMagnifier(point);
  }

  function releasePointer(event) {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function clearPointerActionState() {
    state.dragStart = null;
    state.baseSelection = null;
    state.baseAnnotations = null;
    state.baseRedoStack = null;
    state.activeHandle = null;
  }

  function cancelPointerAction(event) {
    const priorPhase = state.phase;
    if (priorPhase === 'drawing') {
      state.draft = null;
    } else if (priorPhase === 'moving') {
      state.selection = state.baseSelection ? { ...state.baseSelection } : state.selection;
      state.annotations = state.baseAnnotations
        ? copyAnnotations(state.baseAnnotations)
        : state.annotations;
    } else if (priorPhase === 'resizing') {
      state.selection = state.baseSelection ? { ...state.baseSelection } : state.selection;
    } else if (
      priorPhase === 'selecting' ||
      priorPhase === 'pending-selection' ||
      priorPhase === 'pending-window-snap'
    ) {
      state.selection = state.baseSelection ? { ...state.baseSelection } : null;
      state.annotations = state.baseAnnotations ? copyAnnotations(state.baseAnnotations) : [];
      state.redoStack = state.baseRedoStack ? copyAnnotations(state.baseRedoStack) : [];
    }
    state.draft = null;
    state.phase = state.selection ? 'ready' : 'idle';
    clearPointerActionState();
    releasePointer(event);
    updateToolbarState();
    updateCursor(state.pointer);
    render();
    updateMagnifier(state.pointer, false);
  }

  function finishPointerAction(event) {
    if (!state.image) return;
    if (event.type === 'pointercancel') {
      cancelPointerAction(event);
      return;
    }
    if (event.button !== 0) return;
    const priorPhase = state.phase;

    if (priorPhase === 'pending-window-snap') {
      if (state.hoverWindow) {
        state.selection = snapSelectionToPixels(state.hoverWindow);
        state.hoverWindow = null;
        state.phase = 'ready';
        announceSelection();
      } else {
        state.phase = 'idle';
      }
    } else if (priorPhase === 'pending-selection') {
      state.phase = 'ready';
    } else if (priorPhase === 'selecting') {
      if (
        !state.selection ||
        state.selection.width < MIN_SELECTION_SIZE ||
        state.selection.height < MIN_SELECTION_SIZE
      ) {
        state.selection = state.baseSelection ? { ...state.baseSelection } : null;
        state.annotations = state.baseAnnotations ? copyAnnotations(state.baseAnnotations) : [];
        state.redoStack = state.baseRedoStack ? copyAnnotations(state.baseRedoStack) : [];
      } else {
        snapCurrentSelection();
        announceSelection();
      }
      state.phase = state.selection ? 'ready' : 'idle';
    } else if (priorPhase === 'drawing') {
      if (state.draft) {
        let valid = true;
        if (['rect', 'ellipse'].includes(state.draft.type)) {
          valid =
            Math.abs(state.draft.x2 - state.draft.x1) >= 3 &&
            Math.abs(state.draft.y2 - state.draft.y1) >= 3;
        } else if (state.draft.type === 'arrow') {
          valid = distance(
            { x: state.draft.x1, y: state.draft.y1 },
            { x: state.draft.x2, y: state.draft.y2 },
          ) >= 6;
        } else if (state.draft.points) {
          valid = state.draft.points.length > 1;
        }
        if (valid) pushAnnotation(state.draft);
      }
      state.draft = null;
      state.phase = 'ready';
    } else if (priorPhase === 'moving') {
      snapCurrentSelection(true);
      if (!rectsEqual(state.baseSelection, state.selection)) state.redoStack = [];
      state.phase = 'ready';
      announceSelection();
    } else if (priorPhase === 'resizing') {
      snapCurrentSelection();
      if (!rectsEqual(state.baseSelection, state.selection)) state.redoStack = [];
      state.phase = 'ready';
      announceSelection();
    }

    clearPointerActionState();
    releasePointer(event);
    updateToolbarState();
    updateCursor(state.pointer);
    render();
    updateMagnifier(state.pointer, false);
  }

  function updateMagnifier(point, force = true) {
    if (
      !state.image ||
      !state.magnifierEnabled ||
      state.pointerInUi ||
      (!force && !['selecting', 'resizing', 'drawing'].includes(state.phase))
    ) {
      elements.magnifier.hidden = true;
      return;
    }

    const scale = physicalScale();
    const pixelX = geometry.clamp(Math.floor(point.x * scale.x), 0, state.image.width - 1);
    const pixelY = geometry.clamp(Math.floor(point.y * scale.y), 0, state.image.height - 1);
    const sourceWidth = Math.max(9, Math.round(15 * Math.max(scale.x, scale.y)));
    const sourceHeight = sourceWidth;
    const sourceX = geometry.clamp(
      pixelX - Math.floor(sourceWidth / 2),
      0,
      Math.max(0, state.image.width - sourceWidth),
    );
    const sourceY = geometry.clamp(
      pixelY - Math.floor(sourceHeight / 2),
      0,
      Math.max(0, state.image.height - sourceHeight),
    );

    magnifierContext.save();
    magnifierContext.clearRect(0, 0, 120, 120);
    magnifierContext.imageSmoothingEnabled = false;
    magnifierContext.drawImage(
      state.image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      120,
      120,
    );
    magnifierContext.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    magnifierContext.lineWidth = 1;
    const cell = 120 / sourceWidth;
    if (cell >= 5) {
      magnifierContext.beginPath();
      for (let grid = cell; grid < 120; grid += cell) {
        magnifierContext.moveTo(grid, 0);
        magnifierContext.lineTo(grid, 120);
        magnifierContext.moveTo(0, grid);
        magnifierContext.lineTo(120, grid);
      }
      magnifierContext.stroke();
    }
    magnifierContext.strokeStyle = '#2dd4bf';
    magnifierContext.lineWidth = 1.5;
    magnifierContext.beginPath();
    magnifierContext.moveTo(60, 0);
    magnifierContext.lineTo(60, 120);
    magnifierContext.moveTo(0, 60);
    magnifierContext.lineTo(120, 60);
    magnifierContext.stroke();
    magnifierContext.restore();

    sampleContext.clearRect(0, 0, 1, 1);
    sampleContext.drawImage(state.image, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    const [red, green, blue] = sampleContext.getImageData(0, 0, 1, 1).data;
    const hex = `#${[red, green, blue]
      .map((component) => component.toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase();
    elements.pixelPosition.textContent = `${pixelX}, ${pixelY}`;
    elements.pixelHex.textContent = hex;
    elements.pixelSwatch.style.background = hex;

    const gap = 18;
    const boxWidth = 132;
    const boxHeight = 154;
    let left = point.x + gap;
    let top = point.y + gap;
    if (left + boxWidth > state.viewSize.width - 8) left = point.x - boxWidth - gap;
    if (top + boxHeight > state.viewSize.height - 8) top = point.y - boxHeight - gap;
    elements.magnifier.style.left = `${Math.max(8, left)}px`;
    elements.magnifier.style.top = `${Math.max(8, top)}px`;
    elements.magnifier.hidden = false;
  }

  function hideMagnifier() {
    state.pointerOnCanvas = false;
    elements.magnifier.hidden = true;
  }

  function showToast(message, error = false, timeout = 1800) {
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('is-error', error);
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, timeout);
  }

  function setBusy(busy) {
    state.busy = busy;
    if (busy) closePopovers();
    canvas.setAttribute('aria-busy', String(busy));
    elements.toolbar.setAttribute('aria-busy', String(busy));
    updateToolbarState();
  }

  async function exportSelectionPng() {
    if (!state.selection || !state.image) throw new Error('请先选择截图区域');
    if (!elements.textEditor.hidden) commitText();
    const source = physicalSelection();
    const output = document.createElement('canvas');
    output.width = source.width;
    output.height = source.height;
    const outputContext = output.getContext('2d', { alpha: false });
    outputContext.drawImage(
      state.image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      output.width,
      output.height,
    );

    outputContext.save();
    const scale = physicalScale();
    outputContext.setTransform(
      scale.x,
      0,
      0,
      scale.y,
      -source.x,
      -source.y,
    );
    outputContext.beginPath();
    outputContext.rect(
      state.selection.x,
      state.selection.y,
      state.selection.width,
      state.selection.height,
    );
    outputContext.clip();
    drawAnnotations(outputContext, false);
    outputContext.restore();

    const blob = await new Promise((resolve, reject) => {
      output.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('PNG 编码失败'))),
        'image/png',
      );
    });
    return blob.arrayBuffer();
  }

  function screenshotFilename() {
    const now = new Date();
    const part = (value) => String(value).padStart(2, '0');
    return `SnapCut_${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}_${part(now.getHours())}-${part(now.getMinutes())}-${part(now.getSeconds())}.png`;
  }

  async function copyAndFinish() {
    if (state.busy || !state.image) return;
    if (!state.selection) {
      selectFullScreen();
      render();
      announceSelection();
    }
    setBusy(true);
    closePopovers();
    elements.magnifier.hidden = true;
    try {
      const pngBytes = await exportSelectionPng();
      if (window.snapcut) {
        await window.snapcut.copyImage(pngBytes);
      }
      showToast('已复制到剪贴板');
      announce('截图已复制到剪贴板');
      window.setTimeout(() => window.snapcut?.closeOverlay(), 260);
    } catch (error) {
      showToast(`复制失败：${error.message || error}`, true, 3200);
      setBusy(false);
    }
  }

  async function saveAndFinish() {
    if (state.busy || !state.selection) return;
    setBusy(true);
    closePopovers();
    elements.magnifier.hidden = true;
    try {
      const pngBytes = await exportSelectionPng();
      if (!window.snapcut) {
        const blob = new Blob([pngBytes], { type: 'image/png' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = screenshotFilename();
        link.click();
        URL.revokeObjectURL(link.href);
        showToast('预览图片已下载');
        setBusy(false);
        return;
      }
      const result = await window.snapcut.saveImage(pngBytes, screenshotFilename());
      if (result.canceled) {
        setBusy(false);
        return;
      }
      showToast('截图已保存');
      announce('截图已保存');
      window.setTimeout(() => window.snapcut.closeOverlay(), 260);
    } catch (error) {
      showToast(`保存失败：${error.message || error}`, true, 3200);
      setBusy(false);
    }
  }

  function cancelCurrentOrClose() {
    if (state.busy) return;
    if (cancelText()) {
      render();
      return;
    }
    if (
      elements.colorPopover.classList.contains('is-open') ||
      elements.sizePopover.classList.contains('is-open')
    ) {
      closePopovers(true);
      return;
    }
    if (state.draft) {
      state.draft = null;
      state.phase = state.selection ? 'ready' : 'idle';
      render();
      return;
    }
    window.snapcut?.closeOverlay();
  }

  function moveSelectionByKeyboard(event) {
    if (state.busy || !state.selection || state.tool !== 'select') return false;
    const directions = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return false;
    const scale = physicalScale();
    const physicalStep = event.shiftKey ? 10 : 1;
    const delta = {
      x: (direction.x * physicalStep) / scale.x,
      y: (direction.y * physicalStep) / scale.y,
    };
    const original = { ...state.selection };
    const moved = snapSelectionToPixels(geometry.moveRect(original, delta, viewBounds()));
    const actualX = moved.x - original.x;
    const actualY = moved.y - original.y;
    state.selection = moved;
    state.annotations = state.annotations.map((annotation) =>
      translateAnnotation(annotation, actualX, actualY),
    );
    if (actualX || actualY) state.redoStack = [];
    updateToolbarState();
    render();
    announceSelection();
    return true;
  }

  function handleKeydown(event) {
    if (state.busy) {
      event.preventDefault();
      return;
    }
    if (!elements.textEditor.hidden || state.isComposing || event.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCurrentOrClose();
      return;
    }
    if (modifier && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier && key === 'c') {
      event.preventDefault();
      copyAndFinish();
      return;
    }
    if (modifier && key === 's') {
      event.preventDefault();
      saveAndFinish();
      return;
    }
    if (
      event.key === 'Enter' &&
      !event.target.closest?.('button, textarea, input, select, [role="menuitem"]')
    ) {
      event.preventDefault();
      copyAndFinish();
      return;
    }
    if (moveSelectionByKeyboard(event)) {
      event.preventDefault();
      return;
    }
    if (key === 'm') {
      state.magnifierEnabled = !state.magnifierEnabled;
      if (!state.magnifierEnabled) elements.magnifier.hidden = true;
      announce(state.magnifierEnabled ? '放大镜已开启' : '放大镜已关闭');
      return;
    }
    const tools = { v: 'select', r: 'rect', o: 'ellipse', a: 'arrow', p: 'pen', b: 'mosaic', t: 'text' };
    if (!modifier && tools[key]) {
      event.preventDefault();
      setTool(tools[key]);
    }
  }

  function handleDoubleClick(event) {
    if (
      !state.image ||
      state.busy ||
      state.tool !== 'select' ||
      state.draft ||
      !elements.textEditor.hidden ||
      hasOpenPopover() ||
      Date.now() - state.popoverDismissedAt < 500
    ) {
      return;
    }
    const point = pointFromEvent(event);
    if (state.selection && geometry.containsPoint(state.selection, point)) {
      copyAndFinish();
      return;
    }
    selectFullScreen();
    render();
    announceSelection();
  }

  async function activateCapture(payload) {
    const blob = new Blob([payload.pngBytes], { type: 'image/png' });
    state.image = await createImageBitmap(blob);
    state.windowRects = Array.isArray(payload.windows) ? payload.windows : [];
    state.pixelSize = payload.pixelSize || { width: state.image.width, height: state.image.height };
    state.viewSize = { width: window.innerWidth, height: window.innerHeight };
    state.magnifierEnabled = payload.settings?.showMagnifier !== false;
    canvas.width = state.image.width;
    canvas.height = state.image.height;
    buildPixelatedImage();
    elements.loading.hidden = true;
    canvas.focus();
    if (payload.demo) {
      state.selection = snapSelectionToPixels({
        x: Math.round(state.viewSize.width * 0.15),
        y: Math.round(state.viewSize.height * 0.16),
        width: Math.round(state.viewSize.width * 0.62),
        height: Math.round(state.viewSize.height * 0.56),
      });
      state.phase = 'ready';
    }
    updateToolbarState();
    render();
  }

  async function createDemoCapture() {
    const demo = document.createElement('canvas');
    demo.width = 1440;
    demo.height = 900;
    const demoContext = demo.getContext('2d');
    const gradient = demoContext.createLinearGradient(0, 0, 1440, 900);
    gradient.addColorStop(0, '#e7f7f4');
    gradient.addColorStop(0.48, '#f8fbfb');
    gradient.addColorStop(1, '#dbeafe');
    demoContext.fillStyle = gradient;
    demoContext.fillRect(0, 0, 1440, 900);
    demoContext.fillStyle = '#ffffff';
    demoContext.shadowColor = 'rgba(15, 118, 110, .16)';
    demoContext.shadowBlur = 40;
    demoContext.fillRect(150, 120, 1140, 660);
    demoContext.shadowColor = 'transparent';
    demoContext.fillStyle = '#0d9488';
    demoContext.fillRect(150, 120, 1140, 74);
    demoContext.fillStyle = '#ffffff';
    demoContext.font = '700 28px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    demoContext.fillText('SnapCut · Preview workspace', 190, 167);
    demoContext.fillStyle = '#153a37';
    demoContext.font = '700 46px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    demoContext.fillText('一键截图，画面只留在你的电脑里', 215, 300);
    demoContext.fillStyle = '#5d7774';
    demoContext.font = '24px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    demoContext.fillText('拖动选区 · 添加箭头、文字和马赛克 · 复制即走', 215, 350);
    ['区域截图', '本地标注', 'Windows + macOS'].forEach((label, index) => {
      const x = 215 + index * 300;
      demoContext.fillStyle = ['#ccfbf1', '#fee2e2', '#dbeafe'][index];
      demoContext.fillRect(x, 430, 250, 140);
      demoContext.fillStyle = ['#0f766e', '#b91c1c', '#1d4ed8'][index];
      demoContext.font = '700 24px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      demoContext.fillText(label, x + 24, 490);
      demoContext.font = '16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      demoContext.fillText('快速、清楚、无上传', x + 24, 530);
    });
    const blob = await new Promise((resolve) => demo.toBlob(resolve, 'image/png'));
    await activateCapture({
      pngBytes: await blob.arrayBuffer(),
      pixelSize: { width: demo.width, height: demo.height },
      settings: { showMagnifier: true },
      demo: true,
    });
  }

  canvas.addEventListener('pointerdown', beginPointerAction);
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerup', finishPointerAction);
  canvas.addEventListener('pointercancel', finishPointerAction);
  canvas.addEventListener('pointerleave', () => {
    state.hoverWindow = null;
    hideMagnifier();
    if (!state.selection) render();
  });
  canvas.addEventListener('pointerenter', () => {
    state.pointerOnCanvas = true;
  });
  canvas.addEventListener('dblclick', handleDoubleClick);
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    cancelCurrentOrClose();
  });

  elements.toolbar.addEventListener('pointerenter', () => {
    state.pointerInUi = true;
    elements.magnifier.hidden = true;
  });
  elements.toolbar.addEventListener('pointerleave', () => {
    state.pointerInUi = false;
  });
  elements.toolbar.addEventListener('pointerdown', (event) => event.stopPropagation());
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  elements.colorButton.addEventListener('click', () =>
    togglePopover(elements.colorPopover, elements.colorButton),
  );
  elements.sizeButton.addEventListener('click', () =>
    togglePopover(elements.sizePopover, elements.sizeButton),
  );
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.busy) return;
      state.color = button.dataset.color;
      if (state.toolSettings[state.tool]?.color) {
        state.toolSettings[state.tool].color = state.color;
      }
      elements.textEditor.style.color = state.color;
      closePopovers(true);
      updateToolbarState();
    });
  });
  elements.customColorButton.addEventListener('click', () => {
    if (state.busy || !state.toolSettings[state.tool]?.color) return;
    const opening = elements.customColorPanel.hidden;
    elements.customColorPanel.hidden = !opening;
    elements.customColorButton.setAttribute('aria-expanded', String(opening));
    if (opening) {
      syncCustomColorControls();
      elements.customColorHue.focus();
    }
    positionPopover(elements.colorPopover, elements.colorButton);
  });
  [elements.customColorHue, elements.customColorSaturation, elements.customColorLightness]
    .forEach((control) => control.addEventListener('input', applyCustomColorControls));
  elements.customColorHex.addEventListener('input', () => {
    const normalized = normalizeHexColor(elements.customColorHex.value);
    if (!normalized || !applyColor(normalized)) return;
    const hsl = hexToHsl(normalized);
    elements.customColorHue.value = String(hsl.hue);
    elements.customColorSaturation.value = String(hsl.saturation);
    elements.customColorLightness.value = String(hsl.lightness);
    elements.customColorHueValue.textContent = `${hsl.hue}°`;
    elements.customColorSaturationValue.textContent = `${hsl.saturation}%`;
    elements.customColorLightnessValue.textContent = `${hsl.lightness}%`;
  });
  elements.customColorHex.addEventListener('blur', () => syncCustomColorControls());
  elements.sizeRange.addEventListener('input', () => {
    if (state.busy || !state.toolSettings[state.tool]) return;
    state.toolSettings[state.tool].size = Number(elements.sizeRange.value);
    elements.textEditor.style.fontSize = `${selectedFontSize()}px`;
    updateToolbarState();
  });
  elements.undo.addEventListener('click', undo);
  elements.redo.addEventListener('click', redo);
  elements.copy.addEventListener('click', copyAndFinish);
  elements.save.addEventListener('click', saveAndFinish);
  elements.cancel.addEventListener('click', cancelCurrentOrClose);

  elements.textEditor.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  elements.textEditor.addEventListener('compositionend', () => {
    state.isComposing = false;
  });
  elements.textEditor.addEventListener('keydown', (event) => {
    if (event.isComposing || state.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelText();
      render();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      commitText();
      canvas.focus();
    }
  });
  elements.textEditor.addEventListener('input', () => {
    resizeTextEditor();
  });
  elements.textEditor.addEventListener('blur', () => {
    const session = state.textEditorSession;
    window.setTimeout(() => {
      if (
        session === state.textEditorSession &&
        !elements.textEditor.hidden &&
        !state.isComposing
      ) {
        commitText();
      }
    }, 0);
  });

  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.popover-anchor, .popover')) closePopovers();
  });
  window.addEventListener('resize', () => {
    state.viewSize = { width: window.innerWidth, height: window.innerHeight };
    if (state.image) {
      buildPixelatedImage();
      if (state.selection) state.selection = geometry.clampRect(state.selection, viewBounds());
      render();
    }
  });

  if (window.snapcut) {
    window.snapcut.onCaptureReady((payload) => {
      activateCapture(payload)
        .then(() => window.snapcut.captureLoaded())
        .catch((error) => {
          const message = `截图画面加载失败：${error.message || error}`;
          showToast(message, true, 5000);
          window.snapcut.captureLoadFailed(message);
        });
    });
    window.snapcut.onCaptureError((error) => {
      showToast(error.message || '截图失败', true, 5000);
    });
  } else {
    createDemoCapture().catch((error) => {
      elements.loading.textContent = `预览加载失败：${error.message || error}`;
    });
  }
})();
