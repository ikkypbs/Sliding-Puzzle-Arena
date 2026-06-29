// --- STATE & KONFIGURASI GLOBAL ---
let currentMode = 'single'; // 'single' atau 'multi'
let gameActive = false;
let startTime = null;
let timerInterval = null;
let appState = "tracking"; // 'tracking', 'countdown', 'puzzle'

// Konfigurasi Grid 3x3 (Mengikuti Proyek Pertama)
const GRID = 3;
const PINCH_THRESHOLD = 0.055;
const FRAME_PADDING = 28;
const FREEZE_HOLD_MS = 250;
const COUNTDOWN_SECONDS = 3;
const SNAP_DISTANCE_RATIO = 0.45;

// Struktur Board Puzzle (Mengadaptasi Kedahsyatan Proyek Pertama)
let puzzleP1 = { pieces: [], solved: false, boardBox: null, tileW: 0, tileH: 0 };
let puzzleP2 = { pieces: [], solved: false, boardBox: null, tileW: 0, tileH: 0 };

// State Interaksi Drag & Drop Tradisional / Swap
const dragP1 = { activeHand: null, piece: null, offsetX: 0, offsetY: 0 };
const dragP2 = { activeHand: null, piece: null, offsetX: 0, offsetY: 0 };

const freezeGate = { holding: false, since: 0 };
const countdown = { active: false, startedAt: 0 };

// Indeks Landmark Jari Jalur Resmi MediaPipe
const LM = {
    WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_TIP: 12, RING_MCP: 13, RING_TIP: 16, PINKY_MCP: 17, PINKY_TIP: 20
};

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
const ctxP1 = canvasP1.getContext("2d");
const canvasP2 = document.getElementById("canvas-p2");
const ctxP2 = canvasP2.getContext("2d");

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

// --- ENGINE INITIALIZATION ---
async function startAIEngine() {
    canvasP1.width = 400;
    canvasP1.height = 400;
    canvasP2.width = 400;
    canvasP2.height = 400;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false
        });
        videoEl.srcObject = stream;
    } catch (err) {
        alert("Kamera bermasalah: " + err.message);
        return;
    }

    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });

    hands.onResults(onHandResults);

    const camera = new Camera(videoEl, {
        onFrame: async () => { await hands.send({ image: videoEl }); },
        width: 640, height: 480
    });
    camera.start();
    gameActive = true;
    appState = "tracking";
}

function getDistance(pt1, pt2) {
    return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y);
}
function isPinching(landmarks) {
    return getDistance(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) < PINCH_THRESHOLD;
}
function mirrorLandmarkX(pt) { return { x: 1 - pt.x, y: pt.y }; }

// --- AI GAME LOOP INTERACTION ---
function onHandResults(results) {
    if (!gameActive) return;

    ctxP1.clearRect(0, 0, canvasP1.width, canvasP1.height);
    ctxP2.clearRect(0, 0, canvasP2.width, canvasP2.height);

    // Render Background Cermin Kamera Utama
    if (appState === "tracking" || appState === "countdown") {
        drawLiveMirror(ctxP1);
        if (currentMode === 'multi') drawLiveMirror(ctxP2);
    } else {
        // Jika status sudah masuk tahap 'puzzle', render kepingan wajah di papan game
        drawBoardAndPieces(ctxP1, puzzleP1);
        if (currentMode === 'multi') drawBoardAndPieces(ctxP2, puzzleP2);
    }

    const handsLandmarks = results.multiHandLandmarks || [];
    
    if (handsLandmarks.length === 0) {
        if (appState === "countdown") drawCountdownOverlay();
        return;
    }

    // Logic 1: Tahap Tracking & Mengunci Gambar (Sama seperti Proyek Pertama)
    if (appState === "tracking") {
        if (currentMode === 'single' && handsLandmarks.length === 1) {
            handleCaptureTrigger(handsLandmarks[0]);
        } else if (currentMode === 'multi' && handsLandmarks.length === 2) {
            // Mode Multiplayer butuh dua tangan pinch barengan buat ngunci
            if (isPinching(handsLandmarks[0]) && isPinching(handsLandmarks[1])) {
                startCountdownSequence();
            }
        }
    }

    // Logic 2: Tahap Hitung Mundur Jepret
    if (appState === "countdown") {
        drawCountdownOverlay();
        return;
    }

    // Logic 3: Tahap Gameplay Geser Menggunakan Algoritma Proyek Pertama
    if (appState === "puzzle") {
        handsLandmarks.forEach((lm, i) => {
            const classification = results.multiHandedness[i];
            const isLeftHand = classification.label === 'Left';
            const pinching = isPinching(lm);
            const indexPx = { x: (1 - lm[LM.INDEX_TIP].x) * canvasP1.width, y: lm[LM.INDEX_TIP].y * canvasP1.height };

            if (currentMode === 'single') {
                drawHandCursor(ctxP1, indexPx, pinching);
                handleSlidingInteraction(puzzleP1, dragP1, "Single", pinching, indexPx);
            } else {
                // SINKRONISASI ARENA MULTIPLAYER LAYAR TERPISAH
                if (!isLeftHand) { // Tangan Kanan asli -> Mengendalikan Arena Kiri (P1)
                    drawHandCursor(ctxP1, indexPx, pinching);
                    handleSlidingInteraction(puzzleP1, dragP1, "P1", pinching, indexPx);
                } else { // Tangan Kiri asli -> Mengendalikan Arena Kanan (P2)
                    drawHandCursor(ctxP2, indexPx, pinching);
                    handleSlidingInteraction(puzzleP2, dragP2, "P2", pinching, indexPx);
                }
            }
        });
    }
}

