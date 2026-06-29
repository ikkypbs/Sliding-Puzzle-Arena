// --- STATE & KONFIGURASI GLOBAL ---
let currentMode = 'single'; // 'single' atau 'multi'
let gameActive = false;
let startTime = null;
let timerInterval = null;
let appState = "tracking"; // 'tracking', 'countdown', 'puzzle'

// Konfigurasi Grid & Batas Sensor dari Project 1
const GRID = 3;
const PINCH_THRESHOLD = 0.055;
const FREEZE_HOLD_MS = 250;
const COUNTDOWN_SECONDS = 3;
const FIST_HOLD_FRAMES = 15; // Jumlah frame mengepal untuk trigger simpan
const SNAP_DISTANCE_RATIO = 0.45;

// Konfigurasi Efek Foto & Galeri Strip (Project 1)
const PHOTOBOOTH_CONTRAST_ALPHA = 1.3;
const PHOTOBOOTH_BRIGHTNESS_BETA = 10;
const PHOTOBOOTH_NOISE_STD = 15;
const STRIP_MAX_PHOTOS = 3;
const galleryEntries = []; // Menyimpan data base64/canvas untuk diunduh

// Struktur Puzzle untuk Arena Terpisah
const puzzleP1 = { pieces: [], solved: false, tileW: 0, tileH: 0 };
const puzzleP2 = { pieces: [], solved: false, tileW: 0, tileH: 0 };

// Mengontrol Logika Geser untuk Masing-masing Tangan
const dragP1 = { activeHand: null, piece: null, offsetX: 0, offsetY: 0 };
const dragP2 = { activeHand: null, piece: null, offsetX: 0, offsetY: 0 };

const freezeGate = { holding: false, since: 0 };
const countdown = { active: false, startedAt: 0 };
let fistHoldCounter = 0;

// Sumber snapshot global untuk galeri unduhan
let capturedImageSource = null;

// Struktur Landmark MediaPipe Hands 21 Titik
const LM = {
    WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_TIP: 12, RING_MCP: 13, RING_TIP: 16, PINKY_MCP: 17, PINKY_TIP: 20
};

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

// --- ELEMEN DOM ---
const menuScreen = document.getElementById("menu-screen");
const gameScreen = document.getElementById("game-screen");
const btnSingle = document.getElementById("btn-single");
const btnMulti = document.getElementById("btn-multi");
const btnStart = document.getElementById("btn-start");
const btnBack = document.getElementById("btn-back");
const timerEl = document.getElementById("timer");
const player2Side = document.getElementById("player2-side");
const p1Label = document.getElementById("p1-label");

const videoEl = document.getElementById("webcam");
const canvasP1 = document.getElementById("canvas-p1");
const ctxP1 = canvasP1.getContext("2d", { willReadFrequently: true });
const canvasP2 = document.getElementById("canvas-p2");
const ctxP2 = canvasP2.getContext("2d", { willReadFrequently: true });

const galleryStrip = document.getElementById("galleryStrip");
const galleryEmpty = document.getElementById("galleryEmpty");
const galleryCount = document.getElementById("galleryCount");
const downloadStripBtn = document.getElementById("downloadStripBtn");
const resetAllBtn = document.getElementById("resetAllBtn");

// --- INTERAKSI NAVIGASI MENU ---
btnSingle.addEventListener("click", () => {
    btnSingle.classList.add("active");
    btnMulti.classList.remove("active");
    currentMode = 'single';
});

btnMulti.addEventListener("click", () => {
    btnMulti.classList.add("active");
    btnSingle.classList.remove("active");
    currentMode = 'multi';
});

btnStart.addEventListener("click", async () => {
    menuScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    
    if (currentMode === 'multi') {
        player2Side.classList.remove("hidden");
        p1Label.textContent = "Pemain 1 (Tangan Kanan)";
    } else {
        player2Side.classList.add("hidden");
        p1Label.textContent = "Pemain Wajahmu";
    }
    await startAIEngine();
});

btnBack.addEventListener("click", () => {
    stopGameAndTimer();
    resetEverything();
    gameScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
});

// --- INITIALIZE MEDIAPIPE ---
async function startAIEngine() {
    canvasP1.width = 400; canvasP1.height = 400;
    canvasP2.width = 400; canvasP2.height = 400;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }, audio: false
        });
        videoEl.srcObject = stream;
    } catch (err) {
        alert("Akses webcam bermasalah: " + err.message);
        return;
    }

    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6
    });

    hands.onResults(onHandResults);

    const camera = new Camera(videoEl, {
        onFrame: async () => { await hands.send({ image: videoEl }); },
        width: 640, height: 480
    });
    camera.start();
    gameActive = true;
    appState = "tracking";
    updateStripDownloadAvailability();
}

