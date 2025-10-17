// App.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import W2PLogo from "./W2P_Logo.png";
import Mascot1 from "./W2P_MAS.png";
import Mascot2 from "./W2P_MAS2.png";

/**
 * Pixel Planner – r/place / wplace helper
 * - Drag & drop or file picker for input image
 * - Live pixelation with slider
 * - Hardcoded color palette (replace PALETTE with your set)
 * - Hover crosshair + pixel border highlight + coordinate readout
 * - Starting (origin) X/Y inputs to align coordinates
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

// Base set used by the "Base set" button - colors from the BASESETCOLOURS.png
const BASE_SET = [
  "#000000", "#1D2951", "#898989", "#D4D7D9", "#FFFFFF", "#6D001A", "#BE0039", "#FF4500", "#FFA800", "#FFD635", "#FFF8B8",
  "#7030A0", "#9C44C0", "#E4ABFF", "#DE107F", "#FF99AA", "#6D482F", "#9C6926", "#FFAB70",
  "#00A368", "#00CC78", "#7EED56", "#00756F", "#009EAA", "#00CCC0", "#51E9F4", "#2450A4", "#3690EA"
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
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lockPixelation, setLockPixelation] = useState(false);
  const [lockGenesis, setLockGenesis] = useState(false);
  // New: share/import code
  const [shareCode, setShareCode] = useState("");
  // New: mouse position in stage pixels for tooltip placement
  const [mousePx, setMousePx] = useState({ x: 0, y: 0 });
  // New: Intro modal visibility
  const [showIntro, setShowIntro] = useState(true);
  const [introStep, setIntroStep] = useState(1);
  // Palette controls - default to only base set enabled
  const [paletteEnabled, setPaletteEnabled] = useState(() => PALETTE.map(hex => BASE_SET.includes(hex)));
  const [lockPalette, setLockPalette] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Refs
  const baseCanvasRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputRef = useRef(null);

  // Precompute palette in RGB & Lab
  const paletteRGB = useMemo(() => PALETTE.map(hexToRgb), []);
  const paletteLab = useMemo(() => paletteRGB.map(rgbToLab), [paletteRGB]);
  const enabledIndices = useMemo(() => {
    const arr = [];
    for (let i = 0; i < paletteEnabled.length; i++) if (paletteEnabled[i]) arr.push(i);
    return arr;
  }, [paletteEnabled]);

  // Nearest palette color (Lab for perceptual accuracy), honoring enabled colours
  const pickNearest = useCallback((rgb) => {
    let best = Infinity, idx = 0;
    const lab = rgbToLab(rgb);
    const pool = enabledIndices.length ? enabledIndices : [...PALETTE.keys()];
    for (let k = 0; k < pool.length; k++) {
      const i = pool[k];
      const d = labDistance(lab, paletteLab[i]);
      if (d < best) { best = d; idx = i; }
    }
    return PALETTE[idx];
  }, [paletteLab, enabledIndices]);
  // Handle file -> HTMLImageElement
  const loadImageFromFile = useCallback((file) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => setImg(image);
  image.src = url;
  }, []);
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

    const data = octx.getImageData(0, 0, W, H).data;
    const colors = new Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
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
      ctx.strokeStyle = "#FF2EC4"; // neon pink crosshair
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
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setDragOffset({ x: dragOffset.x + deltaX, y: dragOffset.y + deltaY });
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const x = Math.floor(pxX / zoom);
    const y = Math.floor(pxY / zoom);
    setMousePx({ x: pxX, y: pxY });
    if (x >= 0 && y >= 0 && x < gridW && y < gridH) setHover({ x, y });
    else setHover({ x: -1, y: -1 });
  };
  const onMouseLeave = () => { setHover({ x: -1, y: -1 }); setMousePx({ x: 0, y: 0 }); };

  // Drag handlers
  const onMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    e.preventDefault();
  };

  const onMouseUp = () => {
    setIsDragging(false);
  };

  const onMouseUpGlobal = () => {
    setIsDragging(false);
  };

  // Zoom handlers
  const zoomIn = () => setZoom(prev => Math.min(64, prev + 1));
  const zoomOut = () => setZoom(prev => Math.max(1, prev - 1));

  // Share/Import handlers
  const exportSettings = useCallback(() => {
    const payload = {
      v: 1,
      pixelsAcross,
      genesisX,
      genesisY,
      zoom
    };
    try {
      const json = JSON.stringify(payload);
      const code = btoa(unescape(encodeURIComponent(json)));
      setShareCode(code);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).catch(() => {});
      }
    } catch (e) {
      // no-op
    }
  }, [pixelsAcross, genesisX, genesisY, zoom]);

  const applySettings = useCallback(() => {
    const code = (shareCode || "").trim();
    if (!code) return;
    try {
      const json = decodeURIComponent(escape(atob(code)));
      const data = JSON.parse(json);
      if (!data || typeof data !== "object") throw new Error("bad");
      if (data.v !== 1) throw new Error("version");
      if (typeof data.pixelsAcross === "number") setPixelsAcross(clamp(Math.round(data.pixelsAcross), 5, 400));
      if (typeof data.genesisX === "number") setGenesisX(Math.round(data.genesisX));
      if (typeof data.genesisY === "number") setGenesisY(Math.round(data.genesisY));
      if (typeof data.zoom === "number") setZoom(clamp(Math.round(data.zoom), 1, 64));
    } catch (e) {
      alert("Invalid or unsupported code");
    }
  }, [shareCode]);

  // Ensure dragging stops even if mouseup occurs outside the stage
  useEffect(() => {
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, []);

  // Close intro with Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setShowIntro(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Persist settings (including palette) to localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('w2p_settings') || 'null');
      if (saved && typeof saved === 'object') {
        if (typeof saved.pixelsAcross === 'number') setPixelsAcross(clamp(Math.round(saved.pixelsAcross), 5, 400));
        if (typeof saved.genesisX === 'number') setGenesisX(Math.round(saved.genesisX));
        if (typeof saved.genesisY === 'number') setGenesisY(Math.round(saved.genesisY));
        if (typeof saved.zoom === 'number') setZoom(clamp(Math.round(saved.zoom), 1, 64));
        if (Array.isArray(saved.paletteEnabled) && saved.paletteEnabled.length === PALETTE.length) setPaletteEnabled(saved.paletteEnabled.map(Boolean));
        if (typeof saved.lockPalette === 'boolean') setLockPalette(saved.lockPalette);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const toSave = {
        pixelsAcross,
        genesisX,
        genesisY,
        zoom,
        paletteEnabled,
        lockPalette,
      };
      localStorage.setItem('w2p_settings', JSON.stringify(toSave));
    } catch {}
  }, [pixelsAcross, genesisX, genesisY, zoom, paletteEnabled, lockPalette]);

  // Download PNG of pixelated output (at 1:1 pixel size)
  const downloadPng = () => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "pixel-planner.png";
    a.click();
  };

  // Helpers for palette UI
  const toggleColour = (idx) => {
    if (lockPalette) return;
    setPaletteEnabled((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };
  const applyBaseSet = () => {
    if (lockPalette) return;
    setPaletteEnabled(PALETTE.map(hex => BASE_SET.includes(hex)));
  };
  const enableFullSet = () => {
    if (lockPalette) return;
    setPaletteEnabled(Array(PALETTE.length).fill(true));
  };

  // ------------- UI -------------
  return (
    <div
      // removed global drag/drop to make the upload card the drop target
      style={{
        minHeight: "100vh",
        background: "#0B0B0B",
        color: "#EAEAEA",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        padding: "8px"
      }}
    >
      <style>
        {`
          /* Ensure width includes padding and border to prevent inputs from overflowing */
          *, *::before, *::after { box-sizing: border-box; }

          input[type="text"]::-webkit-outer-spin-button,
          input[type="text"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          
          @media (max-width: 768px) {
            .controls-grid {
              grid-template-columns: 1fr !important;
              gap: 8px !important;
            }
            .palette-grid {
              grid-template-columns: repeat(8, 1fr) !important;
            }
            .share-buttons {
              grid-template-columns: 1fr !important;
            }
            .genesis-inputs {
              grid-template-columns: 1fr !important;
            }
          }
          
          @media (max-width: 480px) {
            .palette-grid {
              grid-template-columns: repeat(6, 1fr) !important;
            }
          }
        `}
      </style>

      {/* Intro Modal */}
      {showIntro && (
        <div
          onClick={() => setShowIntro(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', zIndex: 1000 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(720px, 94vw)',
              background: '#141414',
              border: '1px solid #2a2a2a',
              borderRadius: 14,
              padding: 16,
              boxShadow: '0 12px 36px rgba(0,0,0,0.55)'
            }}
          >
            <div style={{ height: 8 }} />
            {introStep === 1 ? (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                    alignItems: 'center'
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      background: '#181818',
                      color: '#EAEAEA',
                      fontSize: 14,
                      lineHeight: 1.6,
                      padding: '16px 18px',
                      border: '4px solid #EAEAEA',
                      boxShadow: '8px 8px 0 #000',
                      borderRadius: 0
                    }}
                  >
                    WHERE2PLACE helps you plan pixel art for r/place-like canvases. Upload an image, set pixel size,
                    align starting coordinates, and preview a palette-matched, pixel-perfect version before placing a single pixel.
                    <div style={{ marginTop: 8, color: '#FFFFFF', opacity: 0.9, fontSize: 13 }}>
                      Meet your guide: our mascot will pop up with helpful tips along the way.
                    </div>
                    {/* right pixel tail (8-bit) */}
                    <div
                      aria-hidden
                      style={{ position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24 }}
                    >
                      <div style={{ position: 'absolute', width: 8, height: 8, background: '#181818', boxShadow: '0 0 0 4px #EAEAEA, 8px 8px 0 #000', left: 0, top: -8 }} />
                      <div style={{ position: 'absolute', width: 8, height: 8, background: '#181818', boxShadow: '0 0 0 4px #EAEAEA, 8px 8px 0 #000', left: 8, top: 0 }} />
                      <div style={{ position: 'absolute', width: 8, height: 8, background: '#181818', boxShadow: '0 0 0 4px #EAEAEA, 8px 8px 0 #000', left: 16, top: 8 }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'clamp(160px, 22vw, 260px)' }}>
                    <img
                      src={Mascot1}
                      alt="WHERE2PLACE mascot"
                      style={{ height: '100%', width: 'auto', display: 'block', margin: '0 auto', maxWidth: '100%' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => setShowIntro(false)}
                    style={{ background: '#1f1f1f', border: '1px solid #2a2a2a', borderRadius: 10, color: '#EAEAEA', padding: '8px 12px', cursor: 'pointer' }}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => setIntroStep(2)}
                    style={{ background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 10, color: '#FFFFFF', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                    alignItems: 'center'
                  }}
                >
                  <div style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'clamp(160px, 22vw, 260px)' }}>
                    <img
                      src={Mascot2}
                      alt="WHERE2PLACE mascot explaining features"
                      style={{ height: '100%', width: 'auto', display: 'block', margin: '0 auto', maxWidth: '100%' }}
                    />
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      background: '#181818',
                      color: '#EAEAEA',
                      fontSize: 14,
                      lineHeight: 1.6,
                      padding: '16px 18px',
                      border: '4px solid #EAEAEA',
                      boxShadow: '8px 8px 0 #000',
                      borderRadius: 0
                    }}
                  >
                    <ul style={{ margin: 0, padding: 0, paddingLeft: 18 }}>
                      <li>Upload or drop an image into the Source Image card.</li>
                      <li>Drag to pan, use +/− to zoom, and hover to see coordinates and colour.</li>
                      <li>Adjust Pixels Across and Starting X/Y to align to your target canvas.</li>
                      <li>Choose your colour set: enable the Base set or the full palette for conversion.</li>
                      <li>Share/Import settings with a compact code to revisit your setup later.</li>
                    </ul>
                    {/* left pixel tail (8-bit) */}
                    <div
                      aria-hidden
                      style={{ position: 'absolute', left: -12, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24 }}
                    >
                      <div style={{ position: 'absolute', width: 8, height: 8, background: '#181818', boxShadow: '0 0 0 4px #EAEAEA, 8px 8px 0 #000', left: 16, top: -8 }} />
                      <div style={{ position: 'absolute', width: 8, height: 8, background: '#181818', boxShadow: '0 0 0 4px #EAEAEA, 8px 8px 0 #000', left: 8, top: 0 }} />
                      <div style={{ position: 'absolute', width: 8, height: 8, background: '#181818', boxShadow: '0 0 0 4px #EAEAEA, 8px 8px 0 #000', left: 0, top: 8 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => setIntroStep(1)}
                    style={{ background: '#1f1f1f', border: '1px solid #2a2a2a', borderRadius: 10, color: '#EAEAEA', padding: '8px 12px', cursor: 'pointer' }}
                  >
                    Back
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setShowIntro(false)}
                      style={{ background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 10, color: '#FFFFFF', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Got it
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 8px" }}>
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            marginBottom: 16,
            gap: 8
          }}
        >
          <div />
          <img
            src={W2PLogo}
            alt="WHERE2PLACE logo"
            style={{
              display: "block",
              margin: "0 auto",
              height: "clamp(28px, 6vw, 44px)",
              width: "auto"
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={() => { setIntroStep(1); setShowIntro(true); }}
              style={{
                width: 36,
                height: 36,
                background: "#1f1f1f",
                border: "1px solid #2a2a2a",
                borderRadius: 8,
                color: "#EAEAEA",
                cursor: "pointer",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
              aria-label="Show information"
              title="Information"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                <circle cx="12" cy="8" r="1.5" fill="currentColor" />
                <rect x="11" y="11" width="2" height="7" rx="1" fill="currentColor" />
              </svg>
            </button>
            <button
              onClick={downloadPng}
              style={{
                width: 36,
                height: 36,
                background: "#1f1f1f",
                border: "1px solid #2a2a2a",
                borderRadius: 8,
                color: "#EAEAEA",
                cursor: "pointer",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
              aria-label="Download PNG"
              title="Download PNG"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M6 12l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* Controls */}
        {!img ? (
          /* Show only upload box when no image - larger and more prominent */
          <div style={{ maxWidth: "min(600px, 100%)", margin: "0 auto", marginBottom: 16 }}>
            <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: "clamp(12px, 3vw, 24px)" }}>
              <div style={{ fontWeight: 600, marginBottom: 16, fontSize: "clamp(16px, 4vw, 18px)", textAlign: "center" }}>Upload Source Image</div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={onDragOver}
                style={{
                  marginTop: 10,
                  padding: "clamp(24px, 6vw, 48px)",
                  border: "2px dashed #2f2f2f",
                  borderRadius: 12,
                  color: "#A8A8A8",
                  textAlign: "center",
                  userSelect: "none",
                  cursor: "pointer",
                  background: "#0f0f0f",
                  fontSize: "clamp(14px, 3.5vw, 16px)",
                  minHeight: "clamp(120px, 25vw, 200px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                title="Click to choose a file or drop one here"
              >
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Drop image here or click to browse</div>
                  <div style={{ fontSize: "clamp(12px, 3vw, 14px)", opacity: 0.7 }}>Supports JPG, PNG, GIF, WebP and other image formats</div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => { if (e.target.files?.[0]) loadImageFromFile(e.target.files[0]); }}
                  style={{ display: "none" }}
                />
              </div>
            </div>
          </div>
        ) : (
          /* Show all controls when image is uploaded */
          <div
            className="controls-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
              marginBottom: 12
            }}
          >
            {/* Upload */}
            <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Source Image</div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={onDragOver}
                style={{
                  marginTop: 10,
                  padding: 12,
                  border: "1px dashed #2f2f2f",
                  borderRadius: 12,
                  color: "#A8A8A8",
                  textAlign: "center",
                  userSelect: "none",
                  cursor: "pointer",
                  background: "#0f0f0f"
                }}
                title="Click to choose a file or drop one here"
              >
                Drop image here or click to browse
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => { if (e.target.files?.[0]) loadImageFromFile(e.target.files[0]); }}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            {/* Pixelation */}
            <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Pixelation</div>
                <button
                  onClick={() => setLockPixelation((v) => !v)}
                  title={lockPixelation ? "Unlock" : "Lock"}
                  style={{
                    width: 28,
                    height: 28,
                    background: "#1f1f1f",
                    border: "1px solid #2a2a2a",
                    borderRadius: 6,
                    color: "#FFFFFF",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    lineHeight: 1
                  }}
                >
                  {lockPixelation ? "●" : "○"}
                </button>
              </div>
              <div style={{ opacity: lockPixelation ? 0.55 : 1 }}>
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
                  disabled={lockPixelation}
                />
              </div>
            </div>

      {/* Starting coordinates */}
            <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Starting Coordinates</div>
                <button
                  onClick={() => setLockGenesis((v) => !v)}
                  title={lockGenesis ? "Unlock" : "Lock"}
                  style={{
                    width: 28,
                    height: 28,
                    background: "#1f1f1f",
                    border: "1px solid #2a2a2a",
                    borderRadius: 6,
                    color: "#FFFFFF",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    lineHeight: 1
                  }}
                >
                  {lockGenesis ? "●" : "○"}
                </button>
              </div>
              <div style={{ opacity: lockGenesis ? 0.55 : 1 }}>
                <div className="genesis-inputs" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label style={{ fontSize: 13 }}>
                    X
                    <input
                      type="text"
                      value={genesisX}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '-') {
                          setGenesisX(val);
                        } else if (/^-?\d+$/.test(val)) {
                          setGenesisX(parseInt(val, 10));
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '-' || isNaN(parseInt(val, 10))) {
                          setGenesisX(0);
                        }
                      }}
                      style={{ 
                        width: "100%", 
                        background: "#1a1a1a", 
                        border: "1px solid #2a2a2a", 
                        color: "#EAEAEA", 
                        borderRadius: 10, 
                        padding: "8px 10px", 
                        marginTop: 6,
                        boxSizing: "border-box",
                        MozAppearance: "textfield"
                      }}
                      disabled={lockGenesis}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    Y
                    <input
                      type="text"
                      value={genesisY}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '-') {
                          setGenesisY(val);
                        } else if (/^-?\d+$/.test(val)) {
                          setGenesisY(parseInt(val, 10));
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '-' || isNaN(parseInt(val, 10))) {
                          setGenesisY(0);
                        }
                      }}
                      style={{ 
                        width: "100%", 
                        background: "#1a1a1a", 
                        border: "1px solid #2a2a2a", 
                        color: "#EAEAEA", 
                        borderRadius: 10, 
                        padding: "8px 10px", 
                        marginTop: 6,
                        boxSizing: "border-box",
                        MozAppearance: "textfield"
                      }}
                      disabled={lockGenesis}
                    />
                  </label>
                </div>
              </div>
              {/* Hover readout moved to tooltip near cursor; intentionally not shown here */}
            </div>

            {/* Colour conversion / Palette */}
            <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Colour conversion</div>
                  <button
                    onClick={() => setLockPalette(v => !v)}
                    title={lockPalette ? "Unlock" : "Lock"}
                    style={{
                      width: 28,
                      height: 28,
                      background: "#1f1f1f",
                      border: "1px solid #2a2a2a",
                      borderRadius: 6,
                      color: "#FFFFFF",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      lineHeight: 1
                    }}
                  >
                    {lockPalette ? "●" : "○"}
                  </button>
                </div>
                <button
                  onClick={() => setPaletteOpen(v => !v)}
                  title={paletteOpen ? 'Hide colours' : 'Show colours'}
                  style={{
                    background: "#1f1f1f",
                    border: "1px solid #2a2a2a",
                    borderRadius: 8,
                    color: "#EAEAEA",
                    cursor: "pointer",
                    padding: "8px 12px",
                    fontSize: 13
                  }}
                >
                  {paletteOpen ? 'Hide' : 'Edit'}
                </button>
              </div>
              {!paletteOpen && (
                <div style={{ color: '#A8A8A8', fontSize: 12 }}>
                  Enabled {enabledIndices.length}/{PALETTE.length}
                </div>
              )}
              {paletteOpen && (
                <div style={{ opacity: lockPalette ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={applyBaseSet}
                      title="Enable only the Base set colours"
                      disabled={lockPalette}
                      style={{ background: '#1f1f1f', border: '1px solid #2a2a2a', borderRadius: 10, color: '#EAEAEA', padding: '8px 12px', cursor: lockPalette ? 'not-allowed' : 'pointer', fontSize: '13px', flex: '1', minWidth: '80px' }}
                    >
                      Base set
                    </button>
                    <button
                      onClick={enableFullSet}
                      title="Enable all colours"
                      disabled={lockPalette}
                      style={{ background: '#1f1f1f', border: '1px solid #2a2a2a', borderRadius: 10, color: '#EAEAEA', padding: '8px 12px', cursor: lockPalette ? 'not-allowed' : 'pointer', fontSize: '13px', flex: '1', minWidth: '80px' }}
                    >
                      Full set
                    </button>
                  </div>
                  <div className="palette-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6 }}>
                    {PALETTE.map((hex, i) => {
                      const enabled = paletteEnabled[i];
                      return (
                        <div key={hex + i}
                          onClick={() => toggleColour(i)}
                          title={`${hex} ${enabled ? '(enabled)' : '(disabled)'}`}
                          style={{
                            position: 'relative',
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            border: '1px solid #2a2a2a',
                            background: hex,
                            cursor: lockPalette ? 'not-allowed' : 'pointer',
                            opacity: enabled ? 1 : 0.35,
                            boxShadow: enabled ? '0 0 0 2px rgba(0,0,0,0.25) inset' : 'none'
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Share / Import */}
            <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Share / Import</div>
              <div className="share-buttons" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
                <input
                  type="text"
                  value={shareCode}
                  onChange={(e) => setShareCode(e.target.value)}
                  placeholder="Paste code here..."
                  style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#EAEAEA", borderRadius: 10, padding: "8px 10px", fontSize: "13px", minWidth: 0, boxSizing: "border-box" }}
                />
                <button
                  onClick={exportSettings}
                  title="Export current settings (copies to clipboard)"
                  style={{ background: "#1f1f1f", border: "1px solid #2a2a2a", borderRadius: 10, color: "#EAEAEA", padding: "8px 12px", cursor: "pointer", whiteSpace: "nowrap", fontSize: "13px" }}
                >
                  Export
                </button>
                <button
                  onClick={applySettings}
                  title="Apply the code to update settings"
                  style={{ background: "#1f1f1f", border: "1px solid #2a2a2a", borderRadius: 10, color: "#EAEAEA", padding: "8px 12px", cursor: "pointer", whiteSpace: "nowrap", fontSize: "13px" }}
                >
                  Apply
                </button>
              </div>
              <div style={{ marginTop: 6, color: "#A8A8A8", fontSize: 12 }}>
                Exports a compact, versioned code for pixels across, starting coordinates and zoom.
              </div>
            </div>
          </div>
        )}

        {/* Stage - only shown when image is uploaded */}
        {img && (
          <div style={{ background: "#121212", border: "1px solid #1f1f1f", borderRadius: 14, padding: 12, overflow: "hidden", position: "relative" }}>
            <div>
              {/* Zoom controls */}
              <div
                style={{
                  position: "absolute",
                  top: "clamp(8px, 2vw, 20px)",
                  right: "clamp(8px, 2vw, 20px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  zIndex: 10
                }}
              >
                <button
                  onClick={zoomIn}
                  style={{
                    width: "clamp(28px, 8vw, 36px)",
                    height: "clamp(28px, 8vw, 36px)",
                    background: "#1f1f1f",
                    border: "1px solid #2a2a2a",
                    borderRadius: 8,
                    color: "#EAEAEA",
                    cursor: "pointer",
                    fontSize: "clamp(14px, 4vw, 18px)",
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="Zoom in"
                >
                  +
                </button>
                <button
                  onClick={zoomOut}
                  style={{
                    width: "clamp(28px, 8vw, 36px)",
                    height: "clamp(28px, 8vw, 36px)",
                    background: "#1f1f1f",
                    border: "1px solid #2a2a2a",
                    borderRadius: 8,
                    color: "#EAEAEA",
                    cursor: "pointer",
                    fontSize: "clamp(14px, 4vw, 18px)",
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="Zoom out"
                >
                  −
                </button>
              </div>

              {/* Image container */}
              <div
                style={{
                  overflow: "auto",
                  maxHeight: "70vh",
                  position: "relative",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center"
                }}
              >
                <div
                  className="stage"
                  style={{
                    position: "relative",
                    width: gridW * zoom,
                    height: gridH * zoom,
                    transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
                    cursor: isDragging ? "grabbing" : "grab"
                  }}
                  onMouseMove={onMouseMove}
                  onMouseLeave={onMouseLeave}
                  onMouseDown={onMouseDown}
                  onMouseUp={onMouseUp}
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
                  {/* Hover tooltip near mouse */}
                  {hover.x >= 0 && !isDragging && (
                    <div
                      style={{
                        position: "absolute",
                        left: Math.min(mousePx.x + 12, gridW * zoom - 120),
                        top: Math.min(mousePx.y + 12, gridH * zoom - 40),
                        background: "rgba(30,30,30,0.9)",
                        color: "#EAEAEA",
                        border: "1px solid #2a2a2a",
                        borderRadius: 8,
                        padding: "4px 6px",
                        fontSize: 12,
                        fontFamily: "monospace",
                        pointerEvents: "none",
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.4)"
                      }}
                    >
                      ({(Number(genesisX) || 0) + hover.x}, {(Number(genesisY) || 0) + hover.y}){gridW && gridH ? ` ${gridColors[hover.y * gridW + hover.x]}` : ""}
                    </div>
                  )}
                  {/* Size label */}
                  <div style={{ position: "absolute", top: -24, left: 0, fontSize: "clamp(10px, 2.5vw, 12px)", opacity: 0.7, fontFamily: "monospace" }}>
                    W {gridW} × H {gridH} px (Zoom: {zoom}x)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer - only shown when image is uploaded */}
        {img && (
          <footer style={{ color: "#A8A8A8", fontSize: "clamp(10px, 2.5vw, 12px)", marginTop: 12, textAlign: "center", padding: "0 8px" }}>
            Tip: hover to see neon crosshairs and per-pixel coordinates (adjusted by your starting offset). Click and drag to pan the image.
          </footer>
        )}
      </div>
    </div>
  );
}
