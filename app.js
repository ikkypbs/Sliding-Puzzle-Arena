// --- STATE & KONFIGURASI GLOBAL ---
let currentMode = 'single'; // 'single' atau 'multi'
let isCameraActive = false;
let gameActive = false;
let startTime = null;
let timerInterval = null;
let isCaptured = false; // Menandai apakah foto wajah sudah diambil

// Konfigurasi Grid Puzzle 3x3
const GRID_SIZE = 3;
let puzzleP1 = { pieces: [], solved: false };
let puzzleP2 = { pieces: [], solved: false };

// Pemetaan Indeks Jari Berdasarkan Dokumentasi Resmi MediaPipe (image_a0f4c5.jpg)
const LM = {
    THUMB_TIP: 4,
    INDEX_TIP: 8
};

const PINCH_THRESHOLD = 0.045; // Jarak sensitivitas cubitan jari
const SNAP_DISTANCE = 40;     // Toleransi magnet kepingan mengunci otomatis (dalam pixel)

// Tracker Drag & Drop untuk masing-masing board pemain
let dragP1 = { active: false, piece: null, offsetX: 0, offsetY: 0 };
let dragP2 = { active: false, piece: null, offsetX: 0, offsetY: 0 };

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

// --- INTERAKSI MENU & LAYAR ---
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
    resetAppState(); 
    gameScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
});

// --- TIMER LOGIC ---
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

// --- INITIALIZE MEDIAPIPE HANDS & CAMERA ---
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
        alert("Gagal mengakses kamera: " + err.message);
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
        onFrame: async () => {
            await hands.send({ image: videoEl });
        },
        width: 640,
        height: 480
    });
    
    camera.start();
    startTimer();
    gameActive = true;
}

// Menghitung jarak matematika antar ujung jempol dan telunjuk
function getDistance(pt1, pt2) {
    return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y);
}

// --- PROSES REALTIME AI FRAME TRACKING ---
function onHandResults(results) {
    if (!gameActive) return;

    ctxP1.clearRect(0, 0, canvasP1.width, canvasP1.height);
    ctxP2.clearRect(0, 0, canvasP2.width, canvasP2.height);

    // Tampilkan feed kamera mentah sebelum di-screenshot/capture
    if (!isCaptured) {
        ctxP1.save();
        ctxP1.translate(canvasP1.width, 0);
        ctxP1.scale(-1, 1);
        ctxP1.drawImage(videoEl, 0, 0, canvasP1.width, canvasP1.height);
        ctxP1.restore();

        if (currentMode === 'multi') {
            ctxP2.save();
            ctxP2.translate(canvasP2.width, 0);
            ctxP2.scale(-1, 1);
            ctxP2.drawImage(videoEl, 0, 0, canvasP2.width, canvasP2.height);
            ctxP2.restore();
        }
    } else {
        // Tampilkan arena kepingan puzzle wajah jika sudah ter-capture
        drawBoardAndPieces();
    }

    let pinchingHandsCount = 0;
    let p1HasHand = false;
    let p2HasHand = false;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
            const classification = results.multiHandedness[index];
            const isLeftHand = classification.label === 'Left';

            // Ambil titik koordinat nomor 4 dan 8 berdasarkan dokumentasi Google
            const thumbTip = landmarks[LM.THUMB_TIP];
            const indexTip = landmarks[LM.INDEX_TIP];

            const pinchDistance = getDistance(thumbTip, indexTip);
            const isPinching = pinchDistance < PINCH_THRESHOLD;

            if (isPinching) pinchingHandsCount++;

            if (isCaptured) {
                if (currentMode === 'single') {
                    p1HasHand = true;
                    drawHandIndicator(ctxP1, indexTip, isPinching);
                    handleDragLogic(puzzleP1, dragP1, canvasP1, indexTip, isPinching);
                } else {
                    // Multiplayer Split Screen
                    if (!isLeftHand) { // Tangan Kanan asli -> Mengontrol P1
                        p1HasHand = true;
                        drawHandIndicator(ctxP1, indexTip, isPinching);
                        handleDragLogic(puzzleP1, dragP1, canvasP1, indexTip, isPinching);
                    } else { // Tangan Kiri asli -> Mengontrol P2
                        p2HasHand = true;
                        drawHandIndicator(ctxP2, indexTip, isPinching);
                        handleDragLogic(puzzleP2, dragP2, canvasP2, indexTip, isPinching);
                    }
                }
            } else {
                drawHandIndicator(ctxP1, indexTip, isPinching);
                if (currentMode === 'multi') drawHandIndicator(ctxP2, indexTip, isPinching);
            }
        });
    }

    // Reset status drag secara paksa jika tangan keluar dari jangkauan kamera
    if (isCaptured) {
        if (currentMode === 'single' && !p1HasHand) {
            dragP1.active = false; dragP1.piece = null;
        } else if (currentMode === 'multi') {
            if (!p1HasHand) { dragP1.active = false; dragP1.piece = null; }
            if (!p2HasHand) { dragP2.active = false; dragP2.piece = null; }
        }
    }

    // LOGIKA TRIGGER SCREENSHOT WAJAH
    if (!isCaptured && (
        (currentMode === 'single' && pinchingHandsCount >= 1) || 
        (currentMode === 'multi' && pinchingHandsCount === 2)
    )) {
        captureWajahDanBikinPuzzle();
    }
}

