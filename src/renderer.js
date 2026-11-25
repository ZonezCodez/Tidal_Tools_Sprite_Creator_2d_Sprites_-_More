(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const paletteDefaults = ['#0B0E13','#F3F6FA','#C7FF43','#B58AFF','#FF5D7A','#FFCA58','#55DEA5','#25D4C8','#FF8248','#788BFF','#354252','#929EAE','#D4DCE6','#FFE2A6','#B85C9D','#347F88'];
  const toolKeys = { pencil:'b', eraser:'e', fill:'g', eyedropper:'i', line:'l', rect:'u', ellipse:'o', select:'m', hand:'h' };
  const toolNames = { pencil:'Pencil', eraser:'Eraser', fill:'Paint bucket', eyedropper:'Eyedropper', line:'Line', rect:'Rectangle', ellipse:'Ellipse', select:'Selection', hand:'Hand' };
  const TRANSPARENT = [0,0,0,0];

  let doc;
  let activeLayer = 2;
  let activeTool = 'pencil';
  let currentColor = '#18212B';
  let backgroundColor = '#F3F6FA';
  let brushSize = 1;
  let shapeMode = 'outline';
  let zoom = 8;
  let fitToAreaActive = true;
  let focusMode = false;
  let canvasOffsetX = 64;
  let canvasOffsetY = 64;
  let showGrid = true;
  let showOnion = false;
  let playing = false;
  let playTimer = null;
  let spaceDown = false;
  let stroke = null;
  let selection = null;
  let hoveredSelectionHandle = null;
  // A floating selection is a non-destructive preview until the user applies it.
  let transformState = null;
  let selectionClipboard = null;
  let playbackSequence = [];
  let playbackPosition = 0;
  let playbackClipName = 'all';
  let history = [];
  let future = [];
  let dirty = false;
  let lastSavedPath = '';
  let autosaveTimer = null;
  let toastTimer = null;
  let menuElement = null;
  const THEME_KEY = 'spritecreator-theme';
  const THEME_PRESETS = {
    onyx: { label: 'Onyx', short: 'Onyx', ui: 'dark', canvas: 'dark', description: 'Dark interface · dark canvas' },
    prism: { label: 'Prism', short: 'Prism', ui: 'light', canvas: 'light', description: 'Light interface · light canvas' },
    'onyx-prism': { label: 'Onyx / Prism Canvas', short: 'Onyx + Light Canvas', ui: 'dark', canvas: 'light', description: 'Dark interface · light canvas' },
    'prism-onyx': { label: 'Prism / Onyx Canvas', short: 'Prism + Dark Canvas', ui: 'light', canvas: 'dark', description: 'Light interface · dark canvas' }
  };
  const THEME_ORDER = ['onyx', 'prism', 'onyx-prism', 'prism-onyx'];
  function normalizeTheme(value) {
    if (value === 'dark') return 'onyx';
    if (value === 'light') return 'prism';
    return Object.prototype.hasOwnProperty.call(THEME_PRESETS, value) ? value : 'onyx';
  }
  function getThemePreference() {
    try { return normalizeTheme(localStorage.getItem(THEME_KEY) || 'onyx'); }
    catch { return 'onyx'; }
  }
  let activeTheme = getThemePreference();
  function applyTheme(theme, persist = true) {
    activeTheme = normalizeTheme(theme);
    const preset = THEME_PRESETS[activeTheme];
    const root = document.documentElement;
    root.dataset.theme = preset.ui;
    root.dataset.canvasTheme = preset.canvas;
    const button = $('themeBtn');
    if (button) {
      button.textContent = '◐ Themes';
      button.setAttribute('aria-label', `Current theme: ${preset.label}. Click to cycle themes.`);
      button.title = `Current: ${preset.label} (${preset.description}). Click to cycle themes; choose directly in View.`;
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = preset.ui === 'dark' ? '#050608' : '#E9EDF2';
    if (persist) {
      try { localStorage.setItem(THEME_KEY, activeTheme); }
      catch (error) { console.warn('Could not save theme preference:', error); }
    }
  }
  function toggleTheme() {
    const index = THEME_ORDER.indexOf(activeTheme);
    const next = THEME_ORDER[(index + 1) % THEME_ORDER.length];
    applyTheme(next);
    const preset = THEME_PRESETS[next];
    setStatus(`Switched to ${preset.label}. Your preference is saved.`);
    toast(`${preset.label} theme enabled.`);
  }

  const TUTORIAL_TIPS_KEY = 'spritecreator-show-tutorial-tips';
  let tutorialTipsTimer = null;
  let editorIsReady = false;
  let exitSequenceActive = false;
  let exitSequenceTimer = null;
  let tutorialTipsEnabled = (() => {
    try { return localStorage.getItem(TUTORIAL_TIPS_KEY) !== 'false'; }
    catch { return true; }
  })();

  const viewport = $('canvasViewport');
  const stack = $('canvasStack');
  const surround = stack.parentElement;
  const displayCanvas = $('displayCanvas');
  const overlayCanvas = $('overlayCanvas');
  const onionCanvas = $('onionCanvas');
  const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext('2d');
  const onionCtx = onionCanvas.getContext('2d');

  function uniqueId() { return globalThis.crypto?.randomUUID?.() || `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,11)}`; }
  function blankPixels(w, h) { return new Uint8ClampedArray(w * h * 4); }
  function makeLayer(name, frameCount, w, h) {
    return { id: uniqueId(), name, visible: true, opacity: 100, frames: Array.from({length: frameCount}, () => blankPixels(w,h)) };
  }
  function makeDocument(w=32,h=32,name='Untitled Sprite') {
    const layers = [makeLayer('Background',1,w,h), makeLayer('Color',1,w,h), makeLayer('Outline',1,w,h)];
    return { format:'spritecreator', version:2, name, width:w, height:h, fps:8, frameIndex:0, frameIds:[uniqueId()], frameDurations:[null], frameTags:[], layers, palette:[...paletteDefaults], assetInfo:{type:'character',animationName:'default',pivot:{x:0.5,y:0.5}}, createdAt:new Date().toISOString() };
  }
  function cloneDoc(source=doc) {
    return {
      format:source.format, version:source.version, name:source.name, width:source.width, height:source.height,
      fps:source.fps, frameIndex:source.frameIndex, frameIds:[...(source.frameIds||[])], frameDurations:[...(source.frameDurations||source.frameIds?.map(()=>null)||[])], frameTags:JSON.parse(JSON.stringify(source.frameTags||[])), palette:[...source.palette], assetInfo:JSON.parse(JSON.stringify(source.assetInfo||{type:'character',animationName:'default',pivot:{x:0.5,y:0.5}})), createdAt:source.createdAt,
      layers:source.layers.map(layer => ({ id:layer.id, name:layer.name, visible:layer.visible, opacity:layer.opacity, frames:layer.frames.map(p=>new Uint8ClampedArray(p)) }))
    };
  }
  function pushHistory() {
    history.push(cloneDoc());
    if (history.length > 60) history.shift();
    future.length = 0;
    setDirty(true);
  }
  function setDirty(value=true) {
    dirty = value;
    const status = $('saveStatus');
    status.classList.toggle('unsaved', value);
    status.classList.remove('saving');
    status.innerHTML = value ? '<i></i> Unsaved changes' : '<i></i> All changes saved';
    if (value) scheduleAutosave();
  }
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        const data = serializeProject();
        if (data.length < 4_500_000) {
          localStorage.setItem('spritecreator-autosave', data);
          localStorage.setItem('spritecreator-autosave-name', doc.name);
          const status = $('saveStatus');
          status.classList.remove('unsaved','saving');
          status.innerHTML = '<i></i> Saved on this device';
        }
      } catch (error) { console.warn('Autosave skipped:', error); }
    }, 1300);
  }
  function markClean() { setDirty(false); }

  function updateTipsButton() {
    const button = $('tipsBtn');
    if (!button) return;
    button.textContent = tutorialTipsEnabled ? '✦ Tips On' : '✦ Tips Off';
    button.setAttribute('aria-pressed', String(tutorialTipsEnabled));
    button.classList.toggle('tips-enabled', tutorialTipsEnabled);
    button.title = tutorialTipsEnabled
      ? 'Tutorial tips appear for 15 seconds after opening. Click to turn them off.'
      : 'Tutorial tips are disabled on startup. Click to show them for 15 seconds.';
  }

  function setTutorialTipsEnabled(enabled, persist = true) {
    tutorialTipsEnabled = Boolean(enabled);
    clearTimeout(tutorialTipsTimer);
    const cards = [...document.querySelectorAll('.tutorial-tip')];
    cards.forEach(card => card.classList.toggle('tip-hidden', !tutorialTipsEnabled));
    updateTipsButton();
    if (persist) {
      try { localStorage.setItem(TUTORIAL_TIPS_KEY, String(tutorialTipsEnabled)); }
      catch (error) { console.warn('Could not save tutorial-tip preference:', error); }
    }
    if (tutorialTipsEnabled && editorIsReady) {
      tutorialTipsTimer = setTimeout(() => {
        cards.forEach(card => card.classList.add('tip-hidden'));
      }, 15000);
    }
  }

  function toggleTutorialTips() {
    setTutorialTipsEnabled(!tutorialTipsEnabled);
    setStatus(tutorialTipsEnabled ? 'Tutorial tips enabled for 15 seconds.' : 'Tutorial tips disabled. Your preference is saved.');
  }

  function setStatus(message) { $('statusMessage').textContent = message; }
  function toast(message, kind='') {
    const host = $('toastHost');
    const item = document.createElement('div');
    item.className = `toast ${kind}`;
    item.textContent = message;
    host.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }
  function hexToRgba(hex) {
    const value = hex.replace('#','');
    return [parseInt(value.slice(0,2),16),parseInt(value.slice(2,4),16),parseInt(value.slice(4,6),16),255];
  }
  function rgbaToHex(r,g,b) { return '#' + [r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase(); }
  function pixelIndex(x,y) { return (y * doc.width + x) * 4; }
  function currentPixels() { return doc.layers[activeLayer].frames[doc.frameIndex]; }

  function compositeFrame(frameIndex, options={}) {
    const canvas = document.createElement('canvas');
    canvas.width = doc.width; canvas.height = doc.height;
    const ctx = canvas.getContext('2d');
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      let pixels = layer.frames[frameIndex];
      if (!pixels) continue;
      const floating=options.floating&&options.floating.layerId===layer.id&&options.floating.frameIndex===frameIndex?options.floating:null;
      if(floating) {
        pixels=new Uint8ClampedArray(pixels);
        const sourceRect=floating.sourceRect;
        for(let y=Math.max(0,sourceRect.y);y<Math.min(doc.height,sourceRect.y+sourceRect.h);y++) {
          const start=(y*doc.width+Math.max(0,sourceRect.x))*4;
          const end=(y*doc.width+Math.min(doc.width,sourceRect.x+sourceRect.w))*4;
          pixels.fill(0,start,end);
        }
        const r=floating.rect;
        for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++) {
          const dx=r.x+x,dy=r.y+y;
          if(dx<0||dy<0||dx>=doc.width||dy>=doc.height)continue;
          // Composite the floating cel over the layer: transparent holes stay see-through.
          blendPixelOver(pixels,(dy*doc.width+dx)*4,floating.pixels,(y*r.w+x)*4);
        }
      } else if (options.clearRegion && layer.id === options.clearLayerId && (options.clearFrameIndex == null || options.clearFrameIndex === frameIndex)) {
        pixels = new Uint8ClampedArray(pixels);
        const r = options.clearRegion;
        for (let y=Math.max(0,r.y); y<Math.min(doc.height,r.y+r.h); y++) {
          const start=(y*doc.width+Math.max(0,r.x))*4;
          const end=(y*doc.width+Math.min(doc.width,r.x+r.w))*4;
          pixels.fill(0,start,end);
        }
      }
      const image = new ImageData(new Uint8ClampedArray(pixels), doc.width, doc.height);
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = doc.width; layerCanvas.height = doc.height;
      layerCanvas.getContext('2d').putImageData(image,0,0);
      ctx.globalAlpha = layer.opacity / 100;
      ctx.drawImage(layerCanvas,0,0);
    }
    ctx.globalAlpha = 1;
    if (options.background) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = options.background;
      ctx.fillRect(0,0,doc.width,doc.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return canvas;
  }

  function refreshCanvasSize(requiredScrollX=viewport.scrollLeft, requiredScrollY=viewport.scrollTop) {
    for (const canvas of [displayCanvas,overlayCanvas,onionCanvas]) {
      if (canvas.width !== doc.width) canvas.width = doc.width;
      if (canvas.height !== doc.height) canvas.height = doc.height;
    }
    const stackWidth = doc.width * zoom;
    const stackHeight = doc.height * zoom;
    stack.style.width = `${stackWidth}px`;
    stack.style.height = `${stackHeight}px`;
    stack.style.left = `${canvasOffsetX}px`;
    stack.style.top = `${canvasOffsetY}px`;
    // Give the canvas its own scrollable workspace. The rest of the editor
    // (tools, layers, timeline) never grows or moves when zoom changes.
    const rightPad = focusMode ? 28 : 32;
    const bottomPad = 28;
    // At fit scale, the canvas should not create artificial scrollbars. When
    // zoomed past the viewport, expand only the scrollable canvas surround.
    surround.style.width = `${Math.max(viewport.clientWidth + Math.max(0,requiredScrollX), canvasOffsetX + stackWidth + rightPad)}px`;
    surround.style.height = `${Math.max(viewport.clientHeight + Math.max(0,requiredScrollY), canvasOffsetY + stackHeight + bottomPad)}px`;
    // Pixel-grid lines must land on whole CSS-pixel boundaries. Fractional
    // fit zooms can make 1px CSS gradients shimmer or look broken, so the
    // pixel grid is shown only at integral zoom levels (4x and above).
    const pixelGridZoom = Math.round(zoom);
    const pixelGridAligned = zoom >= 4 && Math.abs(zoom - pixelGridZoom) < 0.001;
    stack.style.setProperty('--pixel-size', `${pixelGridZoom}px`);
    stack.style.setProperty('--grid-opacity', showGrid && pixelGridAligned ? '1' : '0');
    stack.classList.toggle('grid-on', showGrid && pixelGridAligned);
    stack.style.setProperty('--checker-size', '8px'); // fixed 4px checker squares: compact at every canvas zoom
    $('canvasSizeLabel').textContent = `${doc.width} × ${doc.height} px`;
    $('zoomLabel').textContent = `${Math.round(zoom*100)}%`;
    $('zoomFitBtn').textContent = `${Math.round(zoom*100)}%`;
  }

  function renderOnion() {
    onionCtx.clearRect(0,0,doc.width,doc.height);
    if (!showOnion || doc.frameIndex === 0 || playing) return;
    const previous = compositeFrame(doc.frameIndex - 1);
    onionCtx.globalAlpha = .2;
    onionCtx.drawImage(previous,0,0);
    onionCtx.globalAlpha = 1;
    onionCtx.globalCompositeOperation = 'source-atop';
    onionCtx.fillStyle = '#ff5d91';
    onionCtx.fillRect(0,0,doc.width,doc.height);
    onionCtx.globalCompositeOperation = 'source-over';
  }

  function renderCanvasOnly() {
    if (!doc) return;
    refreshCanvasSize();
    displayCtx.clearRect(0,0,doc.width,doc.height);
    const frame = compositeFrame(doc.frameIndex, transformState ? {
      floating: {...transformState,pixels:scaledSelectionPixels(transformState)}
    } : {});
    displayCtx.drawImage(frame,0,0);
    renderOnion();
    renderOverlay();
  }

  function render() {
    if (!doc) return;
    renderCanvasOnly();
    renderLayers();
    renderTimeline();
    renderColorUI();
    $('projectName').value = doc.name;
    $('fpsInput').value = doc.fps;
    $('layerCount').textContent = doc.layers.length;
    $('opacityValue').textContent = `${doc.layers[activeLayer]?.opacity ?? 100}%`;
    $('layerOpacity').value = doc.layers[activeLayer]?.opacity ?? 100;
    $('celPosition').textContent = `${String(doc.frameIndex+1).padStart(2,'0')} / ${String(doc.layers[0].frames.length).padStart(2,'0')}`;
    $('timelineLayerName').textContent = doc.layers[activeLayer]?.name ?? 'Layer';
    $('frameCountLabel').textContent = `${doc.layers[0].frames.length} FRAME${doc.layers[0].frames.length===1?'':'S'}`;
    $('onionBtn').classList.toggle('active',showOnion);
    $('onionToggle').checked = showOnion;
    $('gridBtn').classList.toggle('active',showGrid);
    $('gridToggle').checked = showGrid;
    $('canvasHint').style.display = compositeHasPixels() ? 'none' : 'inline-flex';
  }
  function compositeHasPixels() {
    for (const layer of doc.layers) if (layer.visible) {
      const pixels = layer.frames[doc.frameIndex];
      for (let i=3;i<pixels.length;i+=4) if (pixels[i]) return true;
    }
    return false;
  }

  function renderOverlay() {
    overlayCtx.clearRect(0,0,doc.width,doc.height);

    // Selection boundary is a screen-space DOM overlay. This keeps the outline
    // crisp and restrained at every zoom instead of scaling chunky canvas dashes.
    const visibleSelection=transformState?.rect || selection;
    updateSelectionFrame(visibleSelection && !stroke?.panning ? visibleSelection : null);
    if (visibleSelection && !stroke?.panning && activeTool==='select') {
      const r=visibleSelection;
      if (transformState) {
        const scale=overlayCanvas.getBoundingClientRect().width/Math.max(1,doc.width);
        const cornersOnly=r.w*scale<18||r.h*scale<18;
        drawSelectionHandles(r, selectionHandlePoints(r,true).map(point=>point.id));
      } else if (hoveredSelectionHandle) {
        drawSelectionHandles(r,[hoveredSelectionHandle]);
      }
    }

    if (stroke && ['line','rect','ellipse'].includes(stroke.tool) && stroke.point) {
      overlayCtx.save();
      overlayCtx.strokeStyle = currentColor;
      overlayCtx.fillStyle = currentColor;
      overlayCtx.globalAlpha = .78;
      const x1=stroke.start.x,y1=stroke.start.y,x2=stroke.point.x,y2=stroke.point.y;
      if (stroke.tool==='line') { overlayCtx.beginPath(); overlayCtx.moveTo(x1+.5,y1+.5); overlayCtx.lineTo(x2+.5,y2+.5); overlayCtx.stroke(); }
      if (stroke.tool==='rect') { const x=Math.min(x1,x2),y=Math.min(y1,y2),w=Math.abs(x2-x1)+1,h=Math.abs(y2-y1)+1; shapeMode==='fill'?overlayCtx.fillRect(x,y,w,h):overlayCtx.strokeRect(x+.5,y+.5,w-1,h-1); }
      if (stroke.tool==='ellipse') { overlayCtx.beginPath(); overlayCtx.ellipse((x1+x2+1)/2,(y1+y2+1)/2,Math.max(.5,Math.abs(x2-x1+1)/2),Math.max(.5,Math.abs(y2-y1+1)/2),0,0,Math.PI*2); shapeMode==='fill'?overlayCtx.fill():overlayCtx.stroke(); }
      overlayCtx.restore();
    }
    updateSelectionToolbar();
  }

  function selectionHandlePoints(rect, cornersOnly=false) {
    const left=rect.x, right=rect.x+rect.w, top=rect.y, bottom=rect.y+rect.h;
    const midX=(left+right)/2, midY=(top+bottom)/2;
    const corners=[{id:'nw',x:left,y:top},{id:'ne',x:right,y:top},{id:'se',x:right,y:bottom},{id:'sw',x:left,y:bottom}];
    if(cornersOnly)return corners;
    return [...corners.slice(0,2),{id:'n',x:midX,y:top},{id:'e',x:right,y:midY},corners[2],{id:'s',x:midX,y:bottom},corners[3],{id:'w',x:left,y:midY}];
  }

  function updateSelectionFrame(rect) {
    const frame=$('selectionFrame');
    if(!frame)return;
    if(!rect){frame.classList.add('hidden');return;}
    const metrics=canvasPointerMetrics();
    const left=Math.round(rect.x*metrics.scaleX),top=Math.round(rect.y*metrics.scaleY);
    const width=Math.max(1,Math.round(rect.w*metrics.scaleX)),height=Math.max(1,Math.round(rect.h*metrics.scaleY));
    frame.style.left=`${left}px`;
    frame.style.top=`${top}px`;
    frame.style.width=`${width}px`;
    frame.style.height=`${height}px`;
    frame.classList.remove('hidden');
  }

  function canvasPointerMetrics() {
    // Use the artboard's rendered bounds rather than an individual overlay
    // canvas. All canvas layers share this exact coordinate space, while the
    // artboard remains stable if canvas children or selection chrome repaint.
    const rect=stack.getBoundingClientRect();
    return {
      left:rect.left, top:rect.top, width:Math.max(1,rect.width), height:Math.max(1,rect.height),
      scaleX:Math.max(.0001,rect.width/Math.max(1,doc.width)),
      scaleY:Math.max(.0001,rect.height/Math.max(1,doc.height))
    };
  }

  function drawSelectionHandles(rect, handleIds=[]) {
    if(!handleIds.length)return;
    const metrics=canvasPointerMetrics();
    // Handles stay a constant physical size on screen, independent of zoom.
    const sizeX=5.5/metrics.scaleX, sizeY=5.5/metrics.scaleY;
    const halfX=sizeX/2, halfY=sizeY/2;
    const points=selectionHandlePoints(rect).filter(point=>handleIds.includes(point.id));
    overlayCtx.save();
    overlayCtx.setLineDash([]);
    overlayCtx.lineWidth=1/Math.max(.25,Math.min(metrics.scaleX,metrics.scaleY));
    for(const point of points) {
      overlayCtx.fillStyle='#F8FAFC';
      overlayCtx.strokeStyle='#151922';
      overlayCtx.fillRect(point.x-halfX,point.y-halfY,sizeX,sizeY);
      overlayCtx.strokeRect(point.x-halfX,point.y-halfY,sizeX,sizeY);
    }
    overlayCtx.restore();
  }

  function pointFloatFromEvent(event, metrics=canvasPointerMetrics()) {
    return {x:(event.clientX-metrics.left)/metrics.scaleX,y:(event.clientY-metrics.top)/metrics.scaleY};
  }

  function hitSelectionHandle(event, rect, metrics=canvasPointerMetrics()) {
    if(!rect)return null;
    const pos=pointFloatFromEvent(event,metrics);
    const cornersOnly=rect.w*metrics.scaleX<18||rect.h*metrics.scaleY<18;
    const radius=cornersOnly?5.5:8;
    let nearest=null,nearestDistance=Infinity;
    for(const handle of selectionHandlePoints(rect,cornersOnly)) {
      const distance=Math.hypot((pos.x-handle.x)*metrics.scaleX,(pos.y-handle.y)*metrics.scaleY);
      if(distance<=radius&&distance<nearestDistance){nearest=handle.id;nearestDistance=distance;}
    }
    return nearest;
  }

  function extractSelectionPixels(rect) {
    const source=currentPixels(),pixels=blankPixels(rect.w,rect.h);
    for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++) {
      const sx=rect.x+x,sy=rect.y+y;
      if(sx<0||sy<0||sx>=doc.width||sy>=doc.height)continue;
      const si=(sy*doc.width+sx)*4,di=(y*rect.w+x)*4;
      pixels.set(source.subarray(si,si+4),di);
    }
    return pixels;
  }

  function rectEquals(a,b) { return Boolean(a&&b&&a.x===b.x&&a.y===b.y&&a.w===b.w&&a.h===b.h); }

  function resizeSelectionRect(base, handle, delta) {
    let left=base.x,right=base.x+base.w-1,top=base.y,bottom=base.y+base.h-1;
    if(handle.includes('w')) left=Math.max(0,Math.min(right,base.x+delta.x));
    if(handle.includes('e')) right=Math.min(doc.width-1,Math.max(left,base.x+base.w-1+delta.x));
    if(handle.includes('n')) top=Math.max(0,Math.min(bottom,base.y+delta.y));
    if(handle.includes('s')) bottom=Math.min(doc.height-1,Math.max(top,base.y+base.h-1+delta.y));
    return {x:left,y:top,w:Math.max(1,right-left+1),h:Math.max(1,bottom-top+1)};
  }

  function updateSelectionToolbar() {
    const bar=$('selectionToolbar');
    if(!bar)return;
    const pending=Boolean(transformState);
    const hasSelection=Boolean(selection);
    const selectionToolActive=activeTool==='select';
    const actionsActive=selectionToolActive||hasSelection||Boolean(selectionClipboard);
    bar.classList.toggle('is-active',actionsActive);
    bar.classList.toggle('has-selection',hasSelection);
    bar.classList.toggle('is-transforming',pending);
    $('selectionActivateBtn').disabled=selectionToolActive;
    $('selectionCopyBtn').disabled=!hasSelection;
    $('selectionCutBtn').disabled=!hasSelection;
    $('selectionPasteBtn').disabled=!selectionClipboard;
    $('selectionFlipHBtn').disabled=!hasSelection;
    $('selectionFlipVBtn').disabled=!hasSelection;
    $('selectionRotateBtn').disabled=!hasSelection;
    $('selectionDeselectBtn').disabled=!hasSelection;
    $('selectionApplyBtn').classList.toggle('hidden',!pending);
    $('selectionCancelBtn').classList.toggle('hidden',!pending);
    $('selectionHint').textContent=pending
      ? 'Previewing changes. Apply to keep them, or Cancel to restore.'
      : hasSelection
        ? 'Drag inside the selection to move it. Grab a corner or edge to resize.'
        : selectionToolActive
        ? 'Drag on the canvas to select an area. Then move or transform it.'
        : 'Choose Select (M) to edit an area, or Paste to insert copied pixels.';
  }

  function createFloatingSelection() {
    const sourceRect={...selection};
    transformState={sourceRect,rect:{...sourceRect},pixels:extractSelectionPixels(sourceRect),layerId:doc.layers[activeLayer].id,frameId:doc.frameIds[doc.frameIndex],frameIndex:doc.frameIndex};
  }

  function scaledSelectionPixels(state) {
    const sourceCanvas=document.createElement('canvas');
    sourceCanvas.width=state.sourceRect.w;sourceCanvas.height=state.sourceRect.h;
    sourceCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(state.pixels),sourceCanvas.width,sourceCanvas.height),0,0);
    const output=document.createElement('canvas');
    output.width=state.rect.w;output.height=state.rect.h;
    const ctx=output.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(sourceCanvas,0,0,output.width,output.height);
    return ctx.getImageData(0,0,output.width,output.height).data;
  }

  function blendPixelOver(target, targetIndex, source, sourceIndex) {
    const sa=source[sourceIndex+3];
    if(sa===0)return;
    if(sa===255){target.set(source.subarray(sourceIndex,sourceIndex+4),targetIndex);return;}
    const da=target[targetIndex+3]/255,srcA=sa/255,outA=srcA+da*(1-srcA);
    if(outA<=0){target.fill(0,targetIndex,targetIndex+4);return;}
    for(let c=0;c<3;c++)target[targetIndex+c]=Math.round((source[sourceIndex+c]*srcA+target[targetIndex+c]*da*(1-srcA))/outA);
    target[targetIndex+3]=Math.round(outA*255);
  }

  function commitSelectionTransform() {
    if(!transformState)return false;
    if(stroke?.tool==='select'&&stroke.mode!=='marquee')stroke=null;
    const state=transformState;
    if(rectEquals(state.sourceRect,state.rect)) {
      transformState=null;selection={...state.sourceRect};render();return false;
    }
    const pixels=scaledSelectionPixels(state),r=state.rect;
    const targetLayer=doc.layers.find(layer=>layer.id===state.layerId);
    const targetFrame=targetLayer?.frames[doc.frameIds.indexOf(state.frameId)];
    if(!targetFrame){cancelSelectionTransform();toast('The original layer or frame is no longer available.','error');return false;}
    pushHistory();
    for(let y=Math.max(0,state.sourceRect.y);y<Math.min(doc.height,state.sourceRect.y+state.sourceRect.h);y++) {
      const start=(y*doc.width+Math.max(0,state.sourceRect.x))*4;
      const end=(y*doc.width+Math.min(doc.width,state.sourceRect.x+state.sourceRect.w))*4;
      targetFrame.fill(0,start,end);
    }
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++) {
      const dx=r.x+x,dy=r.y+y;
      if(dx<0||dy<0||dx>=doc.width||dy>=doc.height)continue;
      const si=(y*r.w+x)*4,di=(dy*doc.width+dx)*4;
      // Paste with normal alpha compositing: opaque pixels replace, partial alpha
      // blends, and transparent holes reveal the artwork beneath the selection.
      blendPixelOver(targetFrame,di,pixels,si);
    }
    transformState=null;selection={...r};render();
    setStatus(`Applied selection transform · ${r.w} × ${r.h} px`);
    return true;
  }

  function cancelSelectionTransform() {
    if(!transformState)return false;
    if(stroke?.tool==='select'&&stroke.mode!=='marquee')stroke=null;
    selection={...transformState.sourceRect};
    transformState=null;render();setStatus('Selection transform cancelled. Original pixels restored.');
    return true;
  }
  function setZoom(next, preservePoint=null) {
    fitToAreaActive=false;
    const viewRect=viewport.getBoundingClientRect();
    if (!preservePoint) {
      const rect=stack.getBoundingClientRect();
      preservePoint={
        x:doc.width/2, y:doc.height/2,
        screenX:rect.left-viewRect.left+(doc.width/2)*zoom,
        screenY:rect.top-viewRect.top+(doc.height/2)*zoom
      };
    }
    const clampedZoom=Math.max(.1,Math.min(64,next));
    // Integer display zoom keeps every source-pixel edge aligned with the
    // 1-CSS-pixel grid overlay and prevents broken/anti-aliased grid lines.
    zoom=clampedZoom>=4?Math.max(4,Math.floor(clampedZoom+0.001)):Math.round(clampedZoom*100)/100;
    const {x,y,screenX,screenY}=preservePoint;
    // Work out the new canvas origin in scroll-content coordinates. If the
    // origin would cross the top/left edge, add matching workspace + scroll
    // space so the exact point under the cursor stays anchored.
    let targetLeft=viewport.scrollLeft+screenX-x*zoom;
    let targetTop=viewport.scrollTop+screenY-y*zoom;
    let targetScrollLeft=viewport.scrollLeft;
    let targetScrollTop=viewport.scrollTop;
    const minLeft=focusMode?122:32;
    const minTop=24;
    if(targetLeft<minLeft){const shift=minLeft-targetLeft;targetLeft+=shift;targetScrollLeft+=shift;}
    if(targetTop<minTop){const shift=minTop-targetTop;targetTop+=shift;targetScrollTop+=shift;}
    canvasOffsetX=zoom>=4?Math.round(targetLeft):targetLeft;
    canvasOffsetY=zoom>=4?Math.round(targetTop):targetTop;
    refreshCanvasSize(targetScrollLeft,targetScrollTop);
    viewport.scrollLeft=targetScrollLeft;
    viewport.scrollTop=targetScrollTop;
    $('zoomLabel').textContent = `${Math.round(zoom*100)}%`;
    $('zoomFitBtn').textContent = `${Math.round(zoom*100)}%`;
  }
  function fitCanvas() {
    fitToAreaActive=true;
    // The editor is hidden behind the splash during startup. Never calculate a
    // zoom from a zero-sized viewport: that can collapse the canvas to 10%.
    if (!viewport || viewport.clientWidth < 80 || viewport.clientHeight < 80) return false;
    // Reserve room for the floating tool strip and palette in focus mode so
    // the sprite never sits underneath those controls at the fitted scale.
    const pads = focusMode
      ? {left:122,right:28,top:24,bottom:92}
      : {left:32,right:32,top:28,bottom:28};
    const availableW=Math.max(1,viewport.clientWidth-pads.left-pads.right);
    const availableH=Math.max(1,viewport.clientHeight-pads.top-pads.bottom);
    const rawFit=Math.min(availableW/doc.width,availableH/doc.height,64);
    // Fractional zoom is important for large sprites: fit means the entire
    // image is visible, even when a single source pixel must render < 1 CSS px.
    // At pixel-grid magnifications, fit to the nearest lower whole zoom so
    // each pixel occupies an exact number of screen pixels. Below 4x retain
    // fractional fit to keep larger sprites fully visible.
    zoom=rawFit>=4?Math.floor(rawFit):Math.max(.1,Math.floor(rawFit*100)/100);
    canvasOffsetX=pads.left+Math.max(0,(availableW-doc.width*zoom)/2);
    canvasOffsetY=pads.top+Math.max(0,(availableH-doc.height*zoom)/2);
    if(zoom>=4){canvasOffsetX=Math.round(canvasOffsetX);canvasOffsetY=Math.round(canvasOffsetY);}
    refreshCanvasSize(0,0);
    viewport.scrollLeft=0;viewport.scrollTop=0;
    $('zoomLabel').textContent=`${Math.round(zoom*100)}%`;
    $('zoomFitBtn').textContent=`${Math.round(zoom*100)}%`;
    return true;
  }
  function centerCanvas() {
    if (!viewport || viewport.clientWidth < 80 || viewport.clientHeight < 80) return false;
    const pads = focusMode
      ? {left:122,right:28,top:24,bottom:92}
      : {left:32,right:32,top:28,bottom:28};
    const availableW=Math.max(1,viewport.clientWidth-pads.left-pads.right);
    const availableH=Math.max(1,viewport.clientHeight-pads.top-pads.bottom);
    canvasOffsetX=pads.left+Math.max(0,(availableW-doc.width*zoom)/2);
    canvasOffsetY=pads.top+Math.max(0,(availableH-doc.height*zoom)/2);
    if(zoom>=4){canvasOffsetX=Math.round(canvasOffsetX);canvasOffsetY=Math.round(canvasOffsetY);}
    refreshCanvasSize(0,0);
    viewport.scrollLeft=0;viewport.scrollTop=0;
    return true;
  }
  function zoomStep() { return zoom < 1 ? .1 : 1; }
  function changeZoom(direction, preservePoint=null) {
    setZoom(zoom + direction*zoomStep(), preservePoint);
  }
  function setFocusMode(enabled) {
    focusMode=Boolean(enabled);
    document.body.classList.toggle('focus-mode',focusMode);
    const button=$('focusModeBtn');
    button.textContent=focusMode?'× Exit focus':'◩ Focus';
    button.title=focusMode?'Exit focus drawing mode (Esc)':'Enter focus drawing mode (F)';
    button.setAttribute('aria-pressed',String(focusMode));
    requestAnimationFrame(()=>fitCanvas());
    setStatus(focusMode?'Focus drawing mode · F or Esc to return':'Full editor workspace restored.');
  }
  function toggleFocusMode() { setFocusMode(!focusMode); }

  function pointFromEvent(event, metrics=canvasPointerMetrics()) {
    const point=pointFloatFromEvent(event,metrics);
    return {
      x:Math.max(0,Math.min(doc.width-1,Math.floor(point.x))),
      y:Math.max(0,Math.min(doc.height-1,Math.floor(point.y)))
    };
  }
  function setPixel(pixels,x,y,color,erase=false,size=1) {
    const half=Math.floor(size/2);
    for (let oy=0;oy<size;oy++) for (let ox=0;ox<size;ox++) {
      const px=x+ox-half, py=y+oy-half;
      if(px<0||py<0||px>=doc.width||py>=doc.height) continue;
      const i=(py*doc.width+px)*4;
      if(erase){pixels[i]=0;pixels[i+1]=0;pixels[i+2]=0;pixels[i+3]=0;}
      else {pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=color[3];}
    }
  }
  function drawLinePixels(pixels,x0,y0,x1,y1,color,erase=false,size=1) {
    let dx=Math.abs(x1-x0), sx=x0<x1?1:-1, dy=-Math.abs(y1-y0), sy=y0<y1?1:-1, err=dx+dy;
    while(true){setPixel(pixels,x0,y0,color,erase,size);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
  }
  function drawEllipsePixels(pixels,x1,y1,x2,y2,color,filled=false) {
    const left=Math.min(x1,x2),right=Math.max(x1,x2),top=Math.min(y1,y2),bottom=Math.max(y1,y2);
    const rx=(right-left+1)/2, ry=(bottom-top+1)/2, cx=(left+right+1)/2, cy=(top+bottom+1)/2;
    for(let y=top;y<=bottom;y++) for(let x=left;x<=right;x++) {
      const norm=((x+.5-cx)**2)/(rx*rx)+((y+.5-cy)**2)/(ry*ry);
      if(filled ? norm<=1 : norm<=1 && norm>=Math.max(0,1-2/Math.min(rx,ry))) setPixel(pixels,x,y,color,false,1);
    }
  }
  function drawShape(pixels,tool,x1,y1,x2,y2,color) {
    if(tool==='line') drawLinePixels(pixels,x1,y1,x2,y2,color,false,brushSize);
    if(tool==='rect') {
      const left=Math.min(x1,x2),right=Math.max(x1,x2),top=Math.min(y1,y2),bottom=Math.max(y1,y2);
      if(shapeMode==='fill') for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)setPixel(pixels,x,y,color);
      else {drawLinePixels(pixels,left,top,right,top,color);drawLinePixels(pixels,right,top,right,bottom,color);drawLinePixels(pixels,right,bottom,left,bottom,color);drawLinePixels(pixels,left,bottom,left,top,color);}
    }
    if(tool==='ellipse') drawEllipsePixels(pixels,x1,y1,x2,y2,color,shapeMode==='fill');
  }
  function floodFill(startX,startY,color) {
    const pixels=currentPixels(), idx=pixelIndex(startX,startY);
    const target=[pixels[idx],pixels[idx+1],pixels[idx+2],pixels[idx+3]];
    if(target.every((v,i)=>v===color[i])) return false;
    const stackPoints=[[startX,startY]], seen=new Uint8Array(doc.width*doc.height);
    while(stackPoints.length) {
      const [x,y]=stackPoints.pop();
      if(x<0||y<0||x>=doc.width||y>=doc.height) continue;
      const p=y*doc.width+x; if(seen[p]) continue; seen[p]=1;
      const i=p*4;
      if(pixels[i]!==target[0]||pixels[i+1]!==target[1]||pixels[i+2]!==target[2]||pixels[i+3]!==target[3]) continue;
      pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=color[3];
      stackPoints.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    return true;
  }
  function sampleColor(x,y) {
    const composite=compositeFrame(doc.frameIndex);
    const data=composite.getContext('2d').getImageData(x,y,1,1).data;
    if(data[3]===0) return '#FFFFFF';
    return rgbaToHex(data[0],data[1],data[2]);
  }

  function beginPointer(event) {
    if(event.button!==0 && event.button!==1) return;
    event.preventDefault();
    // Freeze the artboard-to-document mapping for the complete pointer
    // gesture. This prevents selection drift if rendering/scrollbars reflow
    // while the marquee or floating transform is being updated.
    const pointerMap=canvasPointerMetrics();
    const p=pointFromEvent(event,pointerMap);
    $('cursorPosition').innerHTML=`X: ${p.x}&nbsp;&nbsp; Y: ${p.y}`;
    const shouldPan=activeTool==='hand'||spaceDown||event.button===1;
    if(shouldPan) {
      fitToAreaActive=false;stroke={panning:true,startScreen:{x:event.clientX,y:event.clientY},scroll:{x:viewport.scrollLeft,y:viewport.scrollTop}};
      overlayCanvas.setPointerCapture(event.pointerId); return;
    }
    if(activeTool==='eyedropper'){setCurrentColor(sampleColor(p.x,p.y));return;}
    if(activeTool==='fill') {pushHistory();if(floodFill(p.x,p.y,hexToRgba(currentColor))){render();setStatus(`Filled area with ${currentColor}`);}return;}

    // Selection is non-destructive until applied; dragging inside moves, and
    // dragging one of eight handles resizes with nearest-neighbor scaling.
    if(activeTool==='select') {
      let rect=transformState?.rect||selection;
      let handle=rect?hitSelectionHandle(event,rect):null;
      const inside=Boolean(rect&&p.x>=rect.x&&p.y>=rect.y&&p.x<rect.x+rect.w&&p.y<rect.y+rect.h);
      if(rect&&(handle||inside)) {
        if(!doc.layers[activeLayer].visible){toast('Turn the active layer on before moving its pixels.','error');return;}
        const hadPending=Boolean(transformState);
        if(!transformState)createFloatingSelection();
        rect=transformState.rect;
        const pointerStartFloat=pointFloatFromEvent(event,pointerMap);
        stroke={tool:'select',mode:handle?'resize':'move',handle,pointerStart:p,pointerStartFloat,
          grabOffset:{x:pointerStartFloat.x-rect.x,y:pointerStartFloat.y-rect.y},
          pointerMap,baseRect:{...rect},hadPending,pointerId:event.pointerId};
        overlayCanvas.setPointerCapture(event.pointerId);renderCanvasOnly();return;
      }
      // Clicking outside an uncommitted floating selection applies it before
      // starting a fresh marquee, matching the usual pixel-editor workflow.
      if(transformState)commitSelectionTransform();
      hoveredSelectionHandle=null;
      stroke={tool:'select',mode:'marquee',start:p,point:p,pointerMap,pointerId:event.pointerId};
      selection={x:p.x,y:p.y,w:1,h:1};
      overlayCanvas.setPointerCapture(event.pointerId);renderOverlay();return;
    }

    if(!doc.layers[activeLayer].visible){toast('Turn this layer on before drawing.');return;}
    if(transformState)commitSelectionTransform();
    pushHistory();
    stroke={tool:activeTool,start:p,point:p,last:p,pointerMap,pointerId:event.pointerId};
    overlayCanvas.setPointerCapture(event.pointerId);
    if(activeTool==='pencil'||activeTool==='eraser') {
      drawLinePixels(currentPixels(),p.x,p.y,p.x,p.y,hexToRgba(currentColor),activeTool==='eraser',brushSize);
      render();
    } else renderOverlay();
  }

  function movePointer(event) {
    const p=pointFromEvent(event,stroke?.pointerMap||canvasPointerMetrics());
    $('cursorPosition').innerHTML=`X: ${p.x}&nbsp;&nbsp; Y: ${p.y}`;
    if(!stroke){
      if(activeTool==='select') {
        const rect=transformState?.rect||selection;
        const handle=rect?hitSelectionHandle(event,rect):null;
        const handleCursors={nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize'};
        const inside=Boolean(rect&&p.x>=rect.x&&p.y>=rect.y&&p.x<rect.x+rect.w&&p.y<rect.y+rect.h);
        overlayCanvas.style.cursor=handle?handleCursors[handle]:inside?'move':'crosshair';
        if(handle!==hoveredSelectionHandle){hoveredSelectionHandle=handle;renderOverlay();}
      } else if(hoveredSelectionHandle){hoveredSelectionHandle=null;renderOverlay();}
      return;
    }
    if(stroke.panning){viewport.scrollLeft=stroke.scroll.x-(event.clientX-stroke.startScreen.x);viewport.scrollTop=stroke.scroll.y-(event.clientY-stroke.startScreen.y);return;}
    stroke.point=p;
    if(stroke.tool==='pencil'||stroke.tool==='eraser') {
      drawLinePixels(currentPixels(),stroke.last.x,stroke.last.y,p.x,p.y,hexToRgba(currentColor),stroke.tool==='eraser',brushSize);
      stroke.last=p;render();
    } else if(stroke.tool==='select') {
      if(stroke.mode==='marquee') {
        const x=Math.min(stroke.start.x,p.x),y=Math.min(stroke.start.y,p.y);
        selection={x,y,w:Math.abs(stroke.start.x-p.x)+1,h:Math.abs(stroke.start.y-p.y)+1};
        renderOverlay();
      } else if(stroke.mode==='move') {
        const raw=pointFloatFromEvent(event,stroke.pointerMap),b=stroke.baseRect,grab=stroke.grabOffset;
        const x=Math.max(0,Math.min(doc.width-b.w,Math.round(raw.x-grab.x)));
        const y=Math.max(0,Math.min(doc.height-b.h,Math.round(raw.y-grab.y)));
        transformState.rect={x,y,w:b.w,h:b.h};selection={...transformState.rect};renderCanvasOnly();
      } else if(stroke.mode==='resize') {
        const raw=pointFloatFromEvent(event,stroke.pointerMap);
        const delta={x:Math.round(raw.x-stroke.pointerStartFloat.x),y:Math.round(raw.y-stroke.pointerStartFloat.y)};
        transformState.rect=resizeSelectionRect(stroke.baseRect,stroke.handle,delta);
        selection={...transformState.rect};renderCanvasOnly();
      }
    } else renderOverlay();
  }

  function flushPendingCanvasLayout() {
    if(!stroke && canvasLayoutPending) {
      canvasLayoutPending=false;
      requestAnimationFrame(scheduleCanvasLayout);
    }
  }

  function endPointer(event) {
    if(!stroke)return;
    if(stroke.panning){stroke=null;flushPendingCanvasLayout();return;}
    const finished=stroke;stroke=null;
    if(['line','rect','ellipse'].includes(finished.tool)) {
      drawShape(currentPixels(),finished.tool,finished.start.x,finished.start.y,finished.point.x,finished.point.y,hexToRgba(currentColor));
    }
    render();
    if(finished.tool==='select') {
      if(finished.mode==='marquee')setStatus(`Selection: ${selection.w} × ${selection.h} px · Drag inside to move`);
      else {
        if(!finished.hadPending&&transformState&&rectEquals(transformState.sourceRect,transformState.rect))transformState=null;
        render();
        setStatus(transformState?'Selection preview · Enter or Apply to commit · Escape to cancel':`Selection: ${selection.w} × ${selection.h} px · Drag inside to move`);
      }
      flushPendingCanvasLayout();
      return;
    }
    setStatus(`${toolNames[finished.tool]} · ${doc.width} × ${doc.height}`);
    flushPendingCanvasLayout();
  }

  function copySelection() {
    if(transformState)commitSelectionTransform();
    const rect=selection||{x:0,y:0,w:doc.width,h:doc.height};
    const source=currentPixels();
    const pixels=blankPixels(rect.w,rect.h);
    for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
      const sx=rect.x+x,sy=rect.y+y;
      if(sx<0||sy<0||sx>=doc.width||sy>=doc.height)continue;
      const si=(sy*doc.width+sx)*4,di=(y*rect.w+x)*4;
      pixels.set(source.subarray(si,si+4),di);
    }
    selectionClipboard={width:rect.w,height:rect.h,pixels};
    $('selectionPasteBtn').disabled=false;
    toast(`Copied ${rect.w} × ${rect.h} px from ${doc.layers[activeLayer].name}.`);
  }
  function clearSelectionPixels(rect=selection) {
    if(!rect)return;
    const pixels=currentPixels();
    for(let y=Math.max(0,rect.y);y<Math.min(doc.height,rect.y+rect.h);y++)
      for(let x=Math.max(0,rect.x);x<Math.min(doc.width,rect.x+rect.w);x++){
        const i=(y*doc.width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=pixels[i+3]=0;
      }
  }
  function cutSelection() {
    if(!selection){toast('Select an area before cutting.');return;}
    if(transformState)commitSelectionTransform();
    copySelection();pushHistory();clearSelectionPixels();render();setStatus('Selection cut to clipboard.');
  }
  function pasteSelection() {
    if(transformState)commitSelectionTransform();
    if(!selectionClipboard){toast('Copy a selection before pasting.');return;}
    if(!doc.layers[activeLayer].visible){toast('Turn the active layer on before pasting.','error');return;}
    pushHistory();
    const clip=selectionClipboard;
    const x=selection?selection.x:Math.floor((doc.width-clip.width)/2);
    const y=selection?selection.y:Math.floor((doc.height-clip.height)/2);
    const left=Math.max(0,Math.min(doc.width-1,x)),top=Math.max(0,Math.min(doc.height-1,y));
    const w=Math.min(clip.width,doc.width-left),h=Math.min(clip.height,doc.height-top);
    const dest=currentPixels();
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const si=(py*clip.width+px)*4,di=((top+py)*doc.width+left+px)*4;
      const a=clip.pixels[si+3];if(a===0)continue;
      if(a===255){dest.set(clip.pixels.subarray(si,si+4),di);continue;}
      const da=dest[di+3]/255,sa=a/255,outA=sa+da*(1-sa);
      if(outA<=0){dest.fill(0,di,di+4);continue;}
      for(let c=0;c<3;c++)dest[di+c]=Math.round((clip.pixels[si+c]*sa+dest[di+c]*da*(1-sa))/outA);
      dest[di+3]=Math.round(outA*255);
    }
    selection={x:left,y:top,w,h};render();setStatus(`Pasted ${w} × ${h} px.`);
  }
  function transformSelection(kind) {
    if(transformState)commitSelectionTransform();
    if(!selection){toast('Select an area before transforming.');return;}
    const rect={...selection},source=currentPixels(),block=blankPixels(rect.w,rect.h);
    for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
      const sx=rect.x+x,sy=rect.y+y;
      if(sx>=0&&sy>=0&&sx<doc.width&&sy<doc.height){const si=(sy*doc.width+sx)*4;block.set(source.subarray(si,si+4),(y*rect.w+x)*4);}
    }
    let newW=rect.w,newH=rect.h;
    if(kind==='rotate'){newW=rect.h;newH=rect.w;}
    const next=blankPixels(newW,newH);
    for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
      const si=(y*rect.w+x)*4;
      let dx=x,dy=y;
      if(kind==='flipH')dx=rect.w-1-x;
      if(kind==='flipV')dy=rect.h-1-y;
      if(kind==='rotate'){dx=rect.h-1-y;dy=x;}
      next.set(block.subarray(si,si+4),(dy*newW+dx)*4);
    }
    pushHistory();clearSelectionPixels(rect);
    const left=Math.max(0,Math.min(doc.width-newW,Math.round(rect.x+(rect.w-newW)/2)));
    const top=Math.max(0,Math.min(doc.height-newH,Math.round(rect.y+(rect.h-newH)/2)));
    for(let y=0;y<newH;y++)for(let x=0;x<newW;x++){
      const di=((top+y)*doc.width+left+x)*4,si=(y*newW+x)*4;
      source.set(next.subarray(si,si+4),di);
    }
    selection={x:left,y:top,w:newW,h:newH};render();setStatus(kind==='rotate'?'Selection rotated 90° clockwise.':kind==='flipH'?'Selection flipped horizontally.':'Selection flipped vertically.');
  }
  $('selectionActivateBtn').addEventListener('click',()=>setTool('select'));
  $('selectionCopyBtn').addEventListener('click',copySelection);
  $('selectionCutBtn').addEventListener('click',cutSelection);
  $('selectionPasteBtn').addEventListener('click',pasteSelection);
  $('selectionFlipHBtn').addEventListener('click',()=>transformSelection('flipH'));
  $('selectionFlipVBtn').addEventListener('click',()=>transformSelection('flipV'));
  $('selectionRotateBtn').addEventListener('click',()=>transformSelection('rotate'));
  $('selectionApplyBtn').addEventListener('click',commitSelectionTransform);
  $('selectionCancelBtn').addEventListener('click',cancelSelectionTransform);
  $('selectionDeselectBtn').addEventListener('click',()=>{if(transformState)commitSelectionTransform();selection=null;hoveredSelectionHandle=null;renderOverlay();if(fitToAreaActive)requestAnimationFrame(fitCanvas);setStatus('Selection cleared.');});

  overlayCanvas.addEventListener('pointerleave',()=>{if(!stroke&&hoveredSelectionHandle){hoveredSelectionHandle=null;renderOverlay();}});
  overlayCanvas.addEventListener('pointerdown',beginPointer);
  overlayCanvas.addEventListener('pointermove',movePointer);
  overlayCanvas.addEventListener('pointerup',endPointer);
  overlayCanvas.addEventListener('pointercancel',endPointer);
  overlayCanvas.addEventListener('contextmenu',e=>e.preventDefault());
  viewport.addEventListener('wheel',(event)=>{
    if(event.ctrlKey||event.metaKey){
      event.preventDefault();
      const canvasRect=stack.getBoundingClientRect();
      const viewRect=viewport.getBoundingClientRect();
      const x=Math.max(0,Math.min(doc.width,(event.clientX-canvasRect.left)/zoom));
      const y=Math.max(0,Math.min(doc.height,(event.clientY-canvasRect.top)/zoom));
      changeZoom(event.deltaY<0?1:-1,{
        x,y,screenX:event.clientX-viewRect.left,screenY:event.clientY-viewRect.top
      });
    }
  },{passive:false});
  let canvasLayoutFrame = 0;
  let canvasLayoutPending = false;
  function scheduleCanvasLayout() {
    if (stroke) { canvasLayoutPending = true; return; }
    if (!doc || viewport.clientWidth < 80 || viewport.clientHeight < 80) return;
    cancelAnimationFrame(canvasLayoutFrame);
    canvasLayoutFrame = requestAnimationFrame(() => {
      if (!doc || viewport.clientWidth < 80 || viewport.clientHeight < 80) return;
      if (fitToAreaActive) fitCanvas();
      else if (viewport.scrollWidth <= viewport.clientWidth + 1 && viewport.scrollHeight <= viewport.clientHeight + 1) centerCanvas();
      else refreshCanvasSize();
    });
  }
  window.addEventListener('resize', scheduleCanvasLayout, { passive: true });
  if ('ResizeObserver' in window) {
    const canvasViewportObserver = new ResizeObserver(() => {
      // Ignore the hidden splash-time layout; startup explicitly schedules a fit
      // after the editor becomes visible. Later size changes refit automatically.
      if (editorIsReady) scheduleCanvasLayout();
    });
    canvasViewportObserver.observe(viewport);
  }

  function setTool(tool) {
    if(transformState&&tool!=='select')commitSelectionTransform();
    activeTool=tool;
    document.querySelectorAll('.tool-button').forEach(button=>button.classList.toggle('active',button.dataset.tool===tool));
    overlayCanvas.style.cursor=tool==='hand'?'grab':tool==='eyedropper'?'copy':'crosshair';
    updateSelectionToolbar();
    setStatus(`${toolNames[tool]} tool selected · ${toolKeys[tool].toUpperCase()}`);
  }
  document.querySelectorAll('.tool-button').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool)));
  $('brushSize').addEventListener('input',e=>{brushSize=Number(e.target.value);$('brushSizeValue').textContent=`${brushSize} px`;});
  document.querySelectorAll('#shapeMode button').forEach(b=>b.addEventListener('click',()=>{shapeMode=b.dataset.mode;document.querySelectorAll('#shapeMode button').forEach(x=>x.classList.toggle('selected',x===b));}));

  function renderColorUI() {
    $('foregroundColor').style.background=currentColor;
    $('backgroundColor').style.background=backgroundColor;
    $('colorInput').value=currentColor;
    const hexField=$('hexColorInput');
    if(hexField && document.activeElement!==hexField) hexField.value=currentColor;
    $('paletteSwatches').innerHTML='';
    doc.palette.forEach((color,index)=>{
      const b=document.createElement('button');b.className='swatch'+(color.toLowerCase()===currentColor.toLowerCase()?' active':'');b.style.background=color;b.title=`${color} · Click to select · Right-click to remove`;b.setAttribute('aria-label',`Select ${color}; right-click to remove`);b.addEventListener('click',()=>setCurrentColor(color));
      b.addEventListener('contextmenu',e=>{e.preventDefault();doc.palette.splice(index,1);setDirty(true);renderColorUI();});
      $('paletteSwatches').appendChild(b);
    });
  }
  function setCurrentColor(color) { currentColor=color.toUpperCase();renderColorUI();setStatus(`Foreground color ${currentColor}`); }
  $('colorInput').addEventListener('input',e=>setCurrentColor(e.target.value));
  function commitHexColor() {
    const raw=$('hexColorInput').value.trim();
    const normalized=raw.startsWith('#')?raw:`#${raw}`;
    if(!/^#[0-9a-f]{6}$/i.test(normalized)){toast('Enter a valid six-digit HEX color, such as #D9563B.','error');renderColorUI();return false;}
    setCurrentColor(normalized.toUpperCase());$('hexColorInput').value=normalized.toUpperCase();return true;
  }
  $('hexColorInput').addEventListener('change',commitHexColor);
  $('hexColorInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commitHexColor();$('hexColorInput').blur();}else if(e.key==='Escape'){renderColorUI();$('hexColorInput').blur();}});
  $('foregroundColor').addEventListener('click',()=>{$('colorInput').click();});
  $('backgroundColor').addEventListener('click',()=>$('backgroundColorInput').click());
  $('backgroundColorInput').addEventListener('input',e=>{backgroundColor=e.target.value.toUpperCase();$('backgroundColor').style.background=backgroundColor;setStatus(`Background color ${backgroundColor}`);});
  function addPaletteColorDialog() {
    const initial=currentColor;
    const host=showModal('Add a color to your palette',`<p class="modal-actions-note">Choose any color or enter its HEX value. New colors are saved in this sprite's palette and become the active foreground color.</p><div class="palette-color-editor"><label class="palette-color-preview" for="paletteColorPicker"><input id="paletteColorPicker" type="color" value="${initial}" aria-label="Choose a color"><span>Choose color</span></label><div class="field palette-hex-field"><label for="paletteHexInput">HEX COLOR</label><input id="paletteHexInput" type="text" value="${initial}" maxlength="7" spellcheck="false" autocomplete="off"></div></div><div class="field-help">Tip: right-click any palette swatch to remove it. Up to 128 colors can be stored in a project.</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Add to palette',primary:true,onClick:h=>{
        const raw=$('paletteHexInput').value.trim();const color=raw.startsWith('#')?raw:`#${raw}`;
        if(!/^#[0-9a-f]{6}$/i.test(color)){toast('Enter a valid six-digit HEX color.','error');return;}
        const normalized=color.toUpperCase();
        if(!doc.palette.some(item=>item.toUpperCase()===normalized)){
          if(doc.palette.length>=128){toast('This palette already has 128 colors. Remove one before adding another.','error');return;}
          doc.palette.push(normalized);
        }
        setCurrentColor(normalized);setDirty(true);renderColorUI();
        $('paletteSwatches').querySelector('.swatch.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
        h.innerHTML='';toast(`${normalized} added to palette.`);
      }}
    ]);
    $('paletteColorPicker').addEventListener('input',e=>{$('paletteHexInput').value=e.target.value.toUpperCase();});
    $('paletteHexInput').addEventListener('input',e=>{const raw=e.target.value.trim();const value=raw.startsWith('#')?raw:`#${raw}`;if(/^#[0-9a-f]{6}$/i.test(value))$('paletteColorPicker').value=value;});
    $('paletteHexInput').addEventListener('keydown',e=>{if(e.key==='Enter')host.querySelector('.modal-footer .primary')?.click();});
  }
  $('addSwatchBtn').addEventListener('click',addPaletteColorDialog);
  $('resetPaletteBtn').addEventListener('click',()=>{doc.palette=[...paletteDefaults];setDirty(true);renderColorUI();toast('Palette restored.');});
  $('gridToggle').addEventListener('change',e=>{showGrid=e.target.checked;render();});
  $('gridBtn').addEventListener('click',()=>{showGrid=!showGrid;render();});
  $('previewToggle').addEventListener('change',e=>{stack.classList.toggle('checker-off',e.target.checked);});
  $('onionToggle').addEventListener('change',e=>{showOnion=e.target.checked;render();});
  $('onionBtn').addEventListener('click',()=>{showOnion=!showOnion;render();});
  $('zoomOutBtn').addEventListener('click',()=>changeZoom(-1));
  $('zoomInBtn').addEventListener('click',()=>changeZoom(1));
  $('focusModeBtn').addEventListener('click',toggleFocusMode);
  $('zoomFitBtn').addEventListener('click',fitCanvas);
  $('centerCanvasBtn').addEventListener('click',centerCanvas);

  function renderLayers() {
    const list=$('layerList');list.innerHTML='';
    [...doc.layers].reverse().forEach(layer=>{
      const index=doc.layers.findIndex(x=>x.id===layer.id);
      const row=document.createElement('div');row.className='layer-row'+(index===activeLayer?' active':'');row.dataset.layerId=layer.id;
      const eye=document.createElement('button');eye.className='layer-eye'+(layer.visible?'':' off');eye.textContent=layer.visible?'◉':'○';eye.title=layer.visible?'Hide layer':'Show layer';eye.addEventListener('click',e=>{e.stopPropagation();if(transformState)commitSelectionTransform();layer.visible=!layer.visible;setDirty(true);render();});
      const thumb=document.createElement('div');thumb.className='layer-thumb';const c=document.createElement('canvas');c.width=doc.width;c.height=doc.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(layer.frames[doc.frameIndex]),doc.width,doc.height),0,0);thumb.appendChild(c);
      const name=document.createElement('span');name.className='layer-name';name.textContent=layer.name;
      row.append(eye,thumb,name);row.addEventListener('click',()=>{if(transformState)commitSelectionTransform();activeLayer=index;render();});
      name.addEventListener('dblclick',e=>{e.stopPropagation();const input=document.createElement('input');input.className='layer-name-input';input.value=layer.name;name.replaceWith(input);input.focus();input.select();const finish=()=>{layer.name=input.value.trim().slice(0,40)||'Layer';setDirty(true);render();};input.addEventListener('blur',finish,{once:true});input.addEventListener('keydown',ev=>{if(ev.key==='Enter')input.blur();if(ev.key==='Escape'){input.value=layer.name;input.blur();}});});
      list.appendChild(row);
    });
  }
  $('addLayerBtn').addEventListener('click',()=>{
    if(transformState)commitSelectionTransform();
    pushHistory();const layer=makeLayer(`Layer ${doc.layers.length+1}`,doc.layers[0].frames.length,doc.width,doc.height);doc.layers.push(layer);activeLayer=doc.layers.length-1;render();setStatus('New layer added.');
  });
  $('deleteLayerBtn').addEventListener('click',()=>{
    if(transformState)commitSelectionTransform();
    if(doc.layers.length<=1){toast('A project needs at least one layer.');return;}
    pushHistory();doc.layers.splice(activeLayer,1);activeLayer=Math.max(0,activeLayer-1);render();
  });
  $('moveLayerUp').addEventListener('click',()=>moveLayer(1));
  $('moveLayerDown').addEventListener('click',()=>moveLayer(-1));
  function moveLayer(delta){if(transformState)commitSelectionTransform();const target=activeLayer+delta;if(target<0||target>=doc.layers.length)return;pushHistory();const [layer]=doc.layers.splice(activeLayer,1);doc.layers.splice(target,0,layer);activeLayer=target;render();}
  $('layerOpacity').addEventListener('input',e=>{if(transformState)commitSelectionTransform();doc.layers[activeLayer].opacity=Number(e.target.value);$('opacityValue').textContent=`${e.target.value}%`;displayCtx.clearRect(0,0,doc.width,doc.height);displayCtx.drawImage(compositeFrame(doc.frameIndex),0,0);renderLayers();});
  $('layerOpacity').addEventListener('change',()=>{setDirty(true);render();});

  function renderTimeline() {
    const strip=$('frameStrip');strip.innerHTML='';
    const frameCount=doc.layers[0].frames.length;
    $('frameTagsBtn').textContent=doc.frameTags.length?`Tags · ${doc.frameTags.length}`:'Tags';
    const clipSelect=$('playbackClipSelect');
    if(clipSelect){
      const previous=playbackClipName||clipSelect.value||'all';
      clipSelect.innerHTML='<option value="all">All frames</option>'+doc.frameTags.map(tag=>`<option value="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</option>`).join('');
      playbackClipName=[...clipSelect.options].some(option=>option.value===previous)?previous:'all';
      clipSelect.value=playbackClipName;
    }
    for(let i=0;i<frameCount;i++){
      const cell=document.createElement('div');cell.className='frame-cell'+(i===doc.frameIndex?' active':'');cell.draggable=true;cell.dataset.frame=String(i);
      const number=document.createElement('span');number.className='frame-number';number.textContent=String(i+1).padStart(2,'0');
      const canvas=document.createElement('canvas');canvas.width=doc.width;canvas.height=doc.height;canvas.getContext('2d').drawImage(compositeFrame(i),0,0);
      const duration=document.createElement('span');duration.className='frame-duration';duration.textContent=`${Math.round(doc.frameDurations[i]??(1000/doc.fps))}ms`;cell.append(number,canvas,duration);cell.addEventListener('click',()=>selectFrame(i));cell.addEventListener('dblclick',e=>{e.preventDefault();selectFrame(i);frameTimingDialog();});
      cell.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/frame',String(i));e.dataTransfer.effectAllowed='move';});
      cell.addEventListener('dragover',e=>{e.preventDefault();cell.classList.add('drop-target');});
      cell.addEventListener('dragleave',()=>cell.classList.remove('drop-target'));
      cell.addEventListener('drop',e=>{e.preventDefault();cell.classList.remove('drop-target');const from=Number(e.dataTransfer.getData('text/frame'));reorderFrame(from,i);});
      strip.appendChild(cell);
    }
    const plus=document.createElement('button');plus.className='frame-plus';plus.textContent='+';plus.title='Add frame';plus.addEventListener('click',addFrame);strip.appendChild(plus);
  }
  function selectFrame(index){if(transformState)commitSelectionTransform();doc.frameIndex=Math.max(0,Math.min(doc.layers[0].frames.length-1,index));render();}
  function addFrame(){
    if(transformState)commitSelectionTransform();
    pushHistory();const source=doc.frameIndex;
    for(const layer of doc.layers) layer.frames.splice(source+1,0,new Uint8ClampedArray(layer.frames[source]));
    doc.frameIds.splice(source+1,0,uniqueId());
    doc.frameDurations.splice(source+1,0,doc.frameDurations[source]??null);
    doc.frameIndex=source+1;render();setStatus('New frame duplicated from current frame.');
  }
  function duplicateFrame(){addFrame();}
  function deleteFrame(){
    if(transformState)commitSelectionTransform();
    if(doc.layers[0].frames.length<=1){toast('Your animation needs at least one frame.');return;}
    pushHistory();for(const layer of doc.layers)layer.frames.splice(doc.frameIndex,1);const [removedId]=doc.frameIds.splice(doc.frameIndex,1);doc.frameDurations.splice(doc.frameIndex,1);doc.frameTags=doc.frameTags.map(tag=>({...tag,frameIds:tag.frameIds.filter(id=>id!==removedId)})).filter(tag=>tag.frameIds.length);doc.frameIndex=Math.max(0,doc.frameIndex-1);render();
  }
  function reorderFrame(from,to){
    if(transformState)commitSelectionTransform();
    if(from===to||from<0||to<0||from>=doc.layers[0].frames.length||to>=doc.layers[0].frames.length)return;
    pushHistory();for(const layer of doc.layers){const [frame]=layer.frames.splice(from,1);layer.frames.splice(to,0,frame);}const [frameId]=doc.frameIds.splice(from,1);doc.frameIds.splice(to,0,frameId);const [duration]=doc.frameDurations.splice(from,1);doc.frameDurations.splice(to,0,duration);doc.frameIndex=to;render();
  }
  $('addFrameBtn').addEventListener('click',addFrame);$('duplicateFrameBtn').addEventListener('click',duplicateFrame);$('deleteFrameBtn').addEventListener('click',deleteFrame);$('frameTagsBtn').addEventListener('click',frameTagsDialog);
  $('prevFrameBtn').addEventListener('click',()=>selectFrame(doc.frameIndex-1));$('nextFrameBtn').addEventListener('click',()=>selectFrame(doc.frameIndex+1));
  $('firstFrameBtn').addEventListener('click',()=>selectFrame(0));$('lastFrameBtn').addEventListener('click',()=>selectFrame(doc.layers[0].frames.length-1));
  $('fpsInput').addEventListener('change',e=>{doc.fps=Math.max(1,Math.min(60,Number(e.target.value)||8));e.target.value=doc.fps;setDirty(true);renderTimeline();if(playing)startPlayback();});
  $('playbackClipSelect').addEventListener('change',e=>{playbackClipName=e.target.value;if(playing)startPlayback();});
  $('playBtn').addEventListener('click',()=>playing?stopPlayback():startPlayback());
  function playbackFrames(){
    const tag=doc.frameTags.find(item=>item.name===playbackClipName);
    let frames=tag?tag.frameIds.map(id=>doc.frameIds.indexOf(id)).filter(index=>index>=0):doc.frameIds.map((_,index)=>index);
    if(tag?.direction==='reverse')frames.reverse();
    if(tag?.direction==='pingpong'&&frames.length>2)frames=frames.concat(frames.slice(1,-1).reverse());
    return frames.length?frames:[0];
  }
  function paintPlaybackFrame(){
    const frame=compositeFrame(doc.frameIndex);displayCtx.clearRect(0,0,doc.width,doc.height);displayCtx.drawImage(frame,0,0);
    renderLayers();renderTimeline();$('celPosition').textContent=`${String(doc.frameIndex+1).padStart(2,'0')} / ${String(doc.layers[0].frames.length).padStart(2,'0')}`;
  }
  function schedulePlaybackStep(){
    if(!playing)return;
    const duration=Math.max(20,Math.min(5000,Number(doc.frameDurations[doc.frameIndex]??(1000/doc.fps))));
    playTimer=setTimeout(()=>{
      if(!playing)return;
      if(playbackPosition>=playbackSequence.length-1){
        if(!$('loopPlayback').checked){stopPlayback();return;}
        playbackPosition=0;
      }else playbackPosition++;
      doc.frameIndex=playbackSequence[playbackPosition];paintPlaybackFrame();schedulePlaybackStep();
    },duration);
  }
  function startPlayback(){
    if(transformState)commitSelectionTransform();
    if(playTimer)clearTimeout(playTimer);playTimer=null;
    playbackSequence=playbackFrames();
    const currentPosition=playbackSequence.indexOf(doc.frameIndex);playbackPosition=currentPosition>=0?currentPosition:0;
    doc.frameIndex=playbackSequence[playbackPosition];playing=true;$('playBtn').textContent='Ⅱ';$('playbackStatus').textContent=`PLAYING · ${playbackClipName==='all'?'ALL FRAMES':playbackClipName.toUpperCase()}`;$('playbackStatus').style.color='var(--coral)';showOnion=false;paintPlaybackFrame();renderOnion();schedulePlaybackStep();
  }
  function stopPlayback(){if(playTimer)clearTimeout(playTimer);playTimer=null;playing=false;$('playBtn').textContent='▶';$('playbackStatus').textContent='READY TO ANIMATE';$('playbackStatus').style.color='';render();}
  function frameTimingDialog(){
    const index=doc.frameIndex,stored=doc.frameDurations[index],usesDefault=stored==null;
    const host=showModal(`Frame ${index+1} timing`,`<p class="modal-actions-note">Set how long this frame stays on screen. Choose automatic timing to follow the project's FPS, or set a custom duration for a held pose or impact frame.</p><div class="field"><label for="frameDurationMs">DURATION (MILLISECONDS)</label><input id="frameDurationMs" type="number" min="20" max="5000" step="10" value="${Math.round(stored??(1000/doc.fps))}" ${usesDefault?'disabled':''}></div><label class="frame-timing-auto"><input id="frameDurationAuto" type="checkbox" ${usesDefault?'checked':''}> Use project FPS (${Math.round(1000/doc.fps)} ms per frame)</label><label class="frame-timing-auto"><input id="frameDurationAll" type="checkbox"> Apply to every frame</label><div class="field-help">Tip: 80–120 ms feels lively for movement; 180–300 ms gives attacks and reactions more weight.</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Save timing',primary:true,onClick:h=>{const auto=$('frameDurationAuto').checked,all=$('frameDurationAll').checked,ms=Number($('frameDurationMs').value);if(!auto&&(!Number.isInteger(ms)||ms<20||ms>5000)){toast('Frame duration must be between 20 and 5,000 ms.','error');return;}pushHistory();const value=auto?null:ms;if(all)doc.frameDurations=doc.frameDurations.map(()=>value);else doc.frameDurations[index]=value;setDirty(true);h.innerHTML='';renderTimeline();toast(all?'Timing applied to every frame.':'Frame timing updated.');}}
    ]);
    $('frameDurationAuto').addEventListener('change',e=>{$('frameDurationMs').disabled=e.target.checked;if(e.target.checked)$('frameDurationMs').value=Math.round(1000/doc.fps);});
  }
  $('frameTimingBtn').addEventListener('click',frameTimingDialog);

  function serializeProject() {
    return JSON.stringify({format:'spritecreator',version:2,name:doc.name,width:doc.width,height:doc.height,fps:doc.fps,frameIndex:doc.frameIndex,frameIds:doc.frameIds,frameDurations:doc.frameDurations,frameTags:doc.frameTags,palette:doc.palette,assetInfo:doc.assetInfo||{type:'character',animationName:'default',pivot:{x:0.5,y:0.5}},createdAt:doc.createdAt,layers:doc.layers.map(layer=>({id:layer.id,name:layer.name,visible:layer.visible,opacity:layer.opacity,frames:layer.frames.map(p=>bytesToBase64(p))}))});
  }
  function bytesToBase64(bytes){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary);}
  function base64ToBytes(value){const binary=atob(value);const bytes=new Uint8ClampedArray(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
  function parseProject(data) {
    const raw=typeof data==='string'?JSON.parse(data):data;
    if(raw.format!=='spritecreator'||!Number.isInteger(raw.width)||!Number.isInteger(raw.height)||raw.width<1||raw.height<1||raw.width>1024||raw.height>1024||!Array.isArray(raw.layers)||!raw.layers.length) throw new Error('This does not look like a valid Sprite Creator project.');
    const frameCount=Math.max(1,raw.layers[0].frames?.length||1);
    if(frameCount>256) throw new Error('Projects can contain up to 256 animation frames.');
    const layers=raw.layers.map(layer=>({id:layer.id||uniqueId(),name:String(layer.name||'Layer').slice(0,40),visible:layer.visible!==false,opacity:Math.max(0,Math.min(100,Number(layer.opacity??100))),frames:Array.from({length:frameCount},(_,i)=>{const encoded=layer.frames?.[i];if(!encoded)return blankPixels(raw.width,raw.height);const bytes=base64ToBytes(encoded);if(bytes.length!==raw.width*raw.height*4)throw new Error('A cel has invalid pixel data.');return bytes;})}));
    const allowedAssetTypes=['character','enemy','npc','object','weapon','item','tileset','effect','ui','other'];
    const rawInfo=raw.assetInfo&&typeof raw.assetInfo==='object'?raw.assetInfo:{};
    const rawPivot=rawInfo.pivot&&typeof rawInfo.pivot==='object'?rawInfo.pivot:{};
    const pivotX=Number(rawPivot.x??0.5),pivotY=Number(rawPivot.y??0.5);
    const assetInfo={type:allowedAssetTypes.includes(rawInfo.type)?rawInfo.type:'character',animationName:String(rawInfo.animationName||'default').trim().slice(0,48)||'default',pivot:{x:Number.isFinite(pivotX)?Math.max(0,Math.min(1,pivotX)):0.5,y:Number.isFinite(pivotY)?Math.max(0,Math.min(1,pivotY)):0.5}};
    const validFrameIds=Array.isArray(raw.frameIds)&&raw.frameIds.length===frameCount&&raw.frameIds.every(id=>typeof id==='string')&&new Set(raw.frameIds).size===frameCount;
    const frameIds=validFrameIds?[...raw.frameIds]:Array.from({length:frameCount},()=>uniqueId());
    const idSet=new Set(frameIds);
    const frameDurations=Array.from({length:frameCount},(_,i)=>{const value=raw.frameDurations?.[i];return value==null?null:Math.max(20,Math.min(5000,Math.round(Number(value)||125)));});
    const frameTags=Array.isArray(raw.frameTags)?raw.frameTags.filter(tag=>tag&&typeof tag==='object').slice(0,64).map(tag=>({name:String(tag.name||'Animation').trim().slice(0,48)||'Animation',frameIds:Array.isArray(tag.frameIds)?[...new Set(tag.frameIds.filter(id=>idSet.has(id)))]:[],direction:['forward','reverse','pingpong'].includes(tag.direction)?tag.direction:'forward'})).filter(tag=>tag.frameIds.length):[];
    return {format:'spritecreator',version:2,name:String(raw.name||'Untitled Sprite'),width:raw.width,height:raw.height,fps:Math.max(1,Math.min(60,Number(raw.fps)||8)),frameIndex:Math.max(0,Math.min(frameCount-1,Number(raw.frameIndex)||0)),frameIds,frameDurations,frameTags,palette:Array.isArray(raw.palette)?raw.palette.filter(x=>/^#[0-9a-f]{6}$/i.test(x)).slice(0,128):[...paletteDefaults],assetInfo,createdAt:raw.createdAt||new Date().toISOString(),layers};
  }
  async function saveProject() {
    if(transformState)commitSelectionTransform();
    const data=serializeProject();
    if(window.spriteDesktop?.isDesktop){
      try{const result=await window.spriteDesktop.saveProject(data,`${doc.name.replace(/[\\/:*?"<>|]/g,'_')}.spritecreator`);if(result.canceled)return;lastSavedPath=result.filePath;markClean();toast('Project saved successfully.');setStatus(`Saved: ${result.filePath}`);}catch(error){toast(`Save failed: ${error.message}`,'error');}
    }else{downloadBlob(new Blob([data],{type:'application/json'}),`${doc.name}.spritecreator`);markClean();toast('Project downloaded.');}
  }
  async function openProject() {
    if(transformState)commitSelectionTransform();
    if(dirty&&!window.confirm('Open another project and replace the current one? Save your current project first if you want to keep it.'))return;
    try{
      let data;
      if(window.spriteDesktop?.isDesktop){const result=await window.spriteDesktop.openProject();if(result.canceled)return;data=result.data;lastSavedPath=result.filePath;}
      else {const result=await chooseFile($('fallbackOpenInput'));if(!result)return;data=await result.text();}
      const loaded=parseProject(data);stopPlayback();doc=loaded;activeLayer=doc.layers.length-1;history=[];future=[];selection=null;transformState=null;markClean();render();fitCanvas();centerCanvas();toast('Project opened.');setStatus(`Opened ${doc.name}`);
      localStorage.setItem('spritecreator-autosave',serializeProject());
    }catch(error){toast(error.message||'Could not open project.','error');}
  }
  function chooseFile(input){return new Promise(resolve=>{input.value='';input.onchange=()=>resolve(input.files?.[0]||null);input.click();});}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function saveImageBytes(bytes,name,filters,title){
    if(window.spriteDesktop?.isDesktop){const base64=bytesToBase64(bytes);return window.spriteDesktop.saveBytes(base64,name,filters,title);}
    downloadBlob(new Blob([bytes]),name);return Promise.resolve({canceled:false});
  }
  function canvasToBytes(canvas,type='image/png') {return new Promise((resolve,reject)=>canvas.toBlob(async blob=>{if(!blob){reject(new Error('Could not encode image.'));return;}resolve(new Uint8Array(await blob.arrayBuffer()));},type));}
  function slugify(value){return String(value||'sprite').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'sprite';}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function assetInfo(){return doc.assetInfo||{type:'character',animationName:'default',pivot:{x:0.5,y:0.5}};}
  function zipStore(files){
    const encoder=new TextEncoder(),locals=[],centrals=[];let offset=0;
    const crc32=bytes=>{let crc=0xFFFFFFFF;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xEDB88320&-(crc&1));}return (crc^0xFFFFFFFF)>>>0;};
    const u16=(view,at,value)=>view.setUint16(at,value,true),u32=(view,at,value)=>view.setUint32(at,value,true);
    const date=new Date(),time=((date.getHours()&31)<<11)|((date.getMinutes()&63)<<5)|(Math.floor(date.getSeconds()/2)&31),dosDate=(((Math.max(1980,date.getFullYear())-1980)&127)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31);
    for(const file of files){
      const name=encoder.encode(String(file.name).replace(/[\\/:*?"<>|]/g,'_').replace(/^\.+/,'')||'asset.bin');const data=file.bytes instanceof Uint8Array?file.bytes:new Uint8Array(file.bytes);const crc=crc32(data);
      const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);u32(lv,0,0x04034b50);u16(lv,4,20);u16(lv,6,0x0800);u16(lv,8,0);u16(lv,10,time);u16(lv,12,dosDate);u32(lv,14,crc);u32(lv,18,data.length);u32(lv,22,data.length);u16(lv,26,name.length);u16(lv,28,0);local.set(name,30);locals.push(local,data);
      const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);u32(cv,0,0x02014b50);u16(cv,4,0x0314);u16(cv,6,20);u16(cv,8,0x0800);u16(cv,10,0);u16(cv,12,time);u16(cv,14,dosDate);u32(cv,16,crc);u32(cv,20,data.length);u32(cv,24,data.length);u16(cv,28,name.length);u16(cv,30,0);u16(cv,32,0);u16(cv,34,0);u16(cv,36,0);u32(cv,38,0);u32(cv,42,offset);central.set(name,46);centrals.push(central);offset+=local.length+data.length;
    }
    const centralSize=centrals.reduce((sum,item)=>sum+item.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);u32(ev,0,0x06054b50);u16(ev,4,0);u16(ev,6,0);u16(ev,8,files.length);u16(ev,10,files.length);u32(ev,12,centralSize);u32(ev,16,offset);u16(ev,20,0);
    const all=[...locals,...centrals,end],size=all.reduce((sum,item)=>sum+item.length,0),output=new Uint8Array(size);let at=0;for(const item of all){output.set(item,at);at+=item.length;}return output;
  }
  async function saveAssetBundle(files,baseName,title){
    const cleanFiles=files.map(file=>({name:file.name,bytes:file.bytes}));
    if(window.spriteDesktop?.isDesktop){
      const payload=cleanFiles.map(file=>({name:file.name,base64:bytesToBase64(file.bytes)}));
      const result=await window.spriteDesktop.saveBundle(payload,`${slugify(baseName)}-assets.zip`,title||'Save game asset bundle');
      if(result.canceled)return false;
      toast(`Asset bundle saved: ${result.filePath}`);return true;
    }
    const archive=zipStore(cleanFiles);downloadBlob(new Blob([archive],{type:'application/zip'}),`${slugify(baseName)}-assets.zip`);
    toast(`Asset package downloaded (${cleanFiles.length} files).`);return true;
  }
  async function exportPng(){if(transformState)commitSelectionTransform();try{const canvas=compositeFrame(doc.frameIndex);const bytes=await canvasToBytes(canvas);await saveImageBytes(bytes,`${slugify(doc.name)}-frame-${doc.frameIndex+1}.png`,[{name:'PNG image',extensions:['png']}],'Export current frame');toast('PNG export ready.');}catch(e){toast(e.message,'error');}}

  function calculateSheetLayout(columns,spacing,padding){
    const count=doc.layers[0].frames.length;
    const cols=Math.max(1,Math.min(count,Math.floor(Number(columns)||1)));
    const gap=Math.max(0,Math.min(128,Math.floor(Number(spacing)||0)));
    const pad=Math.max(0,Math.min(128,Math.floor(Number(padding)||0)));
    const rows=Math.ceil(count/cols);
    return {count,columns:cols,rows,spacing:gap,padding:pad,width:pad*2+cols*doc.width+(cols-1)*gap,height:pad*2+rows*doc.height+(rows-1)*gap};
  }
  async function buildAnimationSheetBundle(options={}){
    const layout=calculateSheetLayout(options.columns??Math.ceil(Math.sqrt(doc.layers[0].frames.length)),options.spacing??0,options.padding??0);
    if(layout.width>8192||layout.height>8192||layout.width*layout.height>64_000_000)throw new Error('This sheet would be too large. Reduce the columns, spacing, or padding.');
    const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
    const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
    const info=assetInfo();
    const animationName=String(options.animationName||info.animationName||'default').trim().slice(0,48)||'default';
    const idToIndex=new Map(doc.frameIds.map((id,index)=>[id,index]));
    const clipNameByFrame=new Map();
    for(const tag of doc.frameTags){for(const id of tag.frameIds){const index=idToIndex.get(id);if(Number.isInteger(index)&&!clipNameByFrame.has(index))clipNameByFrame.set(index,tag.name);}}
    const frames=[];
    for(let i=0;i<layout.count;i++){
      const x=layout.padding+(i%layout.columns)*(doc.width+layout.spacing);
      const y=layout.padding+Math.floor(i/layout.columns)*(doc.height+layout.spacing);
      ctx.drawImage(compositeFrame(i),x,y);
      frames.push({index:i,name:`${slugify(clipNameByFrame.get(i)||animationName||'frame')}_${String(i+1).padStart(3,'0')}`,frame:{x,y,w:doc.width,h:doc.height},rotated:false,trimmed:false,duration:Math.round(doc.frameDurations[i]??(1000/doc.fps)),pivot:{x:info.pivot?.x??0.5,y:info.pivot?.y??0.5}});
    }
    const imageName=`${slugify(doc.name)}-spritesheet.png`;
    const clips=doc.frameTags.map(tag=>({name:tag.name,frames:tag.frameIds.map(id=>idToIndex.get(id)).filter(index=>Number.isInteger(index)),direction:tag.direction,fps:doc.fps,loop:true})).filter(tag=>tag.frames.length);
    if(!clips.length)clips.push({name:animationName,frames:Array.from({length:layout.count},(_,index)=>index),direction:'forward',fps:doc.fps,loop:true});
    for(const clip of clips){if(clip.frames.every((frame,index)=>index===0||frame===clip.frames[index-1]+1)){clip.from=clip.frames[0];clip.to=clip.frames[clip.frames.length-1];}}
    const metadata={format:'spritecreator-atlas',version:1,meta:{app:'Sprite Creator',appVersion:'1.9.0',image:imageName,size:{w:layout.width,h:layout.height},scale:'1'},asset:{name:doc.name,type:info.type,animationName,pivot:info.pivot||{x:0.5,y:0.5}},layout:{type:'grid',frameWidth:doc.width,frameHeight:doc.height,columns:layout.columns,rows:layout.rows,spacing:layout.spacing,padding:layout.padding},frames,animations:clips};
    const imageBytes=await canvasToBytes(canvas);
    const jsonBytes=new TextEncoder().encode(JSON.stringify(metadata,null,2));
    const readme=new TextEncoder().encode(`Sprite Creator animation sheet\n\nImage: ${imageName}\nMetadata: ${slugify(doc.name)}-spritesheet.json\nFrame size: ${doc.width} x ${doc.height}\nFrames: ${layout.count}\nGrid: ${layout.columns} columns x ${layout.rows} rows\nFrame duration: ${Math.round(1000/doc.fps)} ms (${doc.fps} FPS)\nPivot: ${metadata.asset.pivot.x}, ${metadata.asset.pivot.y}\n\nAll image pixels preserve PNG alpha transparency. Coordinates in JSON are pixel coordinates from the top-left corner.`);
    return [{name:imageName,bytes:imageBytes},{name:`${slugify(doc.name)}-spritesheet.json`,bytes:jsonBytes},{name:'README.txt',bytes:readme}];
  }
  function godotSpriteFramesResource(metadata,pngName){
    const frames=metadata.frames,clips=metadata.animations||[];let subresources=[],nextId=1;
    const byIndex=new Map();
    for(const frame of frames){const id=`AtlasTexture_${nextId++}`;byIndex.set(frame.index,id);subresources.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("1_atlas")\nregion = Rect2(${frame.frame.x}, ${frame.frame.y}, ${frame.frame.w}, ${frame.frame.h})`);}
    const animations=clips.map(clip=>{
      let sequence=[...clip.frames];
      if(clip.direction==='reverse')sequence.reverse();
      if(clip.direction==='pingpong'&&sequence.length>2)sequence=sequence.concat(sequence.slice(1,-1).reverse());
      const items=sequence.map(index=>{const frame=frames.find(item=>item.index===index);const id=byIndex.get(index);if(!frame||!id)return null;const duration=Math.max(.05,(frame.duration/(1000/Math.max(1,clip.fps||doc.fps))));return `{ "duration": ${duration.toFixed(3)}, "texture": SubResource("${id}") }`;}).filter(Boolean);
      return `{ "frames": Array[Dictionary]([${items.join(', ')}]), "loop": ${clip.loop!==false}, "name": &"${String(clip.name).replace(/[^a-zA-Z0-9_ -]/g,'_')}", "speed": ${Number(clip.fps||doc.fps)}.0 }`;
    });
    return `[gd_resource type="SpriteFrames" load_steps=${subresources.length+2} format=3]\n\n[ext_resource type="Texture2D" path="res://${pngName}" id="1_atlas"]\n\n${subresources.join('\n\n')}\n\n[resource]\nanimations = Array[Dictionary]([${animations.join(', ')}])\n`;
  }
  function unityImporterScript(jsonName){
    return `// Sprite Creator 1.9.0 — Unity Editor sprite-sheet slicer\n// Put this file in Assets/Editor/. Keep the PNG and JSON side-by-side in Assets.\nusing System;\nusing System.IO;\nusing System.Linq;\nusing System.Collections.Generic;\nusing UnityEditor;\nusing UnityEngine;\n\n[Serializable] public class SCFrameRect { public int index; public string name; public SCRect frame; public SCPivot pivot; }\n[Serializable] public class SCRect { public int x, y, w, h; }\n[Serializable] public class SCPivot { public float x, y; }\n[Serializable] public class SCMeta { public SCFrameRect[] frames; }\n\npublic static class SpriteCreatorSheetImporter {\n    [MenuItem("Assets/Sprite Creator/Apply Sheet Metadata", true)]\n    static bool ValidateApply() => Selection.activeObject is Texture2D;\n\n    [MenuItem("Assets/Sprite Creator/Apply Sheet Metadata")]\n    static void Apply() {\n        var texture = Selection.activeObject as Texture2D;\n        var pngPath = AssetDatabase.GetAssetPath(texture);\n        var jsonPath = Path.ChangeExtension(pngPath, ".json");\n        if (!File.Exists(jsonPath)) { EditorUtility.DisplayDialog("Sprite Creator", "Could not find companion metadata JSON next to the selected PNG.", "OK"); return; }\n        var meta = JsonUtility.FromJson<SCMeta>(File.ReadAllText(jsonPath));\n        if (meta?.frames == null || meta.frames.Length == 0) { EditorUtility.DisplayDialog("Sprite Creator", "The metadata contains no frames.", "OK"); return; }\n        var importer = AssetImporter.GetAtPath(pngPath) as TextureImporter;\n        importer.textureType = TextureImporterType.Sprite;\n        importer.spriteImportMode = SpriteImportMode.Multiple;\n        importer.filterMode = FilterMode.Point;\n        importer.textureCompression = TextureImporterCompression.Uncompressed;\n        importer.alphaIsTransparency = true;\n        importer.spritePixelsPerUnit = 16;\n        importer.spritesheet = meta.frames.Select(frame => new SpriteMetaData {\n            name = string.IsNullOrWhiteSpace(frame.name) ? $"frame_{frame.index:000}" : frame.name,\n            rect = new Rect(frame.frame.x, texture.height - frame.frame.y - frame.frame.h, frame.frame.w, frame.frame.h),\n            alignment = (int)SpriteAlignment.Custom,\n            pivot = new Vector2(frame.pivot?.x ?? .5f, 1f - (frame.pivot?.y ?? .5f)),\n            border = Vector4.zero\n        }).ToArray();\n        EditorUtility.SetDirty(importer);\n        importer.SaveAndReimport();\n        EditorUtility.DisplayDialog("Sprite Creator", $"Imported {meta.frames.Length} sprites with point filtering and transparency.", "Great");\n    }\n}\n`;
  }
  function gameMakerIdentifier(value,prefix='spr'){
    let token=String(value||'asset').normalize('NFKD').replace(/[^a-zA-Z0-9_]+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();
    if(!token)token='asset';
    if(/^\d/.test(token))token=`asset_${token}`;
    return `${prefix}_${token}`;
  }
  function gameMakerClipData(){
    const idToIndex=new Map(doc.frameIds.map((id,index)=>[id,index]));
    let sourceClips=doc.frameTags.map(tag=>({name:tag.name,sourceFrames:tag.frameIds.map(id=>idToIndex.get(id)).filter(Number.isInteger),direction:tag.direction||'forward'})).filter(clip=>clip.sourceFrames.length);
    if(!sourceClips.length)sourceClips=[{name:assetInfo().animationName||'default',sourceFrames:doc.frameIds.map((_,index)=>index),direction:'forward'}];
    return sourceClips.map(clip=>{
      let order=[...clip.sourceFrames];
      if(clip.direction==='reverse')order.reverse();
      if(clip.direction==='pingpong'&&order.length>2)order=order.concat(order.slice(1,-1).reverse());
      const usedFrames=order.map((sourceFrame,outputFrame)=>({outputFrame,sourceFrame,durationMs:Math.max(20,Math.round(doc.frameDurations[sourceFrame]??(1000/doc.fps)))}));
      return {...clip,frames:usedFrames};
    });
  }
  async function buildGameMakerBundle(){
    const info=assetInfo();
    const token=gameMakerIdentifier(doc.name).replace(/^spr_/, '');
    const origin={x:Math.round((info.pivot?.x??0.5)*doc.width),y:Math.round((info.pivot?.y??0.5)*doc.height)};
    const clips=gameMakerClipData();
    const files=[];
    const usedNames=new Set();
    const uniqueResource=(base)=>{let name=base,n=2;while(usedNames.has(name))name=`${base}_${n++}`;usedNames.add(name);return name;};
    const makeStrip=async(sequence)=>{
      if(!sequence.length)throw new Error('A GameMaker animation clip must contain at least one frame.');
      if(sequence.length>256)throw new Error('GameMaker strips are limited to 256 frames per clip.');
      const canvas=document.createElement('canvas');canvas.width=doc.width*sequence.length;canvas.height=doc.height;
      if(canvas.width>8192||canvas.height>8192||canvas.width*canvas.height>64_000_000)throw new Error('The GameMaker strip is too large. Reduce the frame size or split this animation into smaller clips.');
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
      sequence.forEach((frame,x)=>ctx.drawImage(compositeFrame(frame),x*doc.width,0));
      return canvasToBytes(canvas);
    };
    const allFrames=doc.frameIds.map((_,index)=>index);
    const allResource=uniqueResource(`spr_${token}_all`);
    const allName=`${allResource}_strip${allFrames.length}.png`;
    files.push({name:allName,bytes:await makeStrip(allFrames)});
    const clipManifest=[];
    const clipFunctionRows=[];
    for(let i=0;i<clips.length;i++){
      const clip=clips[i];
      let clipToken=String(clip.name||`clip_${i+1}`).normalize('NFKD').replace(/[^a-zA-Z0-9_]+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();
      if(!clipToken)clipToken=`clip_${i+1}`;
      if(/^\d/.test(clipToken))clipToken=`clip_${clipToken}`;
      const resourceName=uniqueResource(`spr_${token}_${clipToken}`);
      const fileName=`${resourceName}_strip${clip.frames.length}.png`;
      files.push({name:fileName,bytes:await makeStrip(clip.frames.map(frame=>frame.sourceFrame))});
      const durations=clip.frames.map(frame=>frame.durationMs);
      const durationFunction=`sc_${resourceName.replace(/^spr_/, '')}_durations`;
      clipFunctionRows.push(`function ${durationFunction}() {\n    return [${durations.join(', ')}];\n}`);
      clipManifest.push({
        name:clip.name,resourceName,file:fileName,direction:clip.direction,loop:true,
        frameCount:clip.frames.length,sourceFrames:clip.frames.map(frame=>frame.sourceFrame),
        frameDurationsMs:durations,durationFunction,
        origin:{x:origin.x,y:origin.y},
        frames:clip.frames.map(frame=>({index:frame.outputFrame,sourceFrame:frame.sourceFrame,sourceFrameId:doc.frameIds[frame.sourceFrame],durationMs:frame.durationMs}))
      });
    }
    const helperPrefix=`sc_${token}`;
    const helper=`// Sprite Creator 1.9.0 — GameMaker GML animation helpers\n// Import the companion *_stripN.png files as Sprite assets first.\n// The generated frame-duration functions match each clip's exported strip order.\n\nfunction ${helperPrefix}_anim_state_create() {\n    return { frame: 0, elapsed_us: 0, finished: false };\n}\n\nfunction ${helperPrefix}_anim_state_reset(_state) {\n    _state.frame = 0;\n    _state.elapsed_us = 0;\n    _state.finished = false;\n}\n\n/// Advances one clip using GameMaker's delta_time value (microseconds).\n/// Returns the image_index to assign to the instance.\nfunction ${helperPrefix}_anim_step(_state, _durations_ms, _delta_time_us, _loop) {\n    var _count = array_length(_durations_ms);\n    if (_count <= 0) return 0;\n    _state.frame = clamp(floor(_state.frame), 0, _count - 1);\n    if (_state.finished) return _state.frame;\n    _state.elapsed_us += max(0, _delta_time_us);\n    var _guard = 0;\n    while (!_state.finished && _guard < 512) {\n        var _duration_us = max(1, _durations_ms[_state.frame]) * 1000;\n        if (_state.elapsed_us < _duration_us) break;\n        _state.elapsed_us -= _duration_us;\n        if (_state.frame < _count - 1) {\n            _state.frame += 1;\n        } else if (_loop) {\n            _state.frame = 0;\n        } else {\n            _state.finished = true;\n            _state.elapsed_us = 0;\n        }\n        _guard += 1;\n    }\n    return _state.frame;\n}\n\n${clipFunctionRows.join('\n\n')}\n`;
    files.push({name:`${helperPrefix}_animation.gml`,bytes:new TextEncoder().encode(helper)});
    const manifest={
      format:'spritecreator-gamemaker-assets',version:2,appVersion:'1.9.0',
      asset:{name:doc.name,resourcePrefix:`spr_${token}`,type:info.type,width:doc.width,height:doc.height,
        origin:{x:origin.x,y:origin.y,normalized:{x:info.pivot?.x??0.5,y:info.pivot?.y??0.5}},
        recommendedOrigin:((info.type==='character'||info.type==='enemy'||info.type==='npc')&&origin.x===Math.round(doc.width/2)&&origin.y===doc.height)?'bottom_center':'custom'},
      import:{format:'horizontal-strip-png',filenameConvention:'*_stripN.png',frameWidth:doc.width,frameHeight:doc.height,removeBackground:false,smooth:false,textureFiltering:'nearest-neighbor',transparent:true},
      timeline:{frameCount:doc.layers[0].frames.length,frameIds:[...doc.frameIds],fps:doc.fps,allFrames:{resourceName:allResource,file:allName,frameCount:allFrames.length}},
      clips:clipManifest
    };
    files.push({name:`${helperPrefix}_gamemaker_manifest.json`,bytes:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
    const spriteNames=clipManifest.map(clip=>`- ${clip.name}: ${clip.file} → rename the imported Sprite resource to ${clip.resourceName}`).join('\n');
    const durationLines=clipManifest.map(clip=>`${clip.name}: ${clip.frameCount} frames; durations ${clip.frameDurationsMs.join(', ')} ms; duration function ${clip.durationFunction}()`).join('\n');
    const primaryClip=clipManifest[0];
    const alternateClip=clipManifest.find((clip,index)=>index>0&&/(attack|cast|hurt|death|skill)/i.test(clip.name))||clipManifest[1]||null;
    const primaryName=JSON.stringify(primaryClip.name);
    const alternateName=alternateClip?JSON.stringify(alternateClip.name):null;
    const readme=`SPRITE CREATOR 1.9.0 — GAMEMAKER 2D RPG ASSET PACKAGE

FILES
- ${allName}: complete source timeline as one horizontal strip → optional resource name ${allResource}.
${spriteNames}
- ${helperPrefix}_animation.gml: frame-timing helpers and per-clip duration functions.
- ${helperPrefix}_gamemaker_manifest.json: import manifest with dimensions, origins, frame order, and timing.

IMPORT INTO GAMEMAKER
1. In the Asset Browser, open your Sprites folder and import each PNG. Files ending in _stripN.png are GameMaker's strip naming convention; GameMaker splits the horizontal strip into N subimages.
2. Rename each imported Sprite resource to the resource name shown above (remove the _stripN suffix). Keep the sprite resource name lowercase with letters, numbers, and underscores.
3. Open each Sprite resource and set its Origin to Custom using X=${origin.x}, Y=${origin.y} pixels from the manifest. This export uses the same fixed canvas and origin for every frame.
4. Keep transparency enabled; do not enable Remove Background. Disable texture filtering for crisp pixel art.
5. Add ${helperPrefix}_animation.gml as a Script asset. The helper functions support per-frame durations using GameMaker's delta_time (microseconds).
6. In the game's Create event (or a central controller Create event), call gpu_set_texfilter(false) for nearest-neighbor sampling.

RECOMMENDED RPG NAMING
Use tags that combine action and direction, for example idle_down, walk_down, attack_down, hurt, cast_up, or death. A four-direction character commonly has idle_up/down/left/right and walk_up/down/left/right. The export creates one importable Sprite strip for every non-empty tag. It keeps the same fixed canvas and origin across every clip so the character anchor stays consistent.

FRAME TIMING
If every frame in a clip has the same duration, you can use GameMaker's native sprite speed and image_speed. If a clip has different per-frame durations, set image_speed=0 and use the generated helper. The helper receives delta_time in microseconds and returns the subimage index to assign to image_index.

CREATE EVENT EXAMPLE
anim_state = ${helperPrefix}_anim_state_create();
anim_clip = ${primaryName};
sprite_index = ${primaryClip.resourceName};
image_speed = 0;
gpu_set_texfilter(false);

STEP EVENT EXAMPLE
image_index = ${helperPrefix}_anim_step(anim_state, ${primaryClip.durationFunction}(), delta_time, true);

SWITCH TO ANOTHER EXPORTED CLIP
sprite_index = ${alternateClip?alternateClip.resourceName:primaryClip.resourceName};
anim_clip = ${alternateName||primaryName};
${helperPrefix}_anim_state_reset(anim_state);
image_index = 0;
// In the Step event, pass the matching clip's duration function to ${helperPrefix}_anim_step.
// For a one-shot action (such as an attack), pass false for the final _loop argument
// and return to the desired idle/walk clip when anim_state.finished becomes true.

RUNTIME LOADING (OPTIONAL)
runtime_sprite = sprite_add("${allName}", ${allFrames.length}, false, false, ${origin.x}, ${origin.y});
// The PNG must be in Included Files; include its relative path if stored in a subfolder.
// When finished with a runtime-created sprite, call sprite_delete(runtime_sprite).

CLIP DATA
${durationLines}

ORIGIN / COLLISION GUIDANCE
For top-down RPG characters, bottom-center at the feet is usually a useful origin for consistent depth sorting. Adjust this in Sprite Creator's Assets > Asset properties before export if needed. Configure the collision mask separately in GameMaker to match gameplay; transparent artwork is not a collision shape. Keep the same frame canvas dimensions and origin across all directional and action clips for stable movement and sorting.

The PNGs preserve alpha transparency. The manifest records source frame IDs and durations for traceability. This bundle does not create GameMaker objects, rooms, collision logic, or game maps.
`;
    files.push({name:'GAMEMAKER-SETUP.txt',bytes:new TextEncoder().encode(readme)});
    return files;
  }
  async function buildEngineBundle(engine,options={}){
    if(engine==='gamemaker')return buildGameMakerBundle();
    const frameCount=doc.layers[0].frames.length;
    const bundleOptions=options;
    const files=await buildAnimationSheetBundle(bundleOptions);
    const png=files.find(file=>file.name.endsWith('.png'));
    const json=files.find(file=>file.name.endsWith('.json'));
    const metadata=JSON.parse(new TextDecoder().decode(json.bytes));
    const pngName=png.name,base=slugify(doc.name);
    const readmeBase=`Sprite Creator engine export\nEngine preset: ${engine}\nSprite sheet: ${pngName}\nFrame size: ${doc.width} × ${doc.height}\nFrames: ${metadata.frames.length}\nPivot: ${metadata.asset.pivot.x}, ${metadata.asset.pivot.y}\n\nAll artwork is exported as a transparent PNG using nearest-neighbor-friendly pixel dimensions. Companion JSON includes frame rectangles, durations, pivot data, and named animation clips.\n`;
    if(engine==='godot'){
      const tres=godotSpriteFramesResource(metadata,pngName);
      const guide=readmeBase+`\nGodot 4 setup:\n1. Copy all files into your Godot project (same folder).\n2. Let Godot import the PNG. Set its texture filter to Nearest in project or CanvasItem settings.\n3. Use ${base}.tres as a SpriteFrames resource on an AnimatedSprite2D node.\n4. Call play("idle") or the exact animation names listed in the JSON.\n\nThe SpriteFrames resource contains AtlasTexture regions for every exported frame and separate named animations.\n`;
      files.push({name:`${base}.tres`,bytes:new TextEncoder().encode(tres)},{name:'GODOT-SETUP.txt',bytes:new TextEncoder().encode(guide)});
    }else if(engine==='unity'){
      const script=unityImporterScript(json.name);
      const guide=readmeBase+`\nUnity setup:\n1. Copy the PNG and companion JSON into Assets (keep their filenames together).\n2. Put SpriteCreatorUnityImporter.cs in Assets/Editor/.\n3. Select the PNG in the Project window.\n4. Choose Assets > Sprite Creator > Apply Sheet Metadata.\n5. Unity slices every frame using its exact exported rectangle, sets Point filtering, preserves alpha, and applies sprite pivots.\n6. Use the generated sprites in Animation Clips or an Animator Controller. Clip ranges and per-frame timing are available in the companion JSON.\n\nThe included editor helper uses UnityEditor TextureImporter APIs and must stay inside an Editor folder.\n`;
      files.push({name:'SpriteCreatorUnityImporter.cs',bytes:new TextEncoder().encode(script)},{name:'UNITY-SETUP.txt',bytes:new TextEncoder().encode(guide)});
    }
    const guideIndex=files.findIndex(file=>file.name==='README.txt');
    if(guideIndex>=0)files[guideIndex]={name:'README.txt',bytes:new TextEncoder().encode(readmeBase)};
    return files;
  }
  function exportEngineDialog(){
    if(transformState)commitSelectionTransform();
    const count=doc.layers[0].frames.length;
    const host=showModal('Export for a game engine',`<p class="modal-actions-note">Choose an engine preset. The GameMaker preset creates a separate importable strip for each named animation clip, a companion timing helper, and an RPG-focused import manifest.</p><div class="field"><label for="enginePreset">TARGET ENGINE</label><select id="enginePreset"><option value="gamemaker" selected>GameMaker · IDE sprite strips + GML animation helpers (recommended)</option><option value="godot">Godot 4 · SpriteFrames resource</option><option value="unity">Unity · Sprite slicing editor helper</option></select></div><div class="field-grid"><div class="field"><label for="engineColumns">SHEET COLUMNS</label><input id="engineColumns" type="number" min="1" max="${count}" value="${Math.ceil(Math.sqrt(count))}"></div><div class="field"><label for="engineSpacing">SPACING (PX)</label><input id="engineSpacing" type="number" min="0" max="128" value="0"></div></div><div class="field"><label for="enginePadding">OUTER PADDING (PX)</label><input id="enginePadding" type="number" min="0" max="128" value="0"></div><div id="engineExportSummary" class="asset-export-summary"></div><div class="field-help">The target engine still handles scenes, maps, physics, and gameplay. This package prepares the art and import settings.</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Build engine package',primary:true,onClick:async h=>{try{const engine=$('enginePreset').value,options={columns:$('engineColumns').value,spacing:$('engineSpacing').value,padding:$('enginePadding').value};const files=await buildEngineBundle(engine,options);await saveAssetBundle(files,doc.name,`Export ${engine} asset package`);h.innerHTML='';}catch(error){toast(error.message,'error');}}}
    ]);
    const update=()=>{try{const gameMaker=$('enginePreset').value==='gamemaker';$('engineColumns').disabled=gameMaker;$('engineSpacing').disabled=gameMaker;$('enginePadding').disabled=gameMaker;const layout=calculateSheetLayout($('engineColumns').value,$('engineSpacing').value,$('enginePadding').value);$('engineExportSummary').textContent=gameMaker?`${doc.frameTags.length||1} named clip(s) · one horizontal _stripN.png per clip · GML timing helper + RPG import manifest`:`${layout.count} frames · ${layout.columns} columns × ${layout.rows} rows · atlas ${layout.width} × ${layout.height} px`;}catch(error){$('engineExportSummary').textContent=error.message;}};
    ['enginePreset','engineColumns','engineSpacing','enginePadding'].forEach(id=>{ $(id).addEventListener('input',update); $(id).addEventListener('change',update); });update();
  }

  function exportSpriteSheetDialog(){
    if(transformState)commitSelectionTransform();
    const count=doc.layers[0].frames.length;const defaultCols=Math.ceil(Math.sqrt(count));
    const host=showModal('Export animation sheet',`<p class="modal-actions-note">Pack every animation frame into a compact grid. The PNG keeps transparency; the JSON records each frame rectangle, timing, animation name, and pivot point.</p><div class="field"><label for="sheetAnimationName">ANIMATION NAME</label><input id="sheetAnimationName" maxlength=48 value="${escapeHtml(assetInfo().animationName||'default')}"></div><div class="field-grid"><div class="field"><label for="sheetColumns">COLUMNS</label><input id="sheetColumns" type="number" min=1 max=${count} value="${defaultCols}"></div><div class="field"><label for="sheetSpacing">SPACING (PX)</label><input id="sheetSpacing" type="number" min=0 max=128 value="0"></div></div><div class="field"><label for="sheetPadding">OUTER PADDING (PX)</label><input id="sheetPadding" type="number" min=0 max=128 value="0"></div><div class="asset-export-summary" id="sheetExportSummary"></div><div class="field-help">The exported ZIP contains a transparent PNG, engine-neutral frame metadata JSON, and a quick reference. Browser mode downloads the files separately.</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Export asset bundle',primary:true,onClick:async h=>{try{const animationName=$('sheetAnimationName').value.trim().slice(0,48)||'default';const options={columns:$('sheetColumns').value,spacing:$('sheetSpacing').value,padding:$('sheetPadding').value};const files=await buildAnimationSheetBundle({...options,animationName});await saveAssetBundle(files,doc.name,'Export animation sheet bundle');h.innerHTML='';}catch(error){toast(error.message,'error');}}}
    ]);
    const update=()=>{try{const layout=calculateSheetLayout($('sheetColumns').value,$('sheetSpacing').value,$('sheetPadding').value);$('sheetExportSummary').textContent=`${layout.count} frames · ${layout.columns} columns × ${layout.rows} rows · ${layout.width} × ${layout.height} px`;}
      catch(error){$('sheetExportSummary').textContent=error.message;}};
    ['sheetColumns','sheetSpacing','sheetPadding'].forEach(id=>$(id).addEventListener('input',update));update();
  }
  function tilesetMetrics(tileWidth,tileHeight,margin,spacing){
    const availableW=doc.width-2*margin+spacing,availableH=doc.height-2*margin+spacing;
    const columns=Math.floor(availableW/(tileWidth+spacing));const rows=Math.floor(availableH/(tileHeight+spacing));
    return {columns,rows,tileCount:Math.max(0,columns)*Math.max(0,rows),imageWidth:doc.width,imageHeight:doc.height};
  }
  async function buildTilesetBundle(options={}){
    const tileWidth=Math.floor(Number(options.tileWidth)),tileHeight=Math.floor(Number(options.tileHeight));
    const margin=Math.floor(Number(options.margin)||0),spacing=Math.floor(Number(options.spacing)||0);
    if(!Number.isInteger(tileWidth)||!Number.isInteger(tileHeight)||tileWidth<1||tileHeight<1||tileWidth>512||tileHeight>512)throw new Error('Tile width and height must be between 1 and 512 pixels.');
    if(margin<0||margin>128||spacing<0||spacing>64)throw new Error('Margin must be 0–128 px and spacing 0–64 px.');
    const metrics=tilesetMetrics(tileWidth,tileHeight,margin,spacing);
    if(!metrics.columns||!metrics.rows||!metrics.tileCount)throw new Error('Those tile settings do not fit any complete tiles inside this sprite.');
    if(metrics.tileCount>4096)throw new Error('This tileset contains too many tiles. Keep it at 4,096 tiles or fewer.');
    const info=assetInfo();const slug=slugify(doc.name);const imageName=`${slug}-tileset.png`;
    const imageBytes=await canvasToBytes(compositeFrame(doc.frameIndex));
    const tileset={type:'tileset',version:'1.10',tiledversion:'1.10.2',name:doc.name,tilewidth:tileWidth,tileheight:tileHeight,tilecount:metrics.tileCount,columns:metrics.columns,margin,spacing,image:imageName,imagewidth:doc.width,imageheight:doc.height,objectalignment:'unspecified',tilerendersize:'tile',fillmode:'stretch',grid:{orientation:'orthogonal',width:tileWidth,height:tileHeight},properties:[{name:'sourceApplication',type:'string',value:'Sprite Creator'},{name:'assetType',type:'string',value:info.type}]};
    const jsonBytes=new TextEncoder().encode(JSON.stringify(tileset,null,2));
    const readme=new TextEncoder().encode(`Sprite Creator tileset export\n\nImage: ${imageName}\nTiled tileset: ${slug}.tsj\nTile size: ${tileWidth} x ${tileHeight}\nColumns: ${metrics.columns}\nRows: ${metrics.rows}\nTile count: ${metrics.tileCount}\nMargin: ${margin}\nSpacing: ${spacing}\n\nThe TSJ file is a Tiled-compatible external tileset definition. Keep it next to the PNG when importing. For Godot, Unity, GameMaker, or other engines, import the PNG as a texture and use the tile size/margin/spacing values above.`);
    return [{name:imageName,bytes:imageBytes},{name:`${slug}.tsj`,bytes:jsonBytes},{name:'README.txt',bytes:readme}];
  }
  function exportTilesetDialog(){
    if(transformState)commitSelectionTransform();
    const host=showModal('Export tileset',`<p class="modal-actions-note">Export the current frame as a transparent tileset PNG with a Tiled-compatible external tileset definition (.tsj). Use the same tile size, margin, and spacing when importing the image into other game engines.</p><div class="field-grid"><div class="field"><label for="tileWidth">TILE WIDTH (PX)</label><input id="tileWidth" type="number" min=1 max=512 value="16"></div><div class="field"><label for="tileHeight">TILE HEIGHT (PX)</label><input id="tileHeight" type="number" min=1 max=512 value="16"></div><div class="field"><label for="tileMargin">MARGIN (PX)</label><input id="tileMargin" type="number" min=0 max=128 value="0"></div><div class="field"><label for="tileSpacing">SPACING (PX)</label><input id="tileSpacing" type="number" min=0 max=64 value="0"></div></div><div class="asset-export-summary" id="tilesetExportSummary"></div><div class="field-help">Tiles are counted from the top-left using the selected grid. Incomplete edge areas are ignored. This exports tileset art and metadata—not a playable map.</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Export tileset bundle',primary:true,onClick:async h=>{try{const options={tileWidth:$('tileWidth').value,tileHeight:$('tileHeight').value,margin:$('tileMargin').value,spacing:$('tileSpacing').value};const files=await buildTilesetBundle(options);await saveAssetBundle(files,doc.name,'Export tileset bundle');h.innerHTML='';}catch(error){toast(error.message,'error');}}}
    ]);
    const update=()=>{try{const w=Math.floor(Number($('tileWidth').value)),he=Math.floor(Number($('tileHeight').value)),m=Math.floor(Number($('tileMargin').value)||0),s=Math.floor(Number($('tileSpacing').value)||0);if(w<1||he<1||m<0||s<0)throw new Error('Enter valid positive tile dimensions.');const result=tilesetMetrics(w,he,m,s);$('tilesetExportSummary').textContent=`${result.tileCount} tiles · ${result.columns} columns × ${result.rows} rows · source ${doc.width} × ${doc.height} px`;}
      catch(error){$('tilesetExportSummary').textContent=error.message;}};
    ['tileWidth','tileHeight','tileMargin','tileSpacing'].forEach(id=>$(id).addEventListener('input',update));update();
  }
  function assetPropertiesDialog(){
    const info=assetInfo();
    const host=showModal('Asset properties',`<p class="modal-actions-note">Record how this artwork should be treated when it is exported. These settings are saved inside the Sprite Creator project and included in animation metadata.</p><div class="field"><label for="assetType">ASSET TYPE</label><select id="assetType"><option value="character">Character</option><option value="enemy">Enemy</option><option value="npc">NPC</option><option value="object">Object / prop</option><option value="weapon">Weapon / equipment</option><option value="item">Inventory item</option><option value="tileset">Tileset</option><option value="effect">Visual effect</option><option value="ui">UI element</option><option value="other">Other</option></select></div><div class="field"><label for="assetAnimationName">ANIMATION / CLIP NAME</label><input id="assetAnimationName" maxlength=48 value="${escapeHtml(info.animationName||'default')}"></div><div class="field"><label for="assetPivot">SPRITE ORIGIN / PIVOT</label><select id="assetPivot"><option value="center">Center</option><option value="bottom-center">Bottom center (character feet)</option><option value="top-left">Top left</option><option value="custom">Custom normalized point</option></select></div><div class="field-grid"><div class="field"><label for="assetPivotX">PIVOT X (0–1)</label><input id="assetPivotX" type="number" min=0 max=1 step=0.05 value="${Number(info.pivot?.x??0.5)}"></div><div class="field"><label for="assetPivotY">PIVOT Y (0–1)</label><input id="assetPivotY" type="number" min=0 max=1 step=0.05 value="${Number(info.pivot?.y??0.5)}"></div></div><div class="field-help">A pivot of 0.5, 1.0 places a character's origin at the bottom-center (feet). A pivot of 0.5, 0.5 places it at the center.</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Save asset properties',primary:true,onClick:h=>{const x=Number($('assetPivotX').value),y=Number($('assetPivotY').value);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1){toast('Pivot values must be between 0 and 1.','error');return;}doc.assetInfo={type:$('assetType').value,animationName:$('assetAnimationName').value.trim().slice(0,48)||'default',pivot:{x,y}};setDirty(true);h.innerHTML='';toast('Asset properties saved to this project.');}}
    ]);
    $('assetType').value=info.type||'character';
    const presets={center:[0.5,0.5],'bottom-center':[0.5,1],'top-left':[0,0]};
    const select=$('assetPivot');const matching=Object.entries(presets).find(([,point])=>point[0]===Number(info.pivot?.x??0.5)&&point[1]===Number(info.pivot?.y??0.5));select.value=matching?matching[0]:'custom';
    select.addEventListener('change',()=>{const point=presets[select.value];if(point){$('assetPivotX').value=point[0];$('assetPivotY').value=point[1];}});
  }

  function frameTagRanges(tag){
    const indexMap=new Map(doc.frameIds.map((id,index)=>[id,index]));
    const indexes=tag.frameIds.map(id=>indexMap.get(id)).filter(Number.isInteger).sort((a,b)=>a-b);
    if(!indexes.length)return 'No frames';
    const ranges=[];let start=indexes[0],last=start;
    for(const value of indexes.slice(1)){if(value===last+1){last=value;continue;}ranges.push(start===last?`${start+1}`:`${start+1}–${last+1}`);start=last=value;}
    ranges.push(start===last?`${start+1}`:`${start+1}–${last+1}`);
    return `Frames ${ranges.join(', ')}`;
  }
  function frameTagsDialog(){
    const tagRows=()=>doc.frameTags.map((tag,index)=>`<div class="frame-tag-row"><div><b>${escapeHtml(tag.name)}</b><small>${frameTagRanges(tag)} · ${escapeHtml(tag.direction)}</small></div><button class="frame-tag-remove" data-remove-tag="${index}" title="Remove animation tag">×</button></div>`).join('')||'<div class="frame-tags-empty">No named clips yet. Add clips like idle, walk, attack, or hurt.</div>';
    const host=showModal('Animation frame tags',`<p class="modal-actions-note">Name useful ranges in your timeline. Tags stay attached to their frames when you reorder the timeline and are included in exported animation metadata.</p><div class="field"><label for="tagName">CLIP NAME</label><input id="tagName" maxlength="48" placeholder="idle, walk, attack…" value="idle"></div><div class="field-grid"><div class="field"><label for="tagStart">FIRST FRAME</label><input id="tagStart" type="number" min="1" max="${doc.layers[0].frames.length}" value="1"></div><div class="field"><label for="tagEnd">LAST FRAME</label><input id="tagEnd" type="number" min="1" max="${doc.layers[0].frames.length}" value="${doc.layers[0].frames.length}"></div></div><div class="field"><label for="tagDirection">PLAYBACK DIRECTION</label><select id="tagDirection"><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="pingpong">Ping-pong</option></select></div><div class="frame-tags-list" id="frameTagsList">${tagRows()}</div>`,[
      {label:'Close',onClick:h=>h.innerHTML=''},
      {label:'Add frame tag',primary:true,onClick:h=>{const name=$('tagName').value.trim().slice(0,48),from=Number($('tagStart').value),to=Number($('tagEnd').value);if(!name){toast('Give this animation clip a name.','error');return;}if(doc.frameTags.some(tag=>tag.name.toLowerCase()===name.toLowerCase())){toast('A clip with that name already exists.','error');return;}if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>doc.frameIds.length){toast(`Choose a frame range between 1 and ${doc.frameIds.length}.`,'error');return;}pushHistory();doc.frameTags.push({name,frameIds:doc.frameIds.slice(from-1,to),direction:$('tagDirection').value});$('frameTagsList').innerHTML=tagRows();$('tagName').value='';renderTimeline();setStatus(`Added animation tag: ${name}`);}}
    ]);
    $('frameTagsList').addEventListener('click',event=>{const button=event.target.closest('[data-remove-tag]');if(!button)return;const index=Number(button.dataset.removeTag);if(!Number.isInteger(index)||!doc.frameTags[index])return;pushHistory();const [removed]=doc.frameTags.splice(index,1);$('frameTagsList').innerHTML=tagRows();renderTimeline();setStatus(`Removed animation tag: ${removed.name}`);});
  }

  async function openSpriteSheetSlicer(){if(transformState)commitSelectionTransform();$('importSheetInput').click();}
  async function showSpriteSheetSliceDialog(file){
    if(!file)return;if(file.size>48*1024*1024){toast('Please choose a sprite sheet smaller than 48 MB.','error');return;}
    const url=URL.createObjectURL(file);const image=new Image();
    try{image.src=url;await image.decode();if(image.width>8192||image.height>8192||image.width*image.height>16_777_216)throw new Error('Sprite sheets must be 8,192 px per side or less and contain no more than 16.7 million pixels.');}
    catch(error){URL.revokeObjectURL(url);toast(error.message||'Could not read that image.','error');return;}
    const baseName=file.name.replace(/\.[^.]+$/,'')||'Imported Animation';
    const host=showModal('Slice sprite sheet into frames',`<p class="modal-actions-note">Choose the size of one animation cel. The slicer reads the image from the top-left, preserving transparency, and imports each grid cell as an editable frame.</p><div class="asset-export-summary">Source image: ${image.width} × ${image.height} px</div><div class="field-grid"><div class="field"><label for="sliceWidth">FRAME WIDTH (PX)</label><input id="sliceWidth" type="number" min=1 max=512 value="32"></div><div class="field"><label for="sliceHeight">FRAME HEIGHT (PX)</label><input id="sliceHeight" type="number" min=1 max=512 value="32"></div><div class="field"><label for="sliceMargin">OUTER MARGIN (PX)</label><input id="sliceMargin" type="number" min=0 max=512 value="0"></div><div class="field"><label for="sliceSpacing">CELL SPACING (PX)</label><input id="sliceSpacing" type="number" min=0 max=512 value="0"></div></div><div class="field-grid"><div class="field"><label for="sliceColumns">COLUMNS (0 = AUTO)</label><input id="sliceColumns" type="number" min=0 max=256 value="0"></div><div class="field"><label for="sliceCount">FRAME COUNT (0 = ALL)</label><input id="sliceCount" type="number" min=0 max=256 value="0"></div></div><div class="asset-export-summary" id="sliceSummary"></div>`,[
      {label:'Cancel',onClick:h=>{h.innerHTML='';URL.revokeObjectURL(url);}},
      {label:'Import frames',primary:true,onClick:h=>{try{const fw=Number($('sliceWidth').value),fh=Number($('sliceHeight').value),margin=Number($('sliceMargin').value),spacing=Number($('sliceSpacing').value),requestedColumns=Number($('sliceColumns').value),requestedCount=Number($('sliceCount').value);if(![fw,fh,margin,spacing,requestedColumns,requestedCount].every(Number.isInteger)||fw<1||fh<1||fw>512||fh>512||margin<0||spacing<0||requestedColumns<0||requestedCount<0||requestedColumns>256||requestedCount>256)throw new Error('Check the slicing values and try again.');const maxCols=Math.floor((image.width-2*margin+spacing)/(fw+spacing));const rows=Math.floor((image.height-2*margin+spacing)/(fh+spacing));const cols=requestedColumns||maxCols;if(!cols||cols>maxCols||!rows)throw new Error('That frame size does not fit inside the source image.');const count=requestedCount||cols*rows;if(count<1||count>256||count>cols*rows)throw new Error('Frame count must fit the grid and be no more than 256.');if(count*fw*fh>16_777_216)throw new Error('The sliced animation is too large. Reduce the frame size or number of frames.');if(transformState)commitSelectionTransform();stopPlayback();doc=makeDocument(fw,fh,baseName);const imported=makeLayer('Imported Frames',count,fw,fh);const sourceCanvas=document.createElement('canvas');sourceCanvas.width=image.width;sourceCanvas.height=image.height;const sourceCtx=sourceCanvas.getContext('2d',{willReadFrequently:true});sourceCtx.drawImage(image,0,0);const source=sourceCtx.getImageData(0,0,image.width,image.height);for(let i=0;i<count;i++){const x=margin+(i%cols)*(fw+spacing),y=margin+Math.floor(i/cols)*(fh+spacing);if(x+fw>image.width||y+fh>image.height)throw new Error(`Frame ${i+1} extends beyond the source image.`);for(let row=0;row<fh;row++){const from=((y+row)*image.width+x)*4;const to=row*fw*4;imported.frames[i].set(source.data.subarray(from,from+fw*4),to);}}doc.layers=[imported];doc.frameIndex=0;doc.frameIds=Array.from({length:count},()=>uniqueId());doc.frameDurations=Array.from({length:count},()=>null);doc.frameTags=[{name:'idle',frameIds:[...doc.frameIds],direction:'forward'}];doc.fps=8;doc.assetInfo={type:'character',animationName:'idle',pivot:{x:0.5,y:1}};activeLayer=0;history=[];future=[];selection=null;lastSavedPath='';setDirty(true);h.innerHTML='';render();fitCanvas();centerCanvas();toast(`Imported ${count} frames from sprite sheet.`);setStatus(`Sliced ${file.name} into ${count} frames.`);URL.revokeObjectURL(url);}catch(error){toast(error.message,'error');}}}
    ]);
    $('assetPivot');
    const update=()=>{const fw=Number($('sliceWidth').value),fh=Number($('sliceHeight').value),m=Number($('sliceMargin').value)||0,s=Number($('sliceSpacing').value)||0,reqCols=Number($('sliceColumns').value)||0,reqCount=Number($('sliceCount').value)||0;const maxCols=Math.floor((image.width-2*m+s)/(fw+s));const rows=Math.floor((image.height-2*m+s)/(fh+s));const cols=reqCols||maxCols;const count=reqCount||cols*rows;$('sliceSummary').textContent=`${Math.max(0,count)} frames · ${Math.max(0,cols)} columns × ${Math.max(0,Math.ceil(count/Math.max(1,cols)))} rows · ${fw} × ${fh} px each`;};
    ['sliceWidth','sliceHeight','sliceMargin','sliceSpacing','sliceColumns','sliceCount'].forEach(id=>$(id).addEventListener('input',update));update();
  }

  // Compact GIF89a encoder using a fixed 3-3-2 RGB palette and LZW compression.
  function encodeGif(frames,width,height,fps){
    const palette=new Uint8Array(768);
    for(let i=0;i<256;i++){const r=(i>>5)&7,g=(i>>2)&7,b=i&3;palette[i*3]=Math.round(r*255/7);palette[i*3+1]=Math.round(g*255/7);palette[i*3+2]=Math.round(b*255/3);}
    const out=[];const push=(...v)=>out.push(...v);const le=(n)=>[n&255,(n>>8)&255];
    push(...new TextEncoder().encode('GIF89a'),...le(width),...le(height),0xF7,0,0,...palette);
    for(const source of frames){
      const rgba=source.getContext('2d').getImageData(0,0,width,height).data;const indices=new Uint8Array(width*height);
      for(let p=0,j=0;p<rgba.length;p+=4,j++){
        if(rgba[p+3]<18){indices[j]=0;continue;}
        const q=((rgba[p]>>5)<<5)|((rgba[p+1]>>5)<<2)|(rgba[p+2]>>6);indices[j]=q;
      }
      const compressed=lzwEncode(indices,8);const delay=Math.max(2,Math.round(100/fps));
      push(0x21,0xF9,0x04,0x08,...le(delay),0,0,0x2C,0,0,0,0,...le(width),...le(height),0,8);
      for(let i=0;i<compressed.length;i+=255){const part=compressed.subarray(i,i+255);push(part.length,...part);}push(0);
    }
    push(0x3B);return new Uint8Array(out);
  }
  function lzwEncode(data,minSize){
    const clear=1<<minSize,end=clear+1;let codeSize=minSize+1,nextCode=end+1;
    let dict=new Map();for(let i=0;i<clear;i++)dict.set(String(i),i);
    const codes=[];const emit=(code)=>codes.push([code,codeSize]);
    emit(clear);let prefix=String(data[0]??0);
    for(let i=1;i<data.length;i++){
      const k=data[i],key=prefix+','+k;
      if(dict.has(key)){prefix=String(dict.get(key));}
      else{
        emit(Number(prefix));
        // The decoder adds the matching dictionary entry after consuming this
        // emitted code, so grow the encoder code width one output later.
        if(nextCode===(1<<codeSize)&&codeSize<12)codeSize++;
        if(nextCode<4096){dict.set(key,nextCode++);}
        else{emit(clear);dict=new Map();for(let j=0;j<clear;j++)dict.set(String(j),j);codeSize=minSize+1;nextCode=end+1;}
        prefix=String(k);
      }
    }
    emit(Number(prefix));emit(end);
    const bytes=[];let accumulator=0,bits=0;
    for(const [code,size] of codes){accumulator|=code<<bits;bits+=size;while(bits>=8){bytes.push(accumulator&255);accumulator>>>=8;bits-=8;}}
    if(bits>0)bytes.push(accumulator&255);return new Uint8Array(bytes);
  }
  async function exportGif(){
    if(transformState)commitSelectionTransform();
    try{const frames=[];for(let i=0;i<doc.layers[0].frames.length;i++)frames.push(compositeFrame(i,{background:'#FFFFFF'}));const bytes=encodeGif(frames,doc.width,doc.height,doc.fps);await saveImageBytes(bytes,`${doc.name}-animation.gif`,[{name:'GIF animation',extensions:['gif']}],'Export animated GIF');toast('Animated GIF export ready.');}
    catch(e){toast(`GIF export failed: ${e.message}`,'error');}
  }

  function showModal(title,body,actions=[]) {
    const host=$('modalHost');host.innerHTML='';const backdrop=document.createElement('div');backdrop.className='modal-backdrop';
    const modal=document.createElement('div');modal.className='modal';const header=document.createElement('div');header.className='modal-header';const h=document.createElement('h2');h.textContent=title;const close=document.createElement('button');close.className='modal-close';close.textContent='×';close.addEventListener('click',()=>host.innerHTML='');header.append(h,close);
    const content=document.createElement('div');content.className='modal-body';content.innerHTML=body;const footer=document.createElement('div');footer.className='modal-footer';
    for(const action of actions){const b=document.createElement('button');b.className=`modal-button ${action.primary?'primary':''} ${action.danger?'danger':''}`;b.textContent=action.label;b.addEventListener('click',()=>action.onClick(host));footer.appendChild(b);}
    modal.append(header,content,footer);backdrop.appendChild(modal);backdrop.addEventListener('click',e=>{if(e.target===backdrop)host.innerHTML='';});host.appendChild(backdrop);return host;
  }
  function newProjectDialog(){
    const host=showModal('Create a new sprite',`<p class="modal-actions-note">Choose a canvas size. You can resize your sprite later by starting a new project.</p><div class="field-grid"><div class="field"><label for="newWidth">WIDTH (PX)</label><input id="newWidth" type="number" min="8" max="512" value="32"></div><div class="field"><label for="newHeight">HEIGHT (PX)</label><input id="newHeight" type="number" min="8" max="512" value="32"></div></div><div class="field"><label for="newName">PROJECT NAME</label><input id="newName" type="text" maxlength="60" value="Untitled Sprite"></div><div class="field"><label for="newPreset">QUICK SIZE</label><select id="newPreset"><option value="32">32 × 32 · Tiny character</option><option value="16">16 × 16 · Icon</option><option value="64">64 × 64 · Character</option><option value="128">128 × 128 · Detailed sprite</option><option value="custom">Custom dimensions</option></select></div><div class="field-help">Transparent canvas · 3 starter layers · 1 animation frame</div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Create sprite',primary:true,onClick:h=>{const w=Number($('newWidth').value),he=Number($('newHeight').value),name=$('newName').value.trim()||'Untitled Sprite';if(!Number.isInteger(w)||!Number.isInteger(he)||w<8||he<8||w>512||he>512){toast('Canvas dimensions must be between 8 and 512 pixels.','error');return;}if(transformState)commitSelectionTransform();if(dirty&&!window.confirm('Start a new sprite and replace the current project? Save the current project first if you want to keep it.'))return;stopPlayback();doc=makeDocument(w,he,name);activeLayer=2;history=[];future=[];selection=null;lastSavedPath='';setDirty(true);h.innerHTML='';render();fitCanvas();centerCanvas();toast('New sprite created.');}}
    ]);
    $('newPreset').addEventListener('change',e=>{if(e.target.value!=='custom'){$('newWidth').value=e.target.value;$('newHeight').value=e.target.value;}});
  }
  function exportDialog(){
    if(transformState)commitSelectionTransform();
    showModal('Export your artwork',`<p class="modal-actions-note">Create production-ready game art files. PNG preserves transparency. Animation sheets include frame metadata; tilesets include a Tiled-compatible definition and import settings.</p><div class="export-choices"><button class="export-choice" id="exportPngChoice"><span class="export-icon">▧</span><span><b>PNG image</b><small>Current frame · Transparent background</small></span><span>↗</span></button><button class="export-choice" id="exportSheetChoice"><span class="export-icon">▦</span><span><b>Animation sheet + metadata</b><small>Configurable grid · PNG + JSON + guide</small></span><span>↗</span></button><button class="export-choice" id="exportTilesetChoice"><span class="export-icon">▤</span><span><b>Tileset + Tiled definition</b><small>Grid PNG · TSJ metadata + guide</small></span><span>↗</span></button><button class="export-choice" id="exportEngineChoice"><span class="export-icon">⚙</span><span><b>Game engine package</b><small>Godot, Unity, or GameMaker · PNG + metadata + helper</small></span><span>↗</span></button><button class="export-choice" id="exportGifChoice"><span class="export-icon">▶</span><span><b>Animated GIF</b><small>All frames · Current FPS</small></span><span>↗</span></button></div>`,[{label:'Done',primary:true,onClick:h=>h.innerHTML=''}]);
    $('exportPngChoice').addEventListener('click',async()=>{await exportPng();$('modalHost').innerHTML='';});
    $('exportSheetChoice').addEventListener('click',()=>{$('modalHost').innerHTML='';exportSpriteSheetDialog();});
    $('exportTilesetChoice').addEventListener('click',()=>{$('modalHost').innerHTML='';exportTilesetDialog();});
    $('exportGifChoice').addEventListener('click',async()=>{await exportGif();$('modalHost').innerHTML='';});
    $('exportEngineChoice').addEventListener('click',()=>{$('modalHost').innerHTML='';exportEngineDialog();});
  }
  function resizeCanvasDialog(){
    if(transformState)commitSelectionTransform();
    const host=showModal('Resize canvas',`<p class="modal-actions-note">Every layer and animation frame will stay editable. New space is transparent; pixels outside smaller dimensions will be cropped.</p><div class="field-grid"><div class="field"><label for="resizeWidth">WIDTH (PX)</label><input id="resizeWidth" type="number" min="8" max="512" value="${doc.width}"></div><div class="field"><label for="resizeHeight">HEIGHT (PX)</label><input id="resizeHeight" type="number" min="8" max="512" value="${doc.height}"></div></div><div class="field"><label for="resizeAnchor">ANCHOR</label><select id="resizeAnchor"><option value="center">Center</option><option value="top-left">Top left</option></select></div>`,[
      {label:'Cancel',onClick:h=>h.innerHTML=''},
      {label:'Resize canvas',primary:true,onClick:h=>{
        const w=Number($('resizeWidth').value),height=Number($('resizeHeight').value);
        if(!Number.isInteger(w)||!Number.isInteger(height)||w<8||height<8||w>512||height>512){toast('Canvas dimensions must be between 8 and 512 pixels.','error');return;}
        if(w===doc.width&&height===doc.height){h.innerHTML='';return;}
        const oldW=doc.width,oldH=doc.height,center=$('resizeAnchor').value==='center';
        const dx=center?Math.floor((w-oldW)/2):0,dy=center?Math.floor((height-oldH)/2):0;
        pushHistory();
        for(const layer of doc.layers){
          layer.frames=layer.frames.map(oldPixels=>{
            const next=blankPixels(w,height);
            for(let y=0;y<oldH;y++){
              const ny=y+dy;if(ny<0||ny>=height)continue;
              for(let x=0;x<oldW;x++){
                const nx=x+dx;if(nx<0||nx>=w)continue;
                const src=(y*oldW+x)*4,dst=(ny*w+nx)*4;
                next[dst]=oldPixels[src];next[dst+1]=oldPixels[src+1];next[dst+2]=oldPixels[src+2];next[dst+3]=oldPixels[src+3];
              }
            }
            return next;
          });
        }
        doc.width=w;doc.height=height;h.innerHTML='';render();fitCanvas();centerCanvas();toast(`Canvas resized to ${w} × ${height}.`);
      }}
    ]);
  }
  function helpDialog(){
    const pairs=[['Focus drawing mode','F / Esc'],['Select pixels','M · Drag a rectangle'],['Move selected pixels','Drag inside selection'],['Resize selection','Drag a handle · 8 when space allows'],['Apply / Cancel transform','Enter / Esc'],['Copy / Cut / Paste selection','Ctrl+C / X / V'],['Flip / rotate selection','Selection toolbar'],['Set frame duration','Timeline · Timing'],['Preview a named clip','Timeline · Clip menu'],['Add a palette color','Color bar · + Add color'],['Pencil','B'],['Eraser','E'],['Bucket fill','G'],['Eyedropper','I'],['Line','L'],['Rectangle','U'],['Ellipse','O'],['Selection','M'],['Hand / pan','H'],['Undo','Ctrl + Z'],['Redo','Ctrl + Y'],['Save project','Ctrl + S'],['Open project','Ctrl + O'],['New sprite','Ctrl + N'],['Zoom','Ctrl + Scroll'],['Pan canvas','Hold Space']];
    const body=`<p class="modal-actions-note">A few shortcuts make pixel work feel effortless. All drawing is non-destructive across layers and frames.</p><p class="modal-actions-note">Choose Onyx, Prism, Onyx with a light canvas, or Prism with a dark canvas. The interface and artboard themes are independent, and your choice is remembered.</p><p class="modal-actions-note">Tutorial cards fade out after 15 seconds. Use <b>Tips On / Tips Off</b> in the top bar to control whether they appear when the editor opens. Your preference is remembered.</p><div class="help-grid">${pairs.map(([label,key])=>`<div class="help-item"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`;
    showModal('Shortcuts & quick help',body,[{label:'Got it',primary:true,onClick:h=>h.innerHTML=''}]);
  }
  function menuItems(menu){
    const all={
      file:[['New sprite','Ctrl + N',newProjectDialog],['Open project','Ctrl + O',openProject],['Save project','Ctrl + S',saveProject],['sep'],['Exit with thank-you screen','Ctrl + Q',requestAppExit],['sep'],['Import PNG as sprite','',()=> $('importImageInput').click()],['Import sprite sheet & slice','',openSpriteSheetSlicer],['Export…','',exportDialog]],
      edit:[['Undo','Ctrl + Z',undo],['Redo','Ctrl + Y',redo],['sep'],['Copy selection','Ctrl + C',copySelection],['Cut selection','Ctrl + X',cutSelection],['Paste selection','Ctrl + V',pasteSelection],['Flip selection horizontally','',()=>transformSelection('flipH')],['Flip selection vertically','',()=>transformSelection('flipV')],['Rotate selection 90°','',()=>transformSelection('rotate')],['sep'],['Clear current cel','Delete',clearCel],['Deselect','Esc',()=>{selection=null;hoveredSelectionHandle=null;renderOverlay();}]],
      sprite:[['Canvas size','',resizeCanvasDialog],['Flip horizontal','',()=>flipCanvas(true)],['Flip vertical','',()=>flipCanvas(false)]],
      animation:[['Add frame','',addFrame],['Duplicate frame','',duplicateFrame],['Delete frame','',deleteFrame],['Frame tags / named clips…','',frameTagsDialog],['Play / stop','',()=>playing?stopPlayback():startPlayback()]],
      assets:[['Asset properties…','',assetPropertiesDialog],['Export animation sheet…','',exportSpriteSheetDialog],['Export tileset…','',exportTilesetDialog],['Import sprite sheet & slice…','',openSpriteSheetSlicer],['Export for game engine…','',exportEngineDialog],['sep'],['Export current frame as PNG','',exportPng]],
      view:[['Zoom in','+',()=>setZoom(zoom+1)],['Zoom out','−',()=>setZoom(zoom-1)],['Fit canvas to area','',fitCanvas],['Focus drawing mode','F',toggleFocusMode],['Toggle pixel grid','',()=>{showGrid=!showGrid;render();}],['Toggle onion skin','',()=>{showOnion=!showOnion;render();}],['sep'],['Onyx — dark interface / dark canvas','',()=>applyTheme('onyx')],['Prism — light interface / light canvas','',()=>applyTheme('prism')],['Onyx — light canvas','',()=>applyTheme('onyx-prism')],['Prism — dark canvas','',()=>applyTheme('prism-onyx')],['Tutorial tips: '+(tutorialTipsEnabled?'On':'Off'),'',toggleTutorialTips]]
    };return all[menu]||[];
  }
  function closeMenu(){if(menuElement){menuElement.remove();menuElement=null;}document.querySelectorAll('.menu-item').forEach(x=>x.classList.remove('active'));}
  document.querySelectorAll('.menu-item').forEach(button=>button.addEventListener('click',e=>{
    e.stopPropagation();const menu=button.dataset.menu;if(menuElement&&menuElement.dataset.menu===menu){closeMenu();return;}closeMenu();button.classList.add('active');
    const pop=document.createElement('div');pop.className='menu-popover';pop.dataset.menu=menu;const rect=button.getBoundingClientRect();pop.style.left=`${rect.left}px`;pop.style.top=`${rect.bottom+4}px`;
    for(const item of menuItems(menu)){if(item[0]==='sep'){const sep=document.createElement('div');sep.className='menu-sep';pop.appendChild(sep);continue;}const b=document.createElement('button');const label=document.createElement('span');label.textContent=item[0];b.appendChild(label);if(item[1]){const key=document.createElement('kbd');key.textContent=item[1];b.appendChild(key);}b.addEventListener('click',()=>{closeMenu();item[2]?.();});pop.appendChild(b);}
    document.body.appendChild(pop);menuElement=pop;
  }));
  document.addEventListener('click',closeMenu);

  $('newBtn').addEventListener('click',newProjectDialog);
  if(window.spriteDesktop?.onExitRequested)window.spriteDesktop.onExitRequested(beginExitSequence);$('openBtn').addEventListener('click',openProject);$('saveBtn').addEventListener('click',saveProject);$('exportBtn').addEventListener('click',exportDialog);$('helpBtn').addEventListener('click',helpDialog);$('tipsBtn').addEventListener('click',toggleTutorialTips);$('themeBtn').addEventListener('click',toggleTheme);applyTheme(activeTheme,false);
  $('projectName').addEventListener('change',e=>{doc.name=e.target.value.trim()||'Untitled Sprite';setDirty(true);});
  $('fallbackOpenInput').addEventListener('change',()=>{});
  $('importImageInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;if(transformState)commitSelectionTransform();if(dirty&&!window.confirm('Import this image as a new sprite and replace the current project? Save your current project first if you want to keep it.')){e.target.value='';return;}try{const image=new Image();image.src=URL.createObjectURL(file);await image.decode();if(image.width>512||image.height>512)throw new Error('Imported images must be 512 × 512 px or smaller.');doc=makeDocument(image.width,image.height,file.name.replace(/\.[^.]+$/,'')||'Imported Sprite');activeLayer=1;const canvas=document.createElement('canvas');canvas.width=doc.width;canvas.height=doc.height;canvas.getContext('2d').drawImage(image,0,0);const imageData=canvas.getContext('2d').getImageData(0,0,doc.width,doc.height);doc.layers[activeLayer].frames[0].set(imageData.data);history=[];future=[];selection=null;transformState=null;setDirty(true);render();fitCanvas();toast('PNG imported as a new sprite.');URL.revokeObjectURL(image.src);}catch(error){toast(error.message,'error');}e.target.value='';
  });
  $('importSheetInput').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';if(file)showSpriteSheetSliceDialog(file);});

  function clearCel(){if(transformState)commitSelectionTransform();pushHistory();currentPixels().fill(0);selection=null;render();setStatus('Current cel cleared.');}
  function flipCanvas(horizontal){if(transformState)commitSelectionTransform();pushHistory();const source=currentPixels(),copy=new Uint8ClampedArray(source);for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++){const sx=horizontal?doc.width-1-x:x,sy=horizontal?y:doc.height-1-y;const si=(sy*doc.width+sx)*4,di=(y*doc.width+x)*4;source.set(copy.subarray(si,si+4),di);}render();}
  function undo(){if(transformState){cancelSelectionTransform();return;}if(!history.length){toast('Nothing to undo.');return;}future.push(cloneDoc());doc=history.pop();activeLayer=Math.min(activeLayer,doc.layers.length-1);render();setDirty(true);setStatus('Undo');}
  function redo(){if(transformState)commitSelectionTransform();if(!future.length){toast('Nothing to redo.');return;}history.push(cloneDoc());doc=future.pop();activeLayer=Math.min(activeLayer,doc.layers.length-1);render();setDirty(true);setStatus('Redo');}
  function swapColors(){const temp=currentColor;setCurrentColor(backgroundColor);backgroundColor=temp;renderColorUI();}
  document.addEventListener('keydown',e=>{
    if(e.key==='F11' && window.spriteDesktop?.isDesktop){e.preventDefault();window.spriteDesktop.toggleFullscreen?.();return;}
    if(e.key==='Escape'){if(stroke?.tool==='select'){const wasTransform=Boolean(transformState);stroke=null;if(wasTransform)cancelSelectionTransform();else{selection=null;render();setStatus('Selection gesture cancelled.');}return;}if(transformState){cancelSelectionTransform();return;}if(focusMode && !$('modalHost').children.length){setFocusMode(false);return;}closeMenu();$('modalHost').innerHTML='';selection=null;hoveredSelectionHandle=null;renderOverlay();if(fitToAreaActive)requestAnimationFrame(fitCanvas);return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='q'){e.preventDefault();requestAppExit();return;}
    if(e.target.matches('input,textarea,select') && !e.ctrlKey && !e.metaKey)return;
    const key=e.key.toLowerCase();
    if(key==='enter'&&transformState){e.preventDefault();commitSelectionTransform();return;}
    if(e.ctrlKey||e.metaKey){if(key==='s'){e.preventDefault();saveProject();}else if(key==='c'){e.preventDefault();copySelection();}else if(key==='x'){e.preventDefault();cutSelection();}else if(key==='v'){e.preventDefault();pasteSelection();}else if(key==='o'){e.preventDefault();openProject();}else if(key==='n'){e.preventDefault();newProjectDialog();}else if(key==='z'){e.preventDefault();undo();}else if(key==='y'||(e.shiftKey&&key==='z')){e.preventDefault();redo();}return;}
    if(key===' '){if(!e.repeat){spaceDown=true;overlayCanvas.style.cursor='grab';}e.preventDefault();return;}
    if(key==='x'){swapColors();return;}
    if(key==='delete'||key==='backspace'){if(transformState)commitSelectionTransform();if(selection){pushHistory();clearSelectionPixels();render();setStatus('Selected pixels cleared.');}return;}
    if(key==='f' && !$('modalHost').children.length){toggleFocusMode();return;}
    const tool=Object.keys(toolKeys).find(name=>toolKeys[name]===key);if(tool)setTool(tool);
    if(key==='[') $('brushSize').value=String(Math.max(1,brushSize-1));if(key===']') $('brushSize').value=String(Math.min(16,brushSize+1));if(key==='['||key===']'){$('brushSize').dispatchEvent(new Event('input'));}
  });
  document.addEventListener('keyup',e=>{if(e.key===' '){spaceDown=false;overlayCanvas.style.cursor=activeTool==='hand'?'grab':'crosshair';}});
  window.addEventListener('blur',()=>{spaceDown=false;if(stroke){stroke=null;render();}});

  function restoreAutosave(){
    try{const saved=localStorage.getItem('spritecreator-autosave');if(saved){doc=parseProject(saved);activeLayer=doc.layers.length-1;setStatus('Recovered your most recent local autosave.');toast('Your last session was restored.');return true;}}catch(error){console.warn('Could not restore autosave:',error);}
    return false;
  }
  function configuredSocials(){
    const source=window.SPRITE_CREATOR_BRAND_CONFIG;
    const socials=Array.isArray(source?.socials)?source.socials:[];
    return socials.map(item=>({name:String(item?.name||'Social').trim().slice(0,24),handle:String(item?.handle||'').trim().slice(0,48),url:String(item?.url||'').trim()}))
      .filter(item=>item.name&&/^https:\/\//i.test(item.url));
  }
  function populateSocialLinks(host){
    if(!host)return;
    host.innerHTML='';
    const socials=configuredSocials();
    if(!socials.length){
      const placeholder=document.createElement('div');placeholder.className='social-coming-soon';
      placeholder.innerHTML='<span class="social-coming-dot"></span><b>SOCIAL LINKS COMING SOON</b><small>Our official channels will be added here.</small>';
      host.appendChild(placeholder);return;
    }
    for(const social of socials){
      const link=document.createElement('a');link.className='exit-social-link';link.href=social.url;link.target='_blank';link.rel='noopener noreferrer';
      const name=document.createElement('b');name.textContent=social.name;
      const handle=document.createElement('span');handle.textContent=social.handle||'Visit profile';
      link.append(name,handle);
      link.addEventListener('click',event=>{
        event.preventDefault();
        if(window.spriteDesktop?.openExternal)window.spriteDesktop.openExternal(social.url);
        else window.open(social.url,'_blank','noopener,noreferrer');
      });
      host.appendChild(link);
    }
  }
  function showEditorFromSplash(){
    const splash=$('splash'),app=$('app');
    if(!splash||splash.classList.contains('leaving'))return;
    clearTimeout(introPullbackTimer);clearTimeout(introWelcomeTimer);
    splash.classList.add('entering-studio');
    setTimeout(()=>{
      splash.classList.add('leaving');
      setTimeout(()=>{
        splash.remove();
        app.classList.remove('hidden');
        render();
        // Wait two paint frames so maximized Electron / app-mode browser
        // dimensions and all flex/grid panels have settled before fitting.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          editorIsReady = true;
          if (!fitCanvas()) scheduleCanvasLayout();
          setTutorialTipsEnabled(tutorialTipsEnabled, false);
        }));
      },650);
    },100);
  }
  let introPullbackTimer=null;
  let introWelcomeTimer=null;
  function revealWelcomeCard(){
    const splash=$('splash');if(!splash||splash.classList.contains('show-welcome'))return;
    clearTimeout(introPullbackTimer);clearTimeout(introWelcomeTimer);
    splash.classList.add('phase-build','phase-pullback','show-welcome');
    $('introStatus').textContent='READY WHEN YOU ARE';
    $('skipIntroBtn').textContent='Continue to studio';
    $('enterStudioBtn').focus({preventScroll:true});
  }
  function startSplash(){
    const splash=$('splash');
    const reduceMotion=Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    $('skipIntroBtn').addEventListener('click',()=>{if(splash.classList.contains('show-welcome'))showEditorFromSplash();else revealWelcomeCard();});
    $('enterStudioBtn').addEventListener('click',showEditorFromSplash);
    document.addEventListener('keydown',function splashKeys(e){
      if(!$('splash')){document.removeEventListener('keydown',splashKeys);return;}
      if(e.key==='Enter'&&!e.repeat){e.preventDefault();if($('splash').classList.contains('show-welcome'))showEditorFromSplash();else revealWelcomeCard();}
      if(e.key==='Escape'&&!$('splash').classList.contains('show-welcome'))revealWelcomeCard();
    });
    if(reduceMotion){revealWelcomeCard();return;}
    setTimeout(()=>splash?.classList.add('phase-build'),800);
    introPullbackTimer=setTimeout(()=>{splash?.classList.add('phase-pullback');$('introStatus').textContent='MADE FOR PIXEL ARTISTS & GAME MAKERS';},5300);
    introWelcomeTimer=setTimeout(revealWelcomeCard,7900);
  }
  function persistAutosaveForExit(){
    try{
      if(transformState)commitSelectionTransform();
      const data=serializeProject();
      if(data.length<4_500_000){localStorage.setItem('spritecreator-autosave',data);localStorage.setItem('spritecreator-autosave-name',doc.name);}
    }catch(error){console.warn('Could not write final autosave:',error);}
  }
  function completeExit(){
    clearTimeout(exitSequenceTimer);
    if(window.spriteDesktop?.isDesktop&&window.spriteDesktop.completeExit){window.spriteDesktop.completeExit();return;}
    const status=$('exitStatus');if(status)status.textContent='YOU CAN CLOSE THIS WINDOW NOW';
    $('exitNowBtn')?.classList.add('hidden');
  }
  function beginExitSequence(){
    if(exitSequenceActive)return;
    exitSequenceActive=true;
    clearTimeout(autosaveTimer);clearTimeout(tutorialTipsTimer);
    try{if(playing)stopPlayback();}catch{}
    try{closeMenu();}catch{}
    persistAutosaveForExit();
    $('modalHost').innerHTML='';
    $('app').classList.add('hidden');
    populateSocialLinks($('exitSocials'));
    const screen=$('exitScreen');screen.classList.remove('hidden');
    requestAnimationFrame(()=>screen.classList.add('is-visible'));
    const isDesktop=Boolean(window.spriteDesktop?.isDesktop);
    $('exitStatus').textContent=isDesktop?'CLOSING YOUR CREATIVE SPACE…':'THANKS FOR BEING PART OF THE JOURNEY';
    $('exitNowBtn').classList.toggle('hidden',!isDesktop);
    if(isDesktop){
      $('exitNowBtn').addEventListener('click',completeExit,{once:true});
      exitSequenceTimer=setTimeout(completeExit,7200);
    }else{
      $('exitNowBtn').classList.add('hidden');
      setTimeout(()=>{$('exitStatus').textContent='YOU CAN CLOSE THIS WINDOW WHEN YOU ARE READY';},6200);
    }
  }
  function requestAppExit(){
    if(exitSequenceActive)return;
    if(window.spriteDesktop?.isDesktop&&window.spriteDesktop.requestClose){window.spriteDesktop.requestClose();return;}
    beginExitSequence();
  }

  // Initial document and boot.
  setTutorialTipsEnabled(tutorialTipsEnabled, false);
  doc=makeDocument(32,32,'Untitled Sprite');
  if(!restoreAutosave())markClean();
  $('brushSizeValue').textContent='1 px';
  startSplash();

  // Expose a small test hook for diagnostics without exposing Node capabilities.
  window.spriteCreatorDiagnostics={getDocumentSummary:()=>({width:doc.width,height:doc.height,layers:doc.layers.length,frames:doc.layers[0].frames.length,tool:activeTool,palette:doc.palette.length,focusMode,zoom,fitToAreaActive,assetInfo:assetInfo()}),getAnimationSheetLayout:(columns,spacing,padding)=>calculateSheetLayout(columns,spacing,padding),getTilesetMetrics:(tileWidth,tileHeight,margin,spacing)=>tilesetMetrics(tileWidth,tileHeight,margin,spacing),buildAnimationSheetBundle:options=>buildAnimationSheetBundle(options),buildTilesetBundle:options=>buildTilesetBundle(options),getSerializedProject:()=>serializeProject(),parseProjectData:data=>parseProject(data),getFrameTags:()=>JSON.parse(JSON.stringify(doc.frameTags)),getFrameDurations:()=>[...doc.frameDurations],buildEngineBundle:engine=>buildEngineBundle(engine),buildGameMakerBundle:()=>buildGameMakerBundle(),makeZip:files=>zipStore(files),reorderFrameByIndex:(from,to)=>reorderFrame(from,to)};
})();
