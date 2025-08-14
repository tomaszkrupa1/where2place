// App.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

/**
 * Pixel Planner – r/place / wplace helper
 * - Drag & drop or file picker for input image
 * - Live pixelation with slider
 * - Hardcoded color palette (replace PALETTE with your set)
 * - Hover crosshair + pixel border highlight + coordinate readout
 * - Genesis (origin) X/Y inputs to align coordinates
 * - Zoom control + Download PNG
 *
 * Works in a fresh Create React App with no extra dependencies.
 */

// ----------------- Utilities -----------------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex({ r, g, b }) {
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(clamp(Math.round(r), 0, 255))}${toHex(clamp(Math.round(g), 0, 255))}${toHex(clamp(Math.round(b), 0, 255))}`.toUpperCase();
}

// sRGB → linear
function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
// RGB → XYZ (D65)
function rgbToXyz({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  return {
    x: 0.4124564 * R + 0.3575761 * G + 0.1804375 * B,
    y: 0.2126729 * R + 0.7151522 * G + 0.0721750 * B,
    z: 0.0193339 * R + 0.1191920 * G + 0.9503041 * B,
  };
}
// XYZ → Lab (D65)
function xyzToLab({ x, y, z }) {
  const xr = x / 0.95047, yr = y / 1.0, zr = z / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(xr), fy = f(yr), fz = f(zr);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function rgbToLab(rgb) { return xyzToLab(rgbToXyz(rgb)); }
function labDistance(l1, l2) {
  const dL = l1.L - l2.L, da = l1.a - l2.a, db = l1.b - l2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}
function rgbDistance(c1, c2) {
  const dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ----------------- Fixed Palette -----------------
// Replace this with your exact palette (hex codes). Keep them uppercase & 6-digit.
const PALETTE = [
  // Common r/place-like sample palette; replace as needed with your provided colours:
  "#000000","#1A1A1A","#545454","#6D6D6D","#898989","#BFBFBF","#FFFFFF",
  "#6D001A","#BE0039","#FF4500","#FFA800","#FFD635","#FFF8B8",
  "#00A368","#00CC78","#7EED56","#00756F","#009EAA","#00CCC0",
  "#2450A4","#3690EA","#51E9F4","#493AC1","#6A5CFF","#94B3FF",
  "#811E9F","#B44AC0","#E4ABFF","#DE107F","#FF99AA",
  "#6D482F","#9C6926","#FFB470"
];

export default function App() {
  // State
  const [img, setImg] = useState(null);         // HTMLImageElement
  const [pixelsAcross, setPixelsAcross] = useState(100);
  const [zoom, setZoom] = useState(8);          // px-per-pixel on screen
  const [genesisX, setGenesisX] = useState(0);
  const [genesisY, setGenesisY] = useState(0);
  const [gridW, setGridW] = useState(0);
  const [gridH, setGridH] = useState(0);
  const [gridColors, setGridColors] = useState([]); // flat array of hex strings
  const [hover, setHover] = useState({ x: -1, y: -1 });

  // Refs
  const baseCanvasRef = useRef(null);
  const overlayRef = useRef(null);

  // Precompute palette in RGB & Lab
  const paletteRGB = useMemo(() => PALETTE.map(hexToRgb), []);
  const paletteLab = useMemo(() => paletteRGB.map(rgbToLab), [paletteRGB]);

  // Nearest palette color (Lab for perceptual accuracy)
  const pickNearest = useCallback((rgb) => {
    let best = Infinity, idx = 0;
    const lab = rgbToLab(rgb);
    for (let i = 0; i < paletteLab.length; i++) {
      const d = labDistance(lab, paletteLab[i]);
      if (d < best) { best = d; idx = i; }
    }
    return PALETTE[idx];
  }, [paletteLab]);

  // Handle file -> HTMLImageElement
  const loadImageFromFile = useCallback((file) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = url;
  }, []);

  // Drag & Drop
  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadImageFromFile(e.dataTransfer.files[0]);
    }
  };
  const onDragOver = (e) => e.preventDefault();

  // Compute pixelated grid whenever image or resolution changes
  const processImage = useCallback(() => {
    if (!img) return;
    const aspect = img.naturalWidth / img.naturalHeight;
    const W = Math.max(1, Math.round(pixelsAcross));
    const H = Math.max(1, Math.round(W / aspect));
    setGridW(W); setGridH(H);

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.imageSmoothingEnabled = false;
    octx.drawImage(img, 0, 0, W, H);

    const imgData = octx.getImageData(0, 0, W, H).data;
    const colors = new Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
        colors[y * W + x] = pickNearest({ r, g, b });
      }
    }
    setGridColors(colors);
  }, [img, pixelsAcross, pickNearest]);

  useEffect(() => { processImage(); }, [processImage]);

  // Draw main canvas when grid updates
  useEffect(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !gridW || !gridH) return;
    canvas.width = gridW;
    canvas.height = gridH;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(gridW, gridH);
    const buf = imgData.data;
    for (let i = 0; i < gridW * gridH; i++) {
      const { r, g, b } = hexToRgb(gridColors[i] || "#000000");
      const j = i * 4;
      buf[j] = r; buf[j + 1] = g; buf[j + 2] = b; buf[j + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }, [gridW, gridH, gridColors]);

  // Draw overlay (neon crosshair + pixel border + frame)
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.width = gridW * zoom;
    overlay.height = gridH * zoom;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Outer border
    if (gridW && gridH) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, overlay.width - 1, overlay.height - 1);
    }

    // Hover crosshair + cell outline
    if (hover.x >= 0 && hover.y >= 0) {
      ctx.strokeStyle = "#39FF14"; // neon green crosshair
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((hover.x + 0.5) * zoom, 0);
      ctx.lineTo((hover.x + 0.5) * zoom, overlay.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (hover.y + 0.5) * zoom);
      ctx.lineTo(overlay.width, (hover.y + 0.5) * zoom);
      ctx.stroke();

      ctx.strokeStyle = "#00FFF7"; // cyan pixel border
      ctx.strokeRect(hover.x * zoom + 0.5, hover.y * zoom + 0.5, zoom - 1, zoom - 1);
    }
  }, [hover, gridW, gridH, zoom]);

  // Mouse -> hovered cell
  const onMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = Math.floor((e.clientY - rect.top) / zoom);
    if (x >= 0 && y >= 0 && x < gridW && y < gridH) setHover({ x, y });
    else setHover({ x: -1, y: -1 });
  };
  const onMouseLeave = () => setHover({ x: -1, y: -1 });

  // Download PNG of pixelated output (at 1:1 pixel size)
  const downloadPng = () => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "pixel-planner.png";
    a.click();
  };

  // ------------- UI -------------
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      style={{
        minHeight: "100vh",
        background: "#0B0B0B",
        color: "#EAEAEA",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        padding: 16
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Pixel Planner</h1>
          <button
            onClick={downloadPng}
            style={{ background: "#1f1f1f", border: "1px solid #2a2a2a", padding: "8px 12px", borderRadius: 10, color: "#EAEAEA", cursor: "pointer" }}
            title="Download pixelated PNG"
          >
            Download PNG
          </button>
        </header>

        {/* Controls */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginBottom: 16
          }}
        >
          {/* Upload */}
          <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Source Image</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => { if (e.target.files?.[0]) loadImageFromFile(e.target.files[0]); }}
            />
            <div
              style={{
                marginTop: 10, padding: 12, border: "1px dashed #2f2f2f", borderRadius: 12,
                color: "#A8A8A8", textAlign: "center", userSelect: "none"
              }}
            >
              Drag & Drop an image anywhere on this page
            </div>
          </div>

          {/* Pixelation + Zoom */}
          <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Display & Pixelation</div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              Pixels across: <span style={{ fontFamily: "monospace" }}>{pixelsAcross}</span>
            </div>
            <input
              type="range"
              min={5}
              max={400}
              value={pixelsAcross}
              onChange={(e) => setPixelsAcross(parseInt(e.target.value, 10))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 13, marginTop: 12, marginBottom: 6 }}>
              Zoom: <span style={{ fontFamily: "monospace" }}>{zoom}x</span>
            </div>
            <input
              type="range"
              min={4}
              max={28}
              value={zoom}
              onChange={(e) => setZoom(parseInt(e.target.value, 10))}
              style={{ width: "100%" }}
            />
          </div>

          {/* Genesis coordinates */}
          <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Genesis Coordinates</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 13 }}>
                X
                <input
                  type="number"
                  value={genesisX}
                  onChange={(e) => setGenesisX(parseInt(e.target.value || "0", 10))}
                  style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#EAEAEA", borderRadius: 10, padding: "6px 8px", marginTop: 6 }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Y
                <input
                  type="number"
                  value={genesisY}
                  onChange={(e) => setGenesisY(parseInt(e.target.value || "0", 10))}
                  style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#EAEAEA", borderRadius: 10, padding: "6px 8px", marginTop: 6 }}
                />
              </label>
            </div>
            {hover.x >= 0 && (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                Hovered: <span style={{ fontFamily: "monospace" }}>({genesisX + hover.x}, {genesisY + hover.y})</span>
                {gridW && gridH && hover.y * gridW + hover.x >= 0 && (
                  <span style={{ marginLeft: 8, fontFamily: "monospace" }}>
                    {gridColors[hover.y * gridW + hover.x]}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stage */}
        <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12, overflow: "auto" }}>
          {!img && (
            <div style={{ padding: 24, color: "#A8A8A8", textAlign: "center" }}>
              Upload or drop an image to begin.
            </div>
          )}

          {img && (
            <div
              className="stage"
              style={{ position: "relative", width: gridW * zoom, height: gridH * zoom }}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
            >
              {/* Base canvas rendered at 1:1 and scaled with CSS for crisp pixels */}
              <canvas
                ref={baseCanvasRef}
                style={{
                  imageRendering: "pixelated",
                  width: gridW * zoom,
                  height: gridH * zoom
                }}
              />
              {/* Overlay for crosshair & border */}
              <canvas
                ref={overlayRef}
                style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
              />
              {/* Size label */}
              <div style={{ position: "absolute", top: -24, left: 0, fontSize: 12, opacity: 0.7, fontFamily: "monospace" }}>
                W {gridW} × H {gridH} px
              </div>
            </div>
          )}
        </div>

        <footer style={{ color: "#A8A8A8", fontSize: 12, marginTop: 12 }}>
          Tip: hover to see neon crosshairs and per-pixel coordinates (adjusted by your genesis offset).
        </footer>
      </div>
    </div>
  );
}
