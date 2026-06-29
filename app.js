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

// Pemetaan Indeks Jari Berdasarkan Dokumentasi Resmi MediaPipe (image_a0f4c5.jpg)
const LM = {
    WRIST: 0,
    THUMB_TIP: 4,
    INDEX_MCP: 5,
    INDEX_TIP: 8,
    MIDDLE_MCP: 9,
    MIDDLE_TIP: 12,
    RING_MCP: 13,
    RING_TIP: 16,
    PINKY_MCP: 17,
    PINKY_TIP: 20
};

const PINCH_THRESHOLD = 0.055; // Ambang batas jarak pinch (normalisasi)
const FRAME_PADDING = 28;      // Padding untuk bingkai capture
const COUNTDOWN_SECONDS = 3;   // Durasi hitung mundur capture
const FIST_HOLD_FRAMES = 12;   // Durasi menahan kepalan tangan (frame)
const SNAP_DISTANCE = 35;     // Toleransi magnet kepingan mengunci otomatis (pixel)

// State Pelacakan Drag masing-masing board
let dragP1 = { active: false, piece: null, offsetX: 0, offsetY: 0 };
let dragP2 = { active: false, piece: null, offsetX: 0, offsetY: 0 };

// Hubungan koneksi jari tangan untuk visualisasi skeleton (berdasarkan image_a0f4c5.jpg)
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],     // Ibu Jari
    [0, 5], [5, 6], [6, 7], [7, 8],     // Telunjuk
    [5, 9], [9, 10], [10, 11], [11, 12],// Jari Tengah
    [9, 13], [13, 14], [14, 15], [15, 16],// Jari Manis
    [13, 17], [17, 18], [18, 19], [19, 20],// Jari Kelingking
    [0, 17]                             // Telapak bawah
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
const ctxP1 = canvasP1.getContext("2d");
const canvasP2 = document.getElementById("canvas-p2");
const ctxP2 = canvasP2.getContext("2d");

const countdownDiv = document.getElementById("countdown");

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
    countdownDiv.classList.add("hidden");
}

// --- INITIALIZE MEDIAPIPE HANDS & CAMERA ---
async function startAIEngine() {
    // Setup Ukuran Canvas (Pemandangan)
    canvasP1.width = 400;
    canvasP1.height = 400;
    canvasP2.width = 400;
    canvasP2.height = 400;

    // Ambil Akses Webcam
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

    // Inisialisasi MediaPipe Hands dari CDN
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

    // Loop Kamera
    const camera = new Camera(videoEl, {
        onFrame: async () => {
            await hands.send({ image: videoEl });
        },
        width: 640,
        height: 480
    });
    
    camera.start();
    gameActive = true;
}

// Menghitung jarak matematika Euclidean
function getDistance(pt1, pt2) {
    return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y);
}

// --- CORE AI PROCESSOR & GAME LOOP ---
function onHandResults(results) {
    if (!gameActive) return;

    ctxP1.clearRect(0, 0, canvasP1.width, canvasP1.height);
    ctxP2.clearRect(0, 0, canvasP2.width, canvasP2.height);

    // Tampilkan feed video mentah sebelum wajah ter-capture
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
        // Tampilkan kepingan puzzle jika wajah sudah ter-capture
        drawBoardAndPieces();
    }

    if (results.multiHandLandmarks && results.multiHandedness) {
        let pinchingHandsCount = 0;
        let p1HandActive = false;
        let p2HandActive = false;

        results.multiHandLandmarks.forEach((landmarks, index) => {
            const classification = results.multiHandedness[index];
            const isLeftHand = classification.label === 'Left';

            // Ambil titik THUMB_TIP (4) dan INDEX_TIP (8) berdasarkan diagram image_a0f4c5.jpg
            const thumbTip = landmarks[LM.THUMB_TIP];
            const indexTip = landmarks[LM.INDEX_TIP];

            const pinchDistance = getDistance(thumbTip, indexTip);
            const isPinching = pinchDistance < PINCH_THRESHOLD;

            if (isPinching) pinchingHandsCount++;

            if (isCaptured) {
                if (currentMode === 'single') {
                    p1HandActive = true;
                    // Visualisasikan skeleton tangan akurat di board
                    drawHandSkeleton(ctxP1, landmarks, isPinching);
                    handleDragLogic(puzzleP1, dragP1, canvasP1, indexTip, isPinching);
                } else {
                    // Multiplayer Split Screen
                    if (!isLeftHand) { // Tangan Kanan asli -> mengontrol P1
                        p1HandActive = true;
                        drawHandSkeleton(ctxP1, landmarks, isPinching);
                        handleDragLogic(puzzleP1, dragP1, canvasP1, indexTip, isPinching);
                    } else { // Tangan Kiri asli -> mengontrol P2
                        p2HandActive = true;
                        drawHandSkeleton(ctxP2, landmarks, isPinching);
                        handleDragLogic(puzzleP