// --- CORE PROCESSOR BINGKAI AI ---
function onHandResults(results) {
    if (!gameActive) return;

    ctxP1.clearRect(0, 0, canvasP1.width, canvasP1.height);
    ctxP2.clearRect(0, 0, canvasP2.width, canvasP2.height);

    if (appState === "tracking" || appState === "countdown") {
        drawLiveMirror(ctxP1);
        if (currentMode === 'multi') drawLiveMirror(ctxP2);
    } else if (appState === "puzzle") {
        drawBoardAndPieces(ctxP1, puzzleP1);
        if (currentMode === 'multi') drawBoardAndPieces(ctxP2, puzzleP2);
    }

    const handsLandmarks = results.multiHandLandmarks || [];

    if (handsLandmarks.length === 0) {
        fistHoldCounter = 0;
        if (appState === "countdown") drawCountdownOverlay();
        return;
    }

    // Aksi 1: Deteksi Kunci Capture Awal (Pinch)
    if (appState === "tracking") {
        if (currentMode === 'single' && handsLandmarks.length === 1) {
            handleSingleCaptureTrigger(handsLandmarks[0]);
        } else if (currentMode === 'multi' && handsLandmarks.length === 2) {
            if (isPinching(handsLandmarks[0]) && isPinching(handsLandmarks[1])) {
                startCountdownSequence();
            }
        }
    }

    // Aksi 2: Gambar Angka Countdown
    if (appState === "countdown") {
        drawCountdownOverlay();
        return;
    }

    // Aksi 3: Game Loop Puzzle & Deteksi Kepalan Tangan (Fist) untuk Simpan Galeri
    if (appState === "puzzle") {
        // Cek apakah ada tangan yang mengepal saat puzzle selesai
        const isGameFinished = currentMode === 'single' ? puzzleP1.solved : (puzzleP1.solved && puzzleP2.solved);
        const anyFist = handsLandmarks.some(lm => isFist(lm));

        if (isGameFinished && anyFist) {
            fistHoldCounter++;
            if (fistHoldCounter >= FIST_HOLD_FRAMES) {
                fistHoldCounter = 0;
                savePuzzleToGalleryStrip();
                return;
            }
        } else {
            fistHoldCounter = 0;
        }

        handsLandmarks.forEach((lm, i) => {
            const classification = results.multiHandedness[i];
            const isLeftHand = classification.label === 'Left';
            const pinching = isPinching(lm);
            const indexPx = { x: (1 - lm[LM.INDEX_TIP].x) * canvasP1.width, y: lm[LM.INDEX_TIP].y * canvasP1.height };

            if (currentMode === 'single') {
                drawHandSkeleton(ctxP1, lm, pinching);
                handleSlidingLogic(puzzleP1, dragP1, "Single", pinching, indexPx);
            } else {
                if (!isLeftHand) { // Tangan Kanan Asli -> Arena Kiri (P1)
                    drawHandSkeleton(ctxP1, lm, pinching);
                    handleSlidingLogic(puzzleP1, dragP1, "P1", pinching, indexPx);
                } else { // Tangan Kiri Asli -> Arena Kanan (P2)
                    drawHandSkeleton(ctxP2, lm, pinching);
                    handleSlidingLogic(puzzleP2, dragP2, "P2", pinching, indexPx);
                }
            }
        });
    }
}