function drawLiveMirror(ctx) {
    ctx.save();
    ctx.translate(ctx.canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
}

function drawHandCursor(ctx, pos, pinching) {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI);
    ctx.fillStyle = pinching ? "#00ffcc" : "#fca311";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
}

// --- LOGIKA HITUNG MUNDUR & PEMOTONGAN GRID PUZZLE ---
function handleCaptureTrigger(hand) {
    if (isPinching(hand)) {
        if (!freezeGate.holding) {
            freezeGate.holding = true;
            freezeGate.since = performance.now();
        }
        if (performance.now() - freezeGate.since > FREEZE_HOLD_MS) {
            freezeGate.holding = false;
            startCountdownSequence();
        }
    } else {
        freezeGate.holding = false;
    }
}

function startCountdownSequence() {
    appState = "countdown";
    countdown.active = true;
    countdown.startedAt = performance.now();
}

function drawCountdownOverlay() {
    const elapsed = (performance.now() - countdown.startedAt) / 1000;
    const remaining = COUNTDOWN_SECONDS - elapsed;
    const n = Math.ceil(remaining);

    if (remaining <= 0) {
        countdown.active = false;
        executeFaceCapture();
        return;
    }

    [ctxP1, ctxP2].forEach((ctx, i) => {
        if (i === 1 && currentMode === 'single') return;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "bold 60px monospace";
        ctx.fillStyle = "#fca311";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n), ctx.canvas.width / 2, ctx.canvas.height / 2);
    });
}

function executeFaceCapture() {
    appState = "puzzle";
    const snapCanvas = document.createElement("canvas");
    snapCanvas.width = canvasP1.width;
    snapCanvas.height = canvasP1.height;
    const snapCtx = snapCanvas.getContext("2d");
    
    snapCtx.translate(snapCanvas.width, 0);
    snapCtx.scale(-1, 1);
    snapCtx.drawImage(videoEl, 0, 0, snapCanvas.width, snapCanvas.height);

    buildSlidingPuzzleGrid(puzzleP1, snapCanvas);
    if (currentMode === 'multi') buildSlidingPuzzleGrid(puzzleP2, snapCanvas);
    
    startTimer();
}

