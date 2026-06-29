// --- STATE & KONFIGURASI GLOBAL ---
let currentMode = 'single'; // 'single' atau 'multi'
let isCameraActive = false;
let gameActive = false;
let startTime = null;
let timerInterval = null;
let isCaptured = false; // Menandai apakah foto wajah sudah diambil

// Konfigurasi Grid Puzzle 3x3
const GRID_SIZE = 3;
let puzzleP1 = { pieces: [], solved: false, boardBox: null };
let puzzleP2 = { pieces: [], solved: false, boardBox: null };

// Ambang batas jarak untuk pinch/mencubit (antara ujung jempol & telunjuk)
const PINCH_THRESHOLD = 0.06; 

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
    resetAppState(); // Reset status game agar bisa capture ulang nanti
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
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
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

// Menghitung jarak Euclidean antar titik landmark tangan
function getDistance(pt1, pt2) {
    return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y);
}

// --- PROSES HASIL DETEKSI AI ---
function onHandResults(results) {
    if (!gameActive) return;

    ctxP1.clearRect(0, 0, canvasP1.width, canvasP1.height);
    ctxP2.clearRect(0, 0, canvasP2.width, canvasP2.height);

    // Jika belum melakukan jepretan foto, tampilkan live video di canvas
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
        // Jika sudah di-screenshot, kunci gambar latar belakang menjadi kepingan puzzle
        drawBoardAndPieces();
    }

    if (results.multiHandLandmarks && results.multiHandedness) {
        let pinchingHandsCount = 0;

        results.multiHandLandmarks.forEach((landmarks, index) => {
            const classification = results.multiHandedness[index];
            const isLeftHand = classification.label === 'Left';

            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];

            const pinchDistance = getDistance(thumbTip, indexTip);
            const isPinching = pinchDistance < PINCH_THRESHOLD;

            if (isPinching) pinchingHandsCount++;

            if (isCaptured) {
                if (currentMode === 'single') {
                    drawHandIndicator(ctxP1, indexTip, isPinching);
                    checkPuzzleInteraction(puzzleP1, indexTip, isPinching);
                } else {
                    if (!isLeftHand) {
                        drawHandIndicator(ctxP1, indexTip, isPinching);
                        checkPuzzleInteraction(puzzleP1, indexTip, isPinching);
                    } else {
                        drawHandIndicator(ctxP2, indexTip, isPinching);
                        checkPuzzleInteraction(puzzleP2, indexTip, isPinching);
                    }
                }
            } else {
                drawHandIndicator(ctxP1, indexTip, isPinching);
                if (currentMode === 'multi') drawHandIndicator(ctxP2, indexTip, isPinching);
            }
        });

        // LOGIKA DETEKSI JEPRET: 
        // Singleplayer = Cukup 1 tangan pinch untuk ambil foto wajah
        // Multiplayer = Butuh 2 tangan pinch bersamaan untuk mulai balapan
        if (!isCaptured && (
            (currentMode === 'single' && pinchingHandsCount >= 1) || 
            (currentMode === 'multi' && pinchingHandsCount === 2)
        )) {
            captureWajahDanBikinPuzzle();
        }
    }
}

// Menggambar lingkaran indikator di ujung jari telunjuk
function drawHandIndicator(ctx, tip, isPinching) {
    const cx = (1 - tip.x) * ctx.canvas.width; 
    const cy = tip.y * ctx.canvas.height;

    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
    ctx.fillStyle = isPinching ? "#00ffcc" : "#fca311";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
}

// --- CORE GAME ENGINE (LOGIKA SNAPSHOT & SLICE IMAGE) ---
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
            
            puzzleObj.pieces.push({
                correctRow: row,
                correctCol: col,
                currentRow: row,
                currentCol: col,
                canvas: pieceCanvas
            });
        }
    }
    
    shufflePuzzlePieces(puzzleObj.pieces);
}

function shufflePuzzlePieces(piecesArray) {
    for (let i = piecesArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tempRow = piecesArray[i].currentRow;
        const tempCol = piecesArray[i].currentCol;
        
        piecesArray[i].currentRow = piecesArray[j].currentRow;
        piecesArray[i].currentCol = piecesArray[j].currentCol;
        
        piecesArray[j].currentRow = tempRow;
        piecesArray[j].currentCol = tempCol;
    }
}

function drawBoardAndPieces() {
    const tileW = canvasP1.width / GRID_SIZE;
    const tileH = canvasP1.height / GRID_SIZE;

    puzzleP1.pieces.forEach(piece => {
        const dx = piece.currentCol * tileW;
        const dy = piece.currentRow * tileH;
        ctxP1.drawImage(piece.canvas, dx, dy);
        ctxP1.strokeStyle = "rgba(0, 255, 204, 0.4)";
        ctxP1.lineWidth = 1.5;
        ctxP1.strokeRect(dx, dy, tileW, tileH);
    });

    if (currentMode === 'multi' && puzzleP2.pieces.length > 0) {
        puzzleP2.pieces.forEach(piece => {
            const dx = piece.currentCol * tileW;
            const dy = piece.currentRow * tileH;
            ctxP2.drawImage(piece.canvas, dx, dy);
            ctxP2.strokeStyle = "rgba(252, 163, 17, 0.4)";
            ctxP2.lineWidth = 1.5;
            ctxP2.strokeRect(dx, dy, tileW, tileH);
        });
    }
}

function checkPuzzleInteraction(puzzleObj, tip, isPinching) {
    if (!isPinching) return;
    // Area kustomisasi interaksi pergeseran potongan puzzle
}

function resetAppState() {
    isCaptured = false;
    puzzleP1.pieces = [];
    puzzleP2.pieces = [];
}