// --- LOGIKA GESER SLIDING PUZZLE TRADISIONAL ---
function handleSlidingLogic(puzzleObj, dragTrack, handLabel, pinching, indexPx) {
    if (puzzleObj.solved) return;

    if (pinching) {
        if (dragTrack.activeHand === null) {
            const candidate = puzzleObj.pieces.find(p => {
                const cx = p.x + p.w / 2; const cy = p.y + p.h / 2;
                return Math.hypot(indexPx.x - cx, indexPx.y - cy) < Math.max(p.w, p.h) * 0.6;
            });
            if (candidate && !candidate.placed) {
                dragTrack.activeHand = handLabel;
                dragTrack.piece = candidate;
                dragTrack.offsetX = indexPx.x - candidate.x;
                dragTrack.offsetY = indexPx.y - candidate.y;
            }
        } else if (dragTrack.activeHand === handLabel && dragTrack.piece) {
            dragTrack.piece.x = indexPx.x - dragTrack.offsetX;
            dragTrack.piece.y = indexPx.y - dragTrack.offsetY;
        }
    } else {
        if (dragTrack.activeHand === handLabel && dragTrack.piece) {
            const piece = dragTrack.piece;
            const cellCol = Math.min(GRID - 1, Math.max(0, Math.floor((piece.x + piece.w / 2) / puzzleObj.tileW)));
            const cellRow = Math.min(GRID - 1, Math.max(0, Math.floor((piece.y + piece.h / 2) / puzzleObj.tileH)));
            
            displaceCellOccupant(puzzleObj, piece, cellRow, cellCol);

            dragTrack.activeHand = null; dragTrack.piece = null;
            puzzleObj.solved = puzzleObj.pieces.every(p => p.placed);
            if (puzzleObj.solved && (currentMode === 'single' || (puzzleP1.solved && puzzleP2.solved))) {
                clearInterval(timerInterval);
            }
        }
    }
}

function displaceCellOccupant(puzzleObj, piece, targetRow, targetCol) {
    const tileW = puzzleObj.tileW; const tileH = puzzleObj.tileH;
    const occupant = puzzleObj.pieces.find(p => p !== piece && Math.abs(p.x - (targetCol * tileW)) < 5 && Math.abs(p.y - (targetRow * tileH)) < 5);
    
    if (!occupant) {
        piece.x = targetCol * tileW; piece.y = targetRow * tileH;
        piece.placed = (piece.row === targetRow && piece.col === targetCol);
    } else {
        snapPieceToNearestFreeSlot(puzzleObj, piece);
    }
}

function snapPieceToNearestFreeSlot(puzzleObj, piece) {
    const tileW = puzzleObj.tileW; const tileH = puzzleObj.tileH;
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            const taken = puzzleObj.pieces.some(p => p !== piece && Math.abs(p.x - (c * tileW)) < 5 && Math.abs(p.y - (r * tileH)) < 5);
            if (!taken) {
                piece.x = c * tileW; piece.y = r * tileH;
                piece.placed = (piece.row === r && piece.col === c);
                return;
            }
        }
    }
}

// --- UTILS DETEKSI JARI ---
function getDistance(pt1, pt2) { return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y); }
自由=true;
function isPinching(landmarks) { return getDistance(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) < PINCH_THRESHOLD; }
function isFist(landmarks) {
    const wrist = landmarks[LM.WRIST];
    const pairs = [[LM.INDEX_TIP, LM.INDEX_MCP], [LM.MIDDLE_TIP, LM.MIDDLE_MCP], [LM.RING_TIP, LM.RING_MCP], [LM.PINKY_TIP, LM.PINKY_MCP]];
    let curled = 0;
    for (const [t, m] of pairs) { if (getDistance(landmarks[t], wrist) < getDistance(landmarks[m], wrist)) curled++; }
    return curled >= 4;
}