function buildSlidingPuzzleGrid(puzzleObj, srcCanvas) {
    const tileW = Math.floor(srcCanvas.width / GRID);
    const tileH = Math.floor(srcCanvas.height / GRID);
    puzzleObj.pieces = [];
    puzzleObj.tileW = tileW;
    puzzleObj.tileH = tileH;
    puzzleObj.solved = false;

    for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
            const pieceCanvas = document.createElement("canvas");
            pieceCanvas.width = tileW;
            pieceCanvas.height = tileH;
            pieceCanvas.getContext("2d").drawImage(srcCanvas, col * tileW, row * tileH, tileW, tileH, 0, 0, tileW, tileH);

            puzzleObj.pieces.push({
                row, col, canvas: pieceCanvas, w: tileW, h: tileH,
                x: col * tileW, y: row * tileH, placed: true
            });
        }
    }

    // Acak posisi koordinat kotak puzzle (Mekanisme Proyek Pertama)
    const positions = puzzleObj.pieces.map(p => ({ x: p.x, y: p.y }));
    for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    puzzleObj.pieces.forEach((piece, i) => {
        piece.x = positions[i].x;
        piece.y = positions[i].y;
        piece.placed = Math.abs(piece.x - (piece.col * tileW)) < 5 && Math.abs(piece.y - (piece.row * tileH)) < 5;
    });
}

// --- MEKANISME SLIDING INTERACTION TRADISIONAL DARI PROYEK PERTAMA ---
function handleSlidingInteraction(puzzleObj, dragTrack, handLabel, pinching, indexPx) {
    if (puzzleObj.solved) return;

    if (pinching) {
        if (dragTrack.activeHand === null) {
            // Cari kepingan terdekat dari kursor koordinat jari
            const candidate = puzzleObj.pieces.find(piece => {
                const cx = piece.x + piece.w / 2;
                const cy = piece.y + piece.h / 2;
                return Math.hypot(indexPx.x - cx, indexPx.y - cy) < Math.max(piece.w, piece.h) * 0.6;
            });
            if (candidate) {
                dragTrack.activeHand = handLabel;
                dragTrack.piece = candidate;
                dragTrack.offsetX = indexPx.x - candidate.x;
                dragTrack.offsetY = indexPx.y - candidate.y;
                candidate.placed = false;
            }
        } else if (dragTrack.activeHand === handLabel && dragTrack.piece) {
            dragTrack.piece.x = indexPx.x - dragTrack.offsetX;
            dragTrack.piece.y = indexPx.y - dragTrack.offsetY;
        }
    } else {
        if (dragTrack.activeHand === handLabel && dragTrack.piece) {
            const piece = dragTrack.piece;
            const correctX = piece.col * puzzleObj.tileW;
            const correctY = piece.row * puzzleObj.tileH;
            
            // Cek kecocokan jarak snap magnet pengunci kotak puzzle
            if (Math.hypot(piece.x - correctX, piece.y - correctY) < puzzleObj.tileW * SNAP_DISTANCE_RATIO) {
                piece.x = correctX;
                piece.y = correctY;
                piece.placed = true;
            }
            dragTrack.activeHand = null;
            dragTrack.piece = null;
            
            // Periksa kondisi kemenangan arena board
            puzzleObj.solved = puzzleObj.pieces.every(p => p.placed);
            if (puzzleObj.solved && (currentMode === 'single' || (puzzleP1.solved && puzzleP2.solved))) {
                clearInterval(timerInterval);
            }
        }
    }
}

function drawBoardAndPieces(ctx, puzzleObj) {
    ctx.fillStyle = "#111215";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    puzzleObj.pieces.forEach(piece => {
        ctx.drawImage(piece.canvas, piece.x, piece.y);
        ctx.strokeStyle = piece.placed ? "#5fae6e" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(piece.x, piece.y, piece.w, piece.h);
    });

    if (puzzleObj.solved) {
        ctx.fillStyle = "rgba(95,174,110,0.3)";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "bold 24px monospace";
        ctx.fillStyle = "#5fae6e";
        ctx.textAlign = "center";
        ctx.fillText("ARENA SELESAI!", ctx.canvas.width / 2, ctx.canvas.height / 2);
    }
}

// --- TIMER & HUB STATE UTILS ---
function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor((elapsed / 1000) % 60);
        const minutes = Math.floor((elapsed / 1000 / 60) % 60);
        timerEl.textContent = `Waktu: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function resetEverything() {
    isCaptured = false;
    appState = "tracking";
    puzzleP1.pieces = []; puzzleP1.solved = false;
    puzzleP2.pieces = []; puzzleP2.solved = false;
    timerEl.textContent = "Waktu: 00:00";
}
