import { useEffect, useRef, useState } from 'react';

// Square output the server stores/serves as the user's avatar.
const OUTPUT_SIZE = 256;
// Size (in CSS px) of the crop window shown on screen.
const VIEW_SIZE = 260;

// A minimal drag-to-position + slider-to-zoom avatar cropper. Renders the
// picked file into a fixed circular crop window; the user can drag the
// photo around and zoom in/out, then "Save" rasterizes exactly what's
// inside the circle to a 256x256 PNG blob via canvas.
export default function AvatarCropper({ file, onCancel, onConfirm }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = naturalSize.w && naturalSize.h
    ? Math.max(VIEW_SIZE / naturalSize.w, VIEW_SIZE / naturalSize.h)
    : 1;
  const scale = baseScale * zoom;
  const dispW = naturalSize.w * scale;
  const dispH = naturalSize.h * scale;

  function clampOffset(x, y, w, h) {
    const maxX = Math.max(0, (w - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (h - VIEW_SIZE) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }

  function handleImgLoad(e) {
    setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  }

  function startDrag(clientX, clientY) {
    dragRef.current = { startX: clientX, startY: clientY, offset };
  }
  function moveDrag(clientX, clientY) {
    if (!dragRef.current) return;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    setOffset(clampOffset(dragRef.current.offset.x + dx, dragRef.current.offset.y + dy, dispW, dispH));
  }
  function endDrag() {
    dragRef.current = null;
  }

  function handleZoomChange(e) {
    const z = Number(e.target.value);
    setZoom(z);
    const newScale = baseScale * z;
    setOffset((prev) => clampOffset(prev.x, prev.y, naturalSize.w * newScale, naturalSize.h * newScale));
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');

    const viewLeftDisp = (dispW - VIEW_SIZE) / 2 - offset.x;
    const viewTopDisp = (dispH - VIEW_SIZE) / 2 - offset.y;
    const sx = viewLeftDisp / scale;
    const sy = viewTopDisp / scale;
    const sSize = VIEW_SIZE / scale;

    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, 'image/png', 0.92);
  }

  return (
    <div className="avatar-cropper-backdrop" onClick={onCancel}>
      <div className="avatar-cropper" onClick={(e) => e.stopPropagation()}>
        <h2>Position your photo</h2>

        <div
          className="avatar-cropper-view"
          onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
          onMouseMove={(e) => { if (dragRef.current) moveDrag(e.clientX, e.clientY); }}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={endDrag}
        >
          {imgUrl && (
            <img
              ref={imgRef}
              src={imgUrl}
              alt="crop preview"
              onLoad={handleImgLoad}
              draggable={false}
              className="avatar-cropper-img"
              style={{
                width: dispW || 'auto',
                height: dispH || 'auto',
                marginLeft: dispW ? -dispW / 2 : 0,
                marginTop: dispH ? -dispH / 2 : 0,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <div className="avatar-cropper-mask" />
        </div>

        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          onChange={handleZoomChange}
          className="avatar-cropper-zoom"
          title="Zoom"
        />

        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={handleConfirm}>Save</button>
        </div>
      </div>
    </div>
  );
}