function drawLiveMirror(ctx) {
    ctx.save(); ctx.translate(ctx.canvas.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(videoEl, 0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
}

function drawHandSkeleton(ctx, landmarks, pinching) {
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = pinching ? "#00ffcc" : "#ffffff"; ctx.lineCap = "round";
    HAND_CONNECTIONS.forEach(([i, j]) => {
        const a = landmarks[i]; const b = landmarks[j];
        ctx.beginPath(); ctx.moveTo((1 - a.x) * ctx.canvas.width, a.y * ctx.canvas.height);
        ctx.lineTo((1 - b.x) * ctx.canvas.width, b.y * ctx.canvas.height); ctx.stroke();
    });
    ctx.fillStyle = pinching ? "#00ffcc" : "#fca311";
    landmarks.forEach(pt => {
        ctx.beginPath(); ctx.arc((1 - pt.x) * ctx.canvas.width, pt.y * ctx.canvas.height, 4, 0, 2 * Math.PI); ctx.fill();
    });
    ctx.restore();
}

// --- COUNTDOWN & CAPTURE ENGINE ---
function handleSingleCaptureTrigger(hand) {
    if (isPinching(hand)) {
        if (!freezeGate.holding) { freezeGate.holding = true; freezeGate.since = performance.now(); }
        if (performance.now() - freezeGate.since > FREEZE_HOLD_MS) { freezeGate.holding = false; startCountdownSequence(); }
    } else { freezeGate.holding = false; }
}

function startCountdownSequence() {
    appState = "countdown"; countdown.active = true; countdown.startedAt = performance.now();
}

function drawCountdownOverlay() {
    const elapsed = (performance.now() - countdown.startedAt) / 1000;
    const remaining = COUNTDOWN_SECONDS - elapsed;
    if (remaining <= 0) { countdown.active = false; executeFaceCapture(); return; }
    const n = Math.ceil(remaining);
    [ctxP1, ctxP2].forEach((ctx, i) => {
        if (i === 1 && currentMode === 'single') return;
        ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "bold 65px sans-serif"; ctx.fillStyle = "#00ffcc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(n), ctx.canvas.width / 2, ctx.canvas.height / 2);
    });
}

function executeFaceCapture() {
    appState = "puzzle";
    const snapCanvas = document.createElement("canvas");
    snapCanvas.width = canvasP1.width; snapCanvas.height = canvasP1.height;
    const snapCtx = snapCanvas.getContext("2d");
    snapCtx.translate(snapCanvas.width, 0); snapCtx.scale(-1, 1);
    snapCtx.drawImage(videoEl, 0, 0, snapCanvas.width, snapCanvas.height);

    // Filter Vintage Grain Noise Effect Project 1
    const imgData = snapCtx.getImageData(0, 0, snapCanvas.width, snapCanvas.height);
    applyPhotoboothEffect(imgData);
    snapCtx.putImageData(imgData, 0, 0);

    // Amankan data snapshot asli ke variabel global untuk keperluan unduh nanti
    capturedImageSource = snapCanvas;

    buildSlidingPuzzleGrid(puzzleP1, snapCanvas);
    if (currentMode === 'multi') buildSlidingPuzzleGrid(puzzleP2, snapCanvas);
    startTimer();
}

function applyPhotoboothEffect(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let v = gray * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA;
        const u1 = Math.random() || 1e-6; const u2 = Math.random();
        v += Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * PHOTOBOOTH_NOISE_STD;
        v = Math.max(0, Math.min(255, v)); d[i] = d[i + 1] = d[i + 2] = v;
    }
}

function buildSlidingPuzzleGrid(puzzleObj, srcCanvas) {
    const tileW = srcCanvas.width / GRID; const tileH = srcCanvas.height / GRID;
    puzzleObj.pieces = []; puzzleObj.tileW = tileW; puzzleObj.tileH = tileH; puzzleObj.solved = false;

    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            const pCanv = document.createElement("canvas"); pCanv.width = tileW; pCanv.height = tileH;
            pCanv.getContext("2d").drawImage(srcCanvas, c * tileW, r * tileH, tileW, tileH, 0, 0, tileW, tileH);
            puzzleObj.pieces.push({ row: r, col: c, canvas: pCanv, w: tileW, h: tileH, x: c * tileW, y: r * tileH, placed: true });
        }
    }

    const slots = puzzleObj.pieces.map(p => ({ x: p.x, y: p.y }));
    for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    puzzleObj.pieces.forEach((p, i) => {
        p.x = slots[i].x; p.y = slots[i].y;
        p.placed = Math.abs(p.x - (p.col * tileW)) < 5 && Math.abs(p.y - (p.row * tileH)) < 5;
    });
}

function drawBoardAndPieces(ctx, puzzleObj) {
    ctx.fillStyle = "#111215"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    puzzleObj.pieces.forEach(p => {
        ctx.drawImage(p.canvas, p.x, p.y);
        ctx.strokeStyle = p.placed ? "#5fae6e" : "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1.5; ctx.strokeRect(p.x, p.y, p.w, p.h);
    });

    // Indikasi Kemenangan Game
    const isGameFinished = currentMode === 'single' ? puzzleP1.solved : (puzzleP1.solved && puzzleP2.solved);
    if (isGameFinished) {
        ctx.fillStyle = "rgba(95,174,110,0.2)"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "bold 20px monospace"; ctx.fillStyle = "#5fae6e"; ctx.textAlign = "center";
        ctx.fillText("SELESAI! KEPAL UNTUK SIMPAN", ctx.canvas.width / 2, ctx.canvas.height / 2);
    }
}