function drawHandIndicator(ctx, tip, isPinching) {
    const cx = (1 - tip.x) * ctx.canvas.width; // Efek Mirroring agar sinkron
    const cy = tip.y * ctx.canvas.height;

    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, 2 * Math.PI);
    ctx.fillStyle = isPinching ? "#00ffcc" : "#fca311"; // Warna cyan saat mencubit, oranye saat lepas
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
}

// --- PEMOTONGAN GAMBAR WAJAH REALTIME ---
function captureWajahDanBikinPuzzle() {
    isCaptured = true;
    
    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = canvasP1.width;
    snapshotCanvas.height = canvasP1.height;
    const snapCtx = snapshotCanvas.getContext("2d");
    
    snapCtx.translate(snapshotCanvas.width, 0);
    snapCtx.scale(-1, 1);
    snapCtx.drawImage(videoEl, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
    
    sliceImageIntoPuzzle(puzzleP1, snapshotCanvas);
    
    if (currentMode === 'multi') {
        sliceImageIntoPuzzle(puzzleP2, snapshotCanvas);
    }
}

function sliceImageIntoPuzzle(puzzleObj, srcCanvas) {
    const tileW = srcCanvas.width / GRID_SIZE;
    const tileH = srcCanvas.height / GRID_SIZE;
    puzzleObj.pieces = [];
    puzzleObj.solved = false;
    
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const pieceCanvas = document.createElement("canvas");
            pieceCanvas.width = tileW;
            pieceCanvas.height = tileH;
            
            pieceCanvas.getContext("2d").drawImage(
                srcCanvas,
                col * tileW, row * tileH, tileW, tileH,
                0, 0, tileW, tileH
            );
            
            // Pengacakan posisi awal kepingan secara merata di dalam kanvas
            const randX = Math.random() * (srcCanvas.width - tileW);
            const randY = Math.random() * (srcCanvas.height - tileH);

            puzzleObj.pieces.push({
                correctX: col * tileW,
                correctY: row * tileH,
                x: randX,
                y: randY,
                w: tileW,
                h: tileH,
                canvas: pieceCanvas,
                isLocked: false
            });
        }
    }
}

// --- TEKNOLOGI DRAG & DROP SERET JARI ES6 ---
function handleDragLogic(puzzleObj, dragTrack, canvasObj, tip, isPinching) {
    if (puzzleObj.solved) return;

    // Hitung posisi piksel ujung kursor jari di canvas
    const cx = (1 - tip.x) * canvasObj.width;
    const cy = tip.y * canvasObj.height;

    if (isPinching) {
        // Jika status mencubit aktif dan belum mengambil kepingan
        if (!dragTrack.active) {
            // Deteksi kepingan mana yang berada di dalam area cubitan jari telunjuk kamu
            const target = [...puzzleObj.pieces].reverse().find(p => 
                !p.isLocked && cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h
            );

            if (target) {
                dragTrack.active = true;
                dragTrack.piece = target;
                dragTrack.offsetX = cx - target.x;
                dragTrack.offsetY = cy - target.y;
            }
        } else if (dragTrack.piece) {
            // Hubungkan koordinat kepingan agar bergerak serempak mengikuti geseran jari kamu
            dragTrack.piece.x = cx - dragTrack.offsetX;
            dragTrack.piece.y = cy - dragTrack.offsetY;
            
            // Batasi pergerakan kepingan agar tidak bisa keluar dari kotak papan game
            dragTrack.piece.x = Math.max(0, Math.min(canvasObj.width - dragTrack.piece.w, dragTrack.piece.x));
            dragTrack.piece.y = Math.max(0, Math.min(canvasObj.height - dragTrack.piece.h, dragTrack.piece.y));
        }
    } else {
        // Jika cubitan jari dilepas (Drop)
        if (dragTrack.active && dragTrack.piece) {
            const p = dragTrack.piece;
            const distanceToCorrect = Math.hypot(p.x - p.correctX, p.y - p.correctY);

            // Jika posisi kepingan sudah didekatkan ke area koordinat aslinya, auto mengunci (Snap)
            if (distanceToCorrect < SNAP_DISTANCE) {
                p.x = p.correctX;
                p.y = p.correctY;
                p.isLocked = true; // Kunci kepingan secara permanen
                checkWinCondition(puzzleObj);
            }
            dragTrack.active = false;
            dragTrack.piece = null;
        }
    }
}

