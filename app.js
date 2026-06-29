// --- STATE & KONFIGURASI GLOBAL ---
let currentMode = 'single'; // 'single' atau 'multi'
let isCameraActive = false;
let gameActive = false;
let startTime = null;
let timerInterval = null;

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
        p1Label.textContent = "Pemain 1 (Tangan Kiri)";
    } else {
        player2Side.classList.add("hidden");
        p1Label.textContent = "Pemain Wajahmu";
    }
    
    await startAIEngine();
});

btnBack.addEventListener("click", () => {
    stopGameAndTimer();
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
    // Setup Ukuran Canvas Awal
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

    // Inisialisasi Objek Hands dari CDN MediaPipe yang dimuat di HTML
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

    // Jalankan Loop Kamera Otomatis
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
    
    // Trigger simulasi potongan gambar awal wajah
    setupInitialDummyPuzzle();
}

// --- CORE GAME ENGINE (LOGIKA PUZZLE) ---
function setupInitialDummyPuzzle() {
    // Generate kepingan kosong/acak sementara sebelum di-capture real
    puzzleP1.solved = false;
    puzzleP2.solved = false;
    // Di sini nanti bisa dikembangkan fungsi slice objek gambar webcam
}

// Menghitung jarak Euclidean antar titik landmark tangan
function getDistance(pt1, pt2) {
    return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y);
}

// --- PROSES HASIL DETEKSI AI ---
function onHandResults(results) {
    if (!gameActive) return;

    // Bersihkan Canvas tiap frame
    ctxP1.clearRect(0, 0, canvasP1.width, canvasP1.height);
    ctxP2.clearRect(0, 0, canvasP2.width, canvasP2.height);

    // Selalu gambar feed video mentah di background canvas sebagai cermin wajah
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

    // Jika ada tangan terdeteksi di kamera
    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
            const classification = results.multiHandedness[index];
            const isLeftHand = classification.label === 'Left'; // Deteksi Tangan Kiri/Kanan

            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];

            // Cek status gestur Pinch (mencubit)
            const pinchDistance = getDistance(thumbTip, indexTip);
            const isPinching = pinchDistance < PINCH_THRESHOLD;

            // Alokasikan aksi berdasarkan mode game
            if (currentMode === 'single') {
                // Mode Single: Tangan mana saja mengontrol Board P1
                drawHandIndicator(ctxP1, indexTip, isPinching);
                checkPuzzleInteraction(puzzleP1, indexTip, isPinching);
            } else {
                // Mode Multiplayer Split-Screen: 
                // Tangan Kanan asli (di cermin jadi Kiri) -> Mengontrol P1
                // Tangan Kiri asli (di cermin jadi Kanan) -> Mengontrol P2
                if (!isLeftHand) {
                    drawHandIndicator(ctxP1, indexTip, isPinching);
                    checkPuzzleInteraction(puzzleP1, indexTip, isPinching);
                } else {
                    drawHandIndicator(ctxP2, indexTip, isPinching);
                    checkPuzzleInteraction(puzzleP2, indexTip, isPinching);
                }
            }
        });
    }
}

// Menggambar lingkaran indikator di ujung jari telunjuk
function drawHandIndicator(ctx, tip, isPinching) {
    // Konversi koordinat normalisasi (0-1) ke ukuran pixel canvas
    const cx = (1 - tip.x) * ctx.canvas.width; // Efek Mirroring
    const cy = tip.y * ctx.canvas.height;

    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
    ctx.fillStyle = isPinching ? "#00ffcc" : "#fca311";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
}

function checkPuzzleInteraction(puzzleObj, tip, isPinching) {
    if (!isPinching) return;
    // Logika penukaran kepingan geser berdasarkan posisi kursor jari telunjuk
    // Ini area bebas kamu buat kustom algoritma geser ke depannya, Ki!
}