// --- FIX: LOGIKA GALERI DAN SKRIP DOWNLOAD STRIP 100% WORKING ---
function savePuzzleToGalleryStrip() {
    if (galleryEntries.length >= STRIP_MAX_PHOTOS || !capturedImageSource) return;
    
    // Duplikasi foto dari sumber terjamin ke canvas galeri baru
    const savedCanvas = document.createElement("canvas");
    savedCanvas.width = capturedImageSource.width; 
    savedCanvas.height = capturedImageSource.height;
    savedCanvas.getContext("2d").drawImage(capturedImageSource, 0, 0);

    // Amankan ke array data download
    galleryEntries.push(savedCanvas);
    
    // Render visualisasi thumbnail ke kolom galeri kanan
    renderGalleryThumb(savedCanvas, galleryEntries.length);
    
    galleryCount.textContent = `${galleryEntries.length} / ${STRIP_MAX_PHOTOS}`;
    if (galleryEmpty) galleryEmpty.style.display = "none";
    
    updateStripDownloadAvailability();
    resetPuzzleOnly();
}

function renderGalleryThumb(srcCanvas, index) {
    const print = document.createElement("div"); print.className = "print";
    const thumbCanvas = document.createElement("canvas");
    const THUMB_W = 220; const scale = THUMB_W / srcCanvas.width;
    thumbCanvas.width = THUMB_W; thumbCanvas.height = Math.round(srcCanvas.height * scale);
    thumbCanvas.getContext("2d").drawImage(srcCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

    const label = document.createElement("div"); label.className = "print-label";
    label.textContent = `#${String(index).padStart(2, "0")}`;
    print.appendChild(thumbCanvas); print.appendChild(label);
    
    if (galleryStrip) galleryStrip.insertBefore(print, galleryStrip.firstChild);
}

function updateStripDownloadAvailability() {
    if (downloadStripBtn) {
        downloadStripBtn.disabled = galleryEntries.length === 0;
        // Berikan highlight visual biar user tahu tombolnya aktif
        if (galleryEntries.length > 0) {
            downloadStripBtn.style.opacity = "1";
            downloadStripBtn.style.cursor = "pointer";
        } else {
            downloadStripBtn.style.opacity = "0.5";
            downloadStripBtn.style.cursor = "not-allowed";
        }
    }
}

// FIX UTAMA: Pemicu download kompilasi strip foto vertikal secara lokal otomatis
function downloadPhotoStrip() {
    if (galleryEntries.length === 0) return;
    
    const targetW = 400; // Standar lebar strip foto luar
    const border = 24; 
    const gap = 16;
    
    // Hitung total tinggi dinamis berdasarkan jumlah foto yang tersimpan
    const totalH = (border * 2) + (targetW * galleryEntries.length) + (gap * (galleryEntries.length - 1));
    const totalW = targetW + (border * 2);

    const stripCanvas = document.createElement("canvas");
    stripCanvas.width = totalW; stripCanvas.height = totalH;
    const sCtx = stripCanvas.getContext("2d");
    
    // Isi background putih kertas strip foto klasik
    sCtx.fillStyle = "#ffffff"; 
    sCtx.fillRect(0, 0, totalW, totalH);

    let cursorY = border;
    galleryEntries.forEach((canvasItem) => {
        sCtx.drawImage(canvasItem, border, cursorY, targetW, targetW);
        cursorY += targetW + gap;
    });

    // Pemicu unduhan otomatis sistem browser lokal
    const dataURL = stripCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataURL; 
    link.download = `photobooth_puzzle_${Date.now()}.png`;
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
}

function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor((elapsed / 1000) % 60);
        const minutes = Math.floor((elapsed / 1000 / 60) % 60);
        timerEl.textContent = `Waktu: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function stopGameAndTimer() {
    clearInterval(timerInterval);
    gameActive = false;
    if (videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(track => track.stop());
    }
}

function resetPuzzleOnly() {
    appState = "tracking";
    puzzleP1.pieces = []; puzzleP1.solved = false;
    puzzleP2.pieces = []; puzzleP2.solved = false;
}

function resetEverything() {
    galleryEntries.length = 0;
    if (galleryStrip) {
        galleryStrip.innerHTML = "";
        if (galleryEmpty) { galleryEmpty.style.display = "block"; galleryStrip.appendChild(galleryEmpty); }
    }
    galleryCount.textContent = `0 / ${STRIP_MAX_PHOTOS}`;
    capturedImageSource = null;
    updateStripDownloadAvailability();
    resetPuzzleOnly();
}

if (downloadStripBtn) downloadStripBtn.addEventListener("click", downloadPhotoStrip);
if (resetAllBtn) resetAllBtn.addEventListener("click", resetEverything);