function drawBoardAndPieces() {
    // Desain latar belakang board arena hitam legam modern
    ctxP1.fillStyle = "#111215";
    ctxP1.fillRect(0, 0, canvasP1.width, canvasP1.height);

    // Render kepingan P1 (kepingan yang sedang di-drag selalu digambar paling atas)
    const sortedP1 = [...puzzleP1.pieces].sort((a, b) => (a === dragP1.piece ? 1 : 0) - (b === dragP1.piece ? 1 : 0));
    sortedP1.forEach(piece => {
        ctxP1.drawImage(piece.canvas, piece.x, piece.y);
        ctxP1.strokeStyle = piece.isLocked ? "rgba(0, 255, 204, 0.85)" : "rgba(255, 255, 255, 0.2)";
        ctxP1.lineWidth = piece === dragP1.piece ? 3 : 1.5;
        ctxP1.strokeRect(piece.x, piece.y, piece.w, piece.h);
    });

    if (puzzleP1.solved) {
        ctxP1.fillStyle = "rgba(0, 255, 204, 0.25)";
        ctxP1.fillRect(0, 0, canvasP1.width, canvasP1.height);
        ctxP1.font = "bold 26px sans-serif";
        ctxP1.fillStyle = "#fff";
        ctxP1.textAlign = "center";
        ctxP1.fillText("PUZZLE SELESAI!", canvasP1.width / 2, canvasP1.height / 2);
    }

    // Render P2 (Multiplayer Side)
    if (currentMode === 'multi' && puzzleP2.pieces.length > 0) {
        ctxP2.fillStyle = "#111215";
        ctxP2.fillRect(0, 0, canvasP2.width, canvasP2.height);

        const sortedP2 = [...puzzleP2.pieces].sort((a, b) => (a === dragP2.piece ? 1 : 0) - (b === dragP2.piece ? 1 : 0));
        sortedP2.forEach(piece => {
            ctxP2.drawImage(piece.canvas, piece.x, piece.y);
            ctxP2.strokeStyle = piece.isLocked ? "rgba(252, 163, 17, 0.85)" : "rgba(255, 255, 255, 0.2)";
            ctxP2.lineWidth = piece === dragP2.piece ? 3 : 1.5;
            ctxP2.strokeRect(piece.x, piece.y, piece.w, piece.h);
        });

        if (puzzleP2.solved) {
            ctxP2.fillStyle = "rgba(252, 163, 17, 0.25)";
            ctxP2.fillRect(0, 0, canvasP2.width, canvasP2.height);
            ctxP2.font = "bold 26px sans-serif";
            ctxP2.fillStyle = "#fff";
            ctxP2.textAlign = "center";
            ctxP2.fillText("PUZZLE SELESAI!", canvasP2.width / 2, canvasP2.height / 2);
        }
    }
}

function checkWinCondition(puzzleObj) {
    const isWin = puzzleObj.pieces.every(piece => piece.isLocked);
    if (isWin) {
        puzzleObj.solved = true;
        if (currentMode === 'single' || (puzzleP1.solved && puzzleP2.solved)) {
            clearInterval(timerInterval);
        }
    }
}

function resetAppState() {
    isCaptured = false;
    puzzleP1.pieces = [];
    puzzleP1.solved = false;
    puzzleP2.pieces = [];
    puzzleP2.solved = false;
    dragP1 = { active: false, piece: null, offsetX: 0, offsetY: 0 };
    dragP2 = { active: false, piece: null, offsetX: 0, offsetY: 0 };
    timerEl.textContent = "Waktu: 00:00";
}
