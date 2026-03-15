// --- DANH SÁCH NGÔN NGỮ (BCP-47) ---
const supportedLanguages = [
    { code: "af-ZA", name: "Afrikaans" },
    { code: "ar-SA", name: "Arabic (Saudi Arabia)" },
    { code: "bg-BG", name: "Bulgarian" },
    { code: "cs-CZ", name: "Czech" },
    { code: "da-DK", name: "Danish" },
    { code: "de-DE", name: "German (Germany)" },
    { code: "el-GR", name: "Greek" },
    { code: "en-US", name: "English (United States)" },
    { code: "en-GB", name: "English (United Kingdom)" },
    { code: "es-ES", name: "Spanish (Spain)" },
    { code: "fi-FI", name: "Finnish" },
    { code: "fr-FR", name: "French (France)" },
    { code: "he-IL", name: "Hebrew" },
    { code: "hi-IN", name: "Hindi" },
    { code: "id-ID", name: "Indonesian" },
    { code: "it-IT", name: "Italian (Italy)" },
    { code: "ja-JP", name: "Japanese" },
    { code: "ko-KR", name: "Korean" },
    { code: "nl-NL", name: "Dutch" },
    { code: "pl-PL", name: "Polish" },
    { code: "pt-BR", name: "Portuguese (Brazil)" },
    { code: "pt-PT", name: "Portuguese (Portugal)" },
    { code: "ru-RU", name: "Russian" },
    { code: "sv-SE", name: "Swedish" },
    { code: "th-TH", name: "Thai" },
    { code: "tr-TR", name: "Turkish" },
    { code: "uk-UA", name: "Ukrainian" },
    { code: "vi-VN", name: "Vietnamese" },
    { code: "zh-CN", name: "Chinese (Mandarin, Simplified)" },
    { code: "zh-TW", name: "Chinese (Mandarin, Traditional)" }
];
const langSelect = document.getElementById('langSelect');
supportedLanguages.forEach(lang => {
    let option = document.createElement('option');
    option.value = lang.code;
    option.textContent = `${lang.name} (${lang.code})`;
    if(lang.code === "ru-RU") option.selected = true; 
    langSelect.appendChild(option);
});

const mediaUpload = document.getElementById('mediaUpload');
const srtUpload = document.getElementById('srtUpload');
const video = document.getElementById('videoPlayer');
const subtitleBox = document.getElementById('subtitleBox');
const recordBtn = document.getElementById('recordBtn');
const resultBox = document.getElementById('resultBox');
// Các element mới
const speedSelect = document.getElementById('speedSelect');
const loopCheckbox = document.getElementById('loopCheckbox');

const userTextEl = document.getElementById('userText');
const accuracyScoreEl = document.getElementById('accuracyScoreEl');
const speedScoreEl = document.getElementById('speedScoreEl');
const totalScoreEl = document.getElementById('totalScoreEl');
const feedbackText = document.getElementById('feedbackText');
const historyTableBody = document.querySelector('#historyTable tbody');

// Biến lưu trữ điểm chi tiết của câu hiện tại
let currentScores = { accuracy: 0, speed: 0, total: 0 };

let subtitles = [];
let currentSubId = null;
let currentTargetText = ""; 
let currentExpectedDuration = 0; 
let subStartTimeRender = 0;      

let lastUserText = ""; 
let lastScore = 0;
let audioStream;
let mediaRecorder;
let audioChunks = [];
let currentAudioBlobUrl = null;

// --- CÁC BIẾN CHO THUẬT TOÁN BLOCK ĐÀN HỒI ---
const chunkTimeSelect = document.getElementById('chunkTimeSelect');

// Đọc giá trị từ localStorage nếu có, nếu không thì lấy mặc định là 15
let CHUNK_TIME = parseInt(localStorage.getItem('shadowing_chunk_time')) || 15;
if (chunkTimeSelect) {
    chunkTimeSelect.value = CHUNK_TIME; // Cập nhật UI khớp với bộ nhớ
}

const OVERLAP_TIME = 7; // Vùng đệm bù trừ đọc chậm
let currentChunkIndex = 0; 
let completeTranscript = ""; 
let currentInterim = ""; 
let lastEvaluatedLength = 0; 

let globalAudioBlob = null;
// Lắng nghe khi người dùng thay đổi thời gian cắt Block
if (chunkTimeSelect) {
    chunkTimeSelect.addEventListener('change', (e) => {
        CHUNK_TIME = parseInt(e.target.value);
        localStorage.setItem('shadowing_chunk_time', CHUNK_TIME); // Lưu lại cho lần sau
        
        // Cập nhật lại ngay lập tức vị trí Block hiện tại để video không bị loạn nếu đổi giữa chừng
        if (video) {
            currentChunkIndex = Math.floor(video.currentTime / CHUNK_TIME);
        }
        
        // Reset bảng điểm tạm
        if (accuracyScoreEl) accuracyScoreEl.innerText = "0";
        if (speedScoreEl) speedScoreEl.innerText = "0";
        if (totalScoreEl) totalScoreEl.innerText = "0";
        if (feedbackText) feedbackText.innerText = `Đã đổi sang mốc ${CHUNK_TIME} giây...`;
    });
}
// Hàm khởi tạo Micro song song cho cả Nhận diện & Ghi âm
async function initMicStream() {
    if (!audioStream) {
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error("Không cấp quyền Mic: ", err);
        }
    }
}
// --- ĐIỀU KHIỂN VIDEO (Tốc độ & Lặp lại) ---
speedSelect.addEventListener('change', (e) => {
    video.playbackRate = parseFloat(e.target.value);
});

loopCheckbox.addEventListener('change', (e) => {
    video.loop = e.target.checked;
});

// --- XỬ LÝ TẢI FILE MEDIA (VIDEO/AUDIO) ---
mediaUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        video.src = URL.createObjectURL(file);
        video.playbackRate = parseFloat(speedSelect.value); 
        checkReadyState();
    }
});

srtUpload.addEventListener('change', (e) => {
    if (e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (event) => {
            subtitles = parseSRT(event.target.result);
            if(subtitles.length === 0) alert("Không tìm thấy phụ đề hợp lệ trong file này!");
            checkReadyState();
        };
        reader.readAsText(e.target.files[0]);
    }
});

function checkReadyState() {
    if (video.src && subtitles.length > 0) {
        subtitleBox.innerHTML = "<em>Sẵn sàng! Hãy nhấn 'Bắt đầu đọc'.</em>";
        if (window.SpeechRecognition || window.webkitSpeechRecognition) recordBtn.disabled = false;
    }
}

// --- HÀM ĐỌC SRT BỌC THÉP (BẤT CHẤP AI GÕ LỖI) ---
function parseSRT(data) {
    // Chuẩn hóa mọi kiểu xuống dòng về \n
    const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Tách văn bản thành các khối phụ đề dựa trên các khoảng trắng lớn (2 lần xuống dòng trở lên)
    const blocks = normalized.split(/\n{2,}/); 
    let result = [];
    let idCounter = 1; // Hệ thống tự động đếm số thứ tự thay cho AI

    blocks.forEach(block => {
        const lines = block.trim().split('\n');
        if (lines.length === 0 || lines[0] === '') return;

        // Quét từng dòng để tìm dòng chứa mũi tên thời gian (--> hoặc ->)
        let timeLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('-->') || lines[i].includes('->')) {
                timeLineIndex = i;
                break;
            }
        }

        if (timeLineIndex !== -1) {
            const timecodes = lines[timeLineIndex].split(/-{1,2}>/);
            const startSec = timeToSeconds(timecodes[0]);
            const endSec = timeToSeconds(timecodes[1]);

            // Gom tất cả các dòng nằm bên dưới dòng thời gian làm nội dung phụ đề
            const text = lines.slice(timeLineIndex + 1).join(' ').trim();

            if (!isNaN(startSec) && !isNaN(endSec) && text) {
                result.push({
                    id: idCounter++, // Tự gắn ID luôn
                    start: startSec,
                    end: endSec,
                    text: text
                });
            }
        }
    });
    return result;
}

// --- HÀM CHUYỂN ĐỔI THỜI GIAN THÔNG MINH ---
function timeToSeconds(timeString) {
    // Dùng Regex nhặt TẤT CẢ các con số ra, mặc kệ AI dùng dấu : hay dấu , hay dấu .
    const nums = timeString.match(/\d+/g);
    if (!nums) return NaN;
    
    let h = 0, m = 0, s = 0, ms = 0;
    
    if (nums.length === 4) { 
        // Đủ 4 bộ số: Giờ, Phút, Giây, MiliGiây (Chuẩn SRT)
        h = parseInt(nums[0]);
        m = parseInt(nums[1]);
        s = parseInt(nums[2]);
        ms = parseInt(nums[3]);
    } else if (nums.length === 3) { 
        // 3 bộ số: Phút, Giây, MiliGiây (Trường hợp AI rút gọn như 00:04:715 của bạn)
        m = parseInt(nums[0]);
        s = parseInt(nums[1]);
        ms = parseInt(nums[2]);
    } else if (nums.length === 2) { 
        // 2 bộ số: Giây, MiliGiây
        s = parseInt(nums[0]);
        ms = parseInt(nums[1]);
    }
    
    return (h * 3600) + (m * 60) + s + (ms / 1000);
}



// --- THUẬT TOÁN ĐÁNH GIÁ THEO BLOCK THỜI GIAN (15s) ---

// Hàm phụ trợ đổi giây thành định dạng Phút:Giây (VD: 01:15)
// --- THUẬT TOÁN ĐÁNH GIÁ THEO BLOCK THỜI GIAN (ĐÀN HỒI) ---
function formatTimeRange(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

video.addEventListener('timeupdate', () => {
    if (subtitles.length === 0) return;
    const time = video.currentTime;

    const activeSub = subtitles.find(sub => time >= sub.start && time <= sub.end);
    if (activeSub) {
        subtitleBox.innerHTML = `<span class="highlight">${activeSub.text}</span>`;
    } else {
        subtitleBox.innerHTML = "<em>...</em>";
    }

    if (!isRecording) return;

    const newChunkIndex = Math.floor(time / CHUNK_TIME);

    if (newChunkIndex > currentChunkIndex) {
        // NGAY KHI VƯỢT QUA MỐC 15 GIÂY -> CHỐT SỔ BLOCK CŨ!
        const startTime = currentChunkIndex * CHUNK_TIME;
        const endTime = newChunkIndex * CHUNK_TIME;

        // A. LẤY CÂU MẪU CÓ VÙNG ĐỆM: Kéo lùi mốc bắt đầu về quá khứ 7 giây
        const safeStartTime = Math.max(0, startTime - OVERLAP_TIME);
        const targetSubs = subtitles.filter(sub => 
            (sub.start >= safeStartTime && sub.start < endTime) || 
            (sub.end > safeStartTime && sub.end <= endTime) ||
            (sub.start <= safeStartTime && sub.end >= endTime)
        );
        const targetText = targetSubs.map(s => s.text).join(' ').trim();

        // B. LẤY CHỮ BẠN ĐỌC: Chụp ảnh toàn bộ văn bản hiện tại (Cả chốt + Nháp)
        const liveTranscript = completeTranscript + currentInterim;
        let userText = "";
        
        // Thuật toán bóc tách chuỗi an toàn chống lỗi của Chrome
        if (liveTranscript.length >= lastEvaluatedLength) {
            userText = liveTranscript.substring(lastEvaluatedLength).trim();
        } else {
            userText = currentInterim.trim(); // Fallback nếu Chrome tự xóa bớt chữ nháp
        }
        
        // Kéo mốc cắt chuỗi lên hiện tại
        lastEvaluatedLength = liveTranscript.length; 

        // C. IN RA BẢNG LỊCH SỬ
        if (targetText.length > 0 || userText.length > 0) {
            const timeLabel = `<b style="color:#2980b9;">[${formatTimeRange(startTime)} - ${formatTimeRange(endTime)}]</b><br>`;
            const scores = calculateAdvancedScore(targetText, userText, 1, 1); 
            
            saveToHistory(timeLabel + (targetText || "(Không có phụ đề)"), userText || "(Không nghe thấy bạn đọc)", scores);
        }

        currentChunkIndex = newChunkIndex;
        
        if (accuracyScoreEl) accuracyScoreEl.innerText = "0";
        if (speedScoreEl) speedScoreEl.innerText = "0";
        if (totalScoreEl) totalScoreEl.innerText = "0";
        if (feedbackText) feedbackText.innerText = `Đang phân tích đoạn mới...`;
    }
});

// Khi tua video
video.addEventListener('seeked', () => {
    currentChunkIndex = Math.floor(video.currentTime / CHUNK_TIME);
    lastEvaluatedLength = (completeTranscript + currentInterim).length; 
    
    if (accuracyScoreEl) accuracyScoreEl.innerText = "0";
    if (speedScoreEl) speedScoreEl.innerText = "0";
    if (totalScoreEl) totalScoreEl.innerText = "0";
});
// --- XỬ LÝ KHI VIDEO KẾT THÚC (ÉP CHỐT SỔ BLOCK CUỐI) ---
video.addEventListener('ended', () => {
    if (!isRecording) return;

    // Tính toán giới hạn của Block cuối cùng (từ mốc trước đó đến hết video)
    const startTime = currentChunkIndex * CHUNK_TIME;
    const endTime = video.duration;

    // Lấy câu gốc
    const safeStartTime = Math.max(0, startTime - OVERLAP_TIME);
    const targetSubs = subtitles.filter(sub => 
        (sub.start >= safeStartTime && sub.start <= endTime) || 
        (sub.end >= safeStartTime && sub.end <= endTime)
    );
    const targetText = targetSubs.map(s => s.text).join(' ').trim();

    // Lấy đoạn chữ bạn vừa đọc
    const liveTranscript = completeTranscript + currentInterim;
    let userText = "";
    if (liveTranscript.length >= lastEvaluatedLength) {
        userText = liveTranscript.substring(lastEvaluatedLength).trim();
    } else {
        userText = currentInterim.trim();
    }

    // In ra bảng lịch sử
    if (targetText.length > 0 || userText.length > 0) {
        const timeLabel = `<b style="color:#2980b9;">[${formatTimeRange(startTime)} - ${formatTimeRange(endTime)}]</b><br>`;
        const scores = calculateAdvancedScore(targetText, userText, 1, 1); 
        saveToHistory(timeLabel + (targetText || "(Không có phụ đề)"), userText || "(Không nghe thấy bạn đọc)", scores);
    }

    // Tự động tắt quá trình thu âm giống như khi bấm nút Dừng
    isRecording = false;
    recognition.stop();
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
    
    document.getElementById('recordBtn').innerText = "🎤 Bắt đầu đọc (Shadowing)";
    document.getElementById('recordBtn').style.background = "#2ecc71";
    subtitleBox.innerHTML = "<em>(Đã kết thúc Video)</em>";
    if (feedbackText) feedbackText.innerText = "Hoàn thành bài luyện tập!";
});

// --- LOGIC NHẬN DIỆN & CHẤM ĐIỂM GIỮ NGUYÊN NHƯ CŨ ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isRecording = false;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        isRecording = true;
        recordBtn.classList.add('recording');
        recordBtn.innerText = "Đang nghe... (Nhấn để dừng)";
    };

// KHAI BÁO BIẾN ĐỂ TRỊ LỖI LƯU LỊCH SỬ NỐI ĐUÔI CỦA TRÌNH DUYỆT
// KHAI BÁO 2 BIẾN MỚI ĐỂ TRỊ LỖI NỐI ĐUÔI
// KHAI BÁO 2 BIẾN "KHÓA CHỐT" ĐỂ TRỊ LỖI NỐI ĐUÔI

// --- NHẬN DIỆN GIỌNG NÓI (TỐI ƯU CHO BLOCK 15S) ---
// --- NHẬN DIỆN GIỌNG NÓI (QUÉT CẢ CHỮ NHÁP) ---
recognition.onresult = (event) => {
    let interim = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            // Thêm dấu cách để các từ không bị dính chùm vào nhau khi Chrome chốt
            completeTranscript += event.results[i][0].transcript + " "; 
        } else {
            interim += event.results[i][0].transcript;
        }
    }
    
    currentInterim = interim;

    // Trộn cả chữ đã chốt và chữ đang nháp để hiển thị realtime
    const liveTranscript = completeTranscript + currentInterim;
    
    let displayStr = "";
    if (liveTranscript.length >= lastEvaluatedLength) {
        displayStr = liveTranscript.substring(lastEvaluatedLength);
    }

    if (userTextEl) userTextEl.innerText = displayStr || "...";
};


    recognition.onerror = (event) => {
        if (event.error !== 'no-speech') {
            console.warn("Lỗi mic:", event.error);
            stopRecording();
        }
    };

    recognition.onend = () => {
        if (isRecording) {
            try { recognition.start(); } catch (e) { stopRecording(); }
        } else stopRecording();
    };
}

function stopRecording() {
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.innerText = "🎤 Bắt đầu đọc (Shadowing)";
}

// Khai báo biến trỏ tới Checkbox
const enableRecordingCheckbox = document.getElementById('enableRecordingCheckbox');

recordBtn.addEventListener('click', async () => {
    if (!video.src) return alert("Vui lòng tải video và phụ đề lên trước!");

    if (recognition) {
        if (isRecording) {
            // --- 1. ÉP CHỐT SỔ ĐOẠN ĐANG ĐỌC DỞ TRƯỚC KHI DỪNG ---
            const startTime = currentChunkIndex * CHUNK_TIME;
            const endTime = video.currentTime; // Chốt đúng tại giây bạn bấm dừng

            // Lấy câu gốc trong khoảng thời gian vừa chạy
            const safeStartTime = Math.max(0, startTime - OVERLAP_TIME);
            const targetSubs = subtitles.filter(sub => 
                (sub.start >= safeStartTime && sub.start <= endTime) || 
                (sub.end >= safeStartTime && sub.end <= endTime) ||
                (sub.start <= safeStartTime && sub.end >= endTime)
            );
            const targetText = targetSubs.map(s => s.text).join(' ').trim();

            // Lấy chữ bạn đã đọc
            const liveTranscript = completeTranscript + currentInterim;
            let userText = "";
            if (liveTranscript.length >= lastEvaluatedLength) {
                userText = liveTranscript.substring(lastEvaluatedLength).trim();
            } else {
                userText = currentInterim.trim();
            }

            // In kết quả ra bảng lịch sử (Chỉ in nếu có chữ gốc hoặc có chữ bạn đọc)
            if (targetText.length > 0 || userText.length > 0) {
                // Nếu hàm formatTimeRange báo lỗi chưa định nghĩa, hãy đảm bảo hàm đó nằm ở đầu file nhé!
                const timeLabel = `<b style="color:#2980b9;">[${formatTimeRange(startTime)} - ${formatTimeRange(endTime)}]</b><br>`;
                const scores = calculateAdvancedScore(targetText, userText, 1, 1); 
                saveToHistory(timeLabel + (targetText || "(Không có phụ đề)"), userText || "(Không nghe thấy bạn đọc)", scores);
            }
            // -----------------------------------------------------

            // --- 2. DỪNG THU ÂM & DỪNG TRÌNH DUYỆT ---
            isRecording = false;
            recognition.stop();
            
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
            video.pause(); 
            
            // Đổi lại giao diện nút
            recordBtn.innerText = "🎤 Bắt đầu đọc (Shadowing)";
            recordBtn.style.background = "#2ecc71";
            if (feedbackText) feedbackText.innerText = "Đã dừng luyện tập!";
        } else {
            // BẮT ĐẦU
            recognition.lang = langSelect.value;
            
            // KIỂM TRA CÔNG TẮC: Chỉ bật MediaRecorder nếu người dùng Check
            if (enableRecordingCheckbox.checked) {
                await initMicStream(); // Yêu cầu quyền mic cho luồng ghi âm file
                if (audioStream) {
                    audioChunks = [];
                    mediaRecorder = new MediaRecorder(audioStream);
                    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
                    mediaRecorder.onstop = () => {
                        globalAudioBlob = new Blob(audioChunks, { type: 'audio/webm' }); // LƯU RA BIẾN TOÀN CỤC ĐỂ GỬI ĐI
                        currentAudioBlobUrl = URL.createObjectURL(globalAudioBlob);
                        
                        const sessionAudioContainer = document.getElementById('sessionAudioContainer');
                        const sessionAudioPlayer = document.getElementById('sessionAudioPlayer');
                        if (sessionAudioContainer && sessionAudioPlayer) {
                            sessionAudioPlayer.src = currentAudioBlobUrl;
                            sessionAudioContainer.style.display = 'block';
                            document.getElementById('aiEvaluateResult').style.display = 'none'; // Ẩn nhận xét cũ đi
                        }
                    };
                    mediaRecorder.start();
                }
            } else {
                // Nếu người dùng tắt ghi âm, đảm bảo dọn dẹp biến tạm
                currentAudioBlobUrl = null;
            }

            // Bật luồng AI nhận diện chữ (luôn chạy)
            recognition.start();
            if (video.paused) video.play();
        }
    }
});


function saveToHistory(targetText, userText, scores) {
    const row = document.createElement('tr');
    let totalClass = scores.total >= 80 ? 'score-high' : (scores.total >= 50 ? 'score-medium' : 'score-low');
    
    // Chỉ in ra chữ và điểm, không in thông báo âm thanh vào từng dòng nữa
    row.innerHTML = `
        <td>${targetText}</td>
        <td>${userText}</td>
        <td>${scores.accuracy}%</td>
        <td>${scores.speed}%</td>
        <td class="${totalClass}">${scores.total}%</td>
    `;
    historyTableBody.prepend(row);
}

function updateLatestHistoryAudio(url) {
    const latestRow = historyTableBody.firstElementChild;
    if (latestRow) {
        const audioContainer = latestRow.querySelector('.audio-container');
        if (audioContainer) {
            audioContainer.innerHTML = `<audio src="${url}" controls class="audio-player"></audio>`;
        }
    }
}


// --- CẬP NHẬT HÀM CHẤM ĐIỂM CHI TIẾT ---
// --- CẬP NHẬT HÀM CHẤM ĐIỂM CHI TIẾT (VÁ LỖI 100%) ---
// --- THUẬT TOÁN CHẤM ĐIỂM BAO DUNG (BỎ QUA TẠP ÂM & ĐỘ TRỄ) ---
function calculateAdvancedScore(targetText, userText, expectedDuration, actualDuration) {
    if (!targetText || !userText || userText === "...") {
        return { accuracy: 0, speed: 0, total: 0, feedback: "Chưa nghe rõ..." };
    }

    // 1. Hàm tách từ thông minh: 
    // - Với tiếng Trung/Nhật: Tách riêng từng chữ (character)
    // - Với tiếng Anh/Nga: Giữ nguyên từng cụm từ (word)
    function tokenize(text) {
        // Xóa dấu câu để so sánh sạch
        const cleanText = text.toLowerCase().replace(/[.,!?;:，。！？；：、"'()[\]\-]/g, ' ');
        // Regex bóc tách: Lấy 1 chữ CJK (Trung/Nhật) HOẶC 1 cụm chữ cái/số (Anh/Nga)
        const tokens = cleanText.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]|[\wа-яё]+/ig);
        return tokens || [];
    }

    const targetTokens = tokenize(targetText);
    const userTokens = tokenize(userText);

    if (targetTokens.length === 0) return { accuracy: 0, speed: 0, total: 0, feedback: "" };
    if (userTokens.length === 0) return { accuracy: 0, speed: 0, total: 0, feedback: "Chưa nghe rõ từ nào..." };

    // 2. THUẬT TOÁN LCS (Longest Common Subsequence)
    // Tìm số lượng từ khớp nhau tối đa theo đúng thứ tự, bất chấp khoảng cách
    let m = targetTokens.length;
    let n = userTokens.length;
    let dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (targetTokens[i - 1] === userTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1; // Nếu khớp, cộng 1 điểm
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); // Nếu không khớp, lấy kết quả tốt nhất trước đó
            }
        }
    }

    const matchCount = dp[m][n]; // Tổng số từ/chữ Hán bạn đọc trúng
    let accuracyScore = Math.min(100, Math.round((matchCount / targetTokens.length) * 100));

    // 3. ĐIỂM TỐC ĐỘ (Vẫn giữ logic cũ nếu bạn cần, hoặc để mặc định 100 cho Block 15s)
    let speedScore = 100; 
    let feedbackMsg = "Tuyệt vời, phát âm rất tốt!";

    if (expectedDuration > 0 && actualDuration > 0 && expectedDuration !== 1) {
        const ratio = actualDuration / expectedDuration;
        if (ratio < 0.7) {
            speedScore -= (0.7 - ratio) * 150; 
            feedbackMsg = "Bạn đang đọc hơi vội!";
        } else if (ratio > 1.3) {
            speedScore -= (ratio - 1.3) * 100; 
            feedbackMsg = "Cố gắng bắt nhịp nhanh hơn nhé!";
        }
        speedScore = Math.max(0, Math.min(100, Math.round(speedScore)));
    }

    let totalScore = Math.round((accuracyScore * 0.7) + (speedScore * 0.3));

    return {
        accuracy: accuracyScore,
        speed: speedScore,
        total: totalScore,
        feedback: feedbackMsg
    };
}
// ==========================================
// --- LOGIC POPUP, KÉO THẢ & TỪ ĐIỂN (HỖ TRỢ MOBILE) ---
// ==========================================
const dictPopup = document.getElementById('dictPopup');
const popupHeader = document.getElementById('popupHeader');
const popupWord = document.getElementById('popupWord');
let selectedWord = "";

// 1. Tính năng Kéo thả (Hỗ trợ cả Chuột và Cảm ứng)
let isDragging = false;
let offsetX = 0, offsetY = 0;

function dragStart(e) {
    if (e.target.tagName === 'BUTTON') return; 
    isDragging = true;
    
    // Lấy tọa độ tùy theo việc đang dùng chuột hay ngón tay
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    
    offsetX = clientX - dictPopup.offsetLeft;
    offsetY = clientY - dictPopup.offsetTop;
}

function dragMove(e) {
    if (!isDragging) return;
    
    // Ngăn chặn màn hình điện thoại bị cuộn khi đang kéo popup
    if (e.type.includes('touch')) e.preventDefault(); 
    
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    
    dictPopup.style.left = `${clientX - offsetX}px`;
    dictPopup.style.top = `${clientY - offsetY}px`;
}

function dragEnd() { isDragging = false; }

// Gắn sự kiện kéo thả cho cả 2 môi trường
popupHeader.addEventListener('mousedown', dragStart);
popupHeader.addEventListener('touchstart', dragStart, { passive: false });

document.addEventListener('mousemove', dragMove);
document.addEventListener('touchmove', dragMove, { passive: false });

document.addEventListener('mouseup', dragEnd);
document.addEventListener('touchend', dragEnd);

// Nút đóng Popup
document.getElementById('closePopupBtn').addEventListener('click', () => {
    dictPopup.style.display = 'none';
});

// 2. Tính năng Bôi đen và Hiện Popup (Hỗ trợ Mobile)
function handleSelection(e) {
    // Nếu click/chạm vào bên trong popup thì bỏ qua (trừ nút đóng)
    if (dictPopup.contains(e.target) && e.target.id !== 'closePopupBtn') return;

    // Trên mobile, cần một độ trễ nhỏ để hệ điều hành hoàn tất việc bôi đen chữ
    setTimeout(() => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text.length > 0 && text.length < 50) {
            selectedWord = text;
            popupWord.innerText = text;
            
            const currentLang = langSelect.value;
            const baseLangCode = currentLang.split('-')[0]; 
            const langName = langSelect.options[langSelect.selectedIndex].text.split(' ')[0]; 
            
            document.getElementById('linkGoogleSearch').href = `https://www.google.com/search?q=${encodeURIComponent('giải thích nghĩa cho người Việt từ vựng '+text + ' của tiếng ' + langName)}`;
            document.getElementById('linkGoogle').href = `https://translate.google.com/?sl=auto&tl=vi&text=${encodeURIComponent(text)}&op=translate`;
            document.getElementById('linkImage').href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(text)}`;
            document.getElementById('linkYandex').href = `https://translate.yandex.com/?source_lang=auto&target_lang=vi&text=${encodeURIComponent(text)}`;
            document.getElementById('linkWiki').href = `https://${baseLangCode}.wiktionary.org/wiki/${encodeURIComponent(text)}`;
            
            if (currentLang === 'ru-RU') {
                document.getElementById('linkVtuDien').href = `https://vtudien.com/nga-viet/dictionary/nghia-cua-tu-${encodeURIComponent(text)}`;
                document.getElementById('linkVtuDien').style.display = 'inline-block';
            } else {
                document.getElementById('linkVtuDien').style.display = 'none';
            }

            // Tính toán tọa độ thông minh: Lấy tọa độ ngón tay hoặc con trỏ chuột
            if (dictPopup.style.display === 'none' || dictPopup.style.display === '') {
                let pageX, pageY;
                if (e.type.includes('mouse')) {
                    pageX = e.pageX;
                    pageY = e.pageY;
                } else {
                    const touch = e.changedTouches ? e.changedTouches[0] : e.touches[0];
                    pageX = touch ? touch.pageX : window.innerWidth / 2;
                    pageY = touch ? touch.pageY : window.innerHeight / 2;
                }

                // THUẬT TOÁN CHỐNG TRÀN MÀN HÌNH TRÊN ĐIỆN THOẠI
                const popupWidth = dictPopup.offsetWidth || 320; 
                if (pageX + popupWidth > window.innerWidth) {
                    pageX = window.innerWidth - popupWidth - 10; // Đẩy lùi lại nếu sắp tràn viền phải
                }
                
                // Căn chỉnh vị trí
                dictPopup.style.left = `${Math.max(10, pageX)}px`; // Không cho tràn viền trái
                dictPopup.style.top = `${pageY + 20}px`;
                dictPopup.style.display = 'block';
            }
            
            document.getElementById('aiResponse').innerText = "Chọn một yêu cầu hoặc tự gõ câu hỏi cho AI...";
            document.getElementById('customAiPrompt').value = "";
        }
    }, 150); // Trễ 150ms để tương thích với menu bôi đen mặc định của iOS/Android
}

// Lắng nghe sự kiện nhả chuột (PC) và nhả tay (Mobile)
document.addEventListener('mouseup', handleSelection);
document.addEventListener('touchend', handleSelection);

// Nghe đọc từ vựng
document.getElementById('ttsBtn').addEventListener('click', () => {
    const utterance = new SpeechSynthesisUtterance(selectedWord);
    utterance.lang = langSelect.value; 
    speechSynthesis.speak(utterance);
});
// ==========================================
// --- GHI NHỚ CẤU HÌNH AI GẦN NHẤT ---
// ==========================================
const aiProviderSelect = document.getElementById('aiProvider');
const aiModelInput = document.getElementById('aiModel');

// 1. Phục hồi cấu hình từ lần học trước (nếu có)
const savedProvider = localStorage.getItem('shadowing_ai_provider');
const savedModel = localStorage.getItem('shadowing_ai_model');

if (savedProvider) aiProviderSelect.value = savedProvider;
if (savedModel) {
    // Ép giá trị vào ô input, ghi đè luôn cả những gì trình duyệt vừa tự điền bậy
    setTimeout(() => {
        aiModelInput.value = savedModel;
    }, 100); // Trễ 0.1s để đảm bảo chiến thắng trình duyệt
} else {
    // Nếu chưa từng lưu, mặc định là gemini-2.5-flash-lite
    aiModelInput.value = "gemini-3.1-flash-lite-preview"; 
}

// 2. Lắng nghe và lưu lại bộ nhớ ngay khi người dùng thay đổi
aiProviderSelect.addEventListener('change', (e) => {
    localStorage.setItem('shadowing_ai_provider', e.target.value);
});

// Dùng sự kiện 'input' để lưu từng chữ người dùng gõ hoặc chọn từ danh sách
aiModelInput.addEventListener('input', (e) => {
    localStorage.setItem('shadowing_ai_model', e.target.value.trim());
});
// ==========================================
// --- TÍCH HỢP AI (GEMINI & DEEPSEEK) ---
// ==========================================

// Hàm gọi API dùng chung cho cả nút bấm lẫn ô nhập tự do
async function callAI(customPrompt) {
    const provider = document.getElementById('aiProvider').value;
    const apiKey = document.getElementById('aiApiKey').value.trim();
    const modelName = document.getElementById('aiModel').value.trim();
    const aiResponseEl = document.getElementById('aiResponse');
    
    if (!apiKey) {
        aiResponseEl.innerHTML = "❌ <b style='color:red;'>Lỗi:</b> Vui lòng nhập API Key ở bước 5.";
        return;
    }

    aiResponseEl.innerHTML = "⏳ <i>AI đang suy nghĩ...</i>";

    try {
        let aiText = "";

        // 1. Nếu dùng GEMINI
        if (provider === 'gemini') {
            const finalModel = modelName || 'gemini-2.5-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${finalModel}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: customPrompt }] }] })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            aiText = data.candidates[0].content.parts[0].text;
        } 
        
        // 2. Nếu dùng DEEPSEEK
        else if (provider === 'deepseek') {
            const finalModel = modelName || 'deepseek-chat';
            const url = "https://api.deepseek.com/chat/completions";
            const response = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}` 
                },
                body: JSON.stringify({ 
                    model: finalModel,
                    messages: [{ role: "user", content: customPrompt }] 
                })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            aiText = data.choices[0].message.content;
        }

        // Format lại kết quả cho đẹp (In đậm và xuống dòng)
        aiResponseEl.innerHTML = aiText.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
        
} catch (error) {
        // Bắt lỗi quá tải của Google hoặc DeepSeek để hiển thị thông báo thân thiện
        if (error.message.toLowerCase().includes("high demand") || error.message.includes("503") || error.message.includes("overloaded")) {
            aiResponseEl.innerHTML = `
                ⚠️ <b style='color:#e67e22;'>Máy chủ AI đang quá tải:</b> 
                Google/DeepSeek hiện đang có quá nhiều người truy cập cùng lúc. 
                <br><br>
                👉 <i>Giải pháp: Hãy đợi khoảng 5-10 giây rồi bấm gửi lại, hoặc chuyển sang dùng Model AI của hãng khác ở mục 4 nhé!</i>
            `;
        } else {
            // Các lỗi khác như sai API Key, mất mạng...
            aiResponseEl.innerHTML = `❌ <b style='color:red;'>Lỗi AI:</b> ${error.message}`;
        }
    }
}

// Bắt sự kiện cho 3 nút có sẵn
document.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.target.getAttribute('data-prompt');
        const langText = langSelect.options[langSelect.selectedIndex].text;
        const prompt = `${type} từ "${selectedWord}" trong tiếng ${langText}. Trả lời ngắn gọn bằng tiếng Việt.`;
        callAI(prompt);
    });
});

// Bắt sự kiện cho ô tự gõ câu hỏi (Nút Gửi hoặc bấm Enter)
const customAiInput = document.getElementById('customAiPrompt');
const sendCustomAiBtn = document.getElementById('sendCustomAiBtn');

function handleCustomPrompt() {
    const userQuestion = customAiInput.value.trim();
    if (!userQuestion) return;
    const langText = langSelect.options[langSelect.selectedIndex].text;
    const prompt = `Về từ/cụm từ "${selectedWord}" trong tiếng ${langText}. Yêu cầu của tôi là: ${userQuestion}`;
    callAI(prompt);
}

sendCustomAiBtn.addEventListener('click', handleCustomPrompt);
customAiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleCustomPrompt();
});

// ==========================================
// --- SỔ TAY TỪ VỰNG (VÁ LỖI HIỂN THỊ) ---
// ==========================================

// Hàm lấy dữ liệu mới nhất từ bộ nhớ trình duyệt
function getVocabFromStorage() {
    return JSON.parse(localStorage.getItem('shadowing_vocab')) || [];
}

// Hàm vẽ lại danh sách từ vựng
function renderVocab() {
    // Luôn quét lại DOM để tìm thẻ ul, tránh trường hợp HTML chưa tải xong
    const vocabListEl = document.getElementById('vocabList');
    
    if (!vocabListEl) {
        console.warn("Cảnh báo: Không tìm thấy thẻ <ul id='vocabList'> trong HTML.");
        return; 
    }
    
    const myVocab = getVocabFromStorage();
    vocabListEl.innerHTML = "";
    
    // Nếu chưa có từ nào
    if (myVocab.length === 0) {
        vocabListEl.innerHTML = "<li style='background: transparent; color: #7f8c8d; font-weight: normal;'>Chưa có từ vựng nào. Hãy bôi đen từ trên phụ đề và bấm ⭐ để lưu.</li>";
        return;
    }

    // Nếu có từ, in ra màn hình
    myVocab.forEach((word, index) => {
        const li = document.createElement('li');
        li.innerHTML = `${word} <span class="delete-vocab" onclick="deleteVocab(${index})" title="Xóa từ này">✕</span>`;
        vocabListEl.appendChild(li);
    });
}

// Lắng nghe sự kiện trang web tải xong 100% HTML rồi mới in từ vựng
document.addEventListener('DOMContentLoaded', renderVocab);
// Gọi thêm 1 lần đề phòng script chạy sau khi DOM đã load
renderVocab();

// Xử lý sự kiện bấm nút Lưu từ
const saveWordBtn = document.getElementById('saveWordBtn');
if (saveWordBtn) {
    saveWordBtn.addEventListener('click', () => {
        if (!selectedWord) return;
        
        let currentVocab = getVocabFromStorage();
        
        if (!currentVocab.includes(selectedWord)) {
            currentVocab.push(selectedWord);
            localStorage.setItem('shadowing_vocab', JSON.stringify(currentVocab));
            renderVocab();
            
            // Hiệu ứng UX
            const originalText = saveWordBtn.innerText;
            saveWordBtn.innerText = "✔️ Đã lưu";
            saveWordBtn.style.color = "#2ecc71";
            setTimeout(() => {
                saveWordBtn.innerText = originalText;
                saveWordBtn.style.color = "";
            }, 1500);
            
        } else {
            // Hiệu ứng từ đã tồn tại
            const originalText = saveWordBtn.innerText;
            saveWordBtn.innerText = "⚠️ Đã có sẵn";
            saveWordBtn.style.color = "#f39c12";
            setTimeout(() => {
                saveWordBtn.innerText = originalText;
                saveWordBtn.style.color = "";
            }, 1500);
        }
    });
}

// Hàm xóa từ vựng (Gắn vào window để chạy được onclick từ HTML)
window.deleteVocab = function(index) {
    let currentVocab = getVocabFromStorage();
    currentVocab.splice(index, 1);
    localStorage.setItem('shadowing_vocab', JSON.stringify(currentVocab));
    renderVocab();
};

// ==========================================
// --- TÍNH NĂNG AI AUTO-SUBTITLE & EDITOR ---
// ==========================================
const btnAutoSub = document.getElementById('btnAutoSub');
const autoSubStatus = document.getElementById('autoSubStatus');
const srtEditorContainer = document.getElementById('srtEditorContainer');
const srtEditor = document.getElementById('srtEditor');
const applySrtBtn = document.getElementById('applySrtBtn');
const cancelSrtBtn = document.getElementById('cancelSrtBtn');

if (btnAutoSub) {
    btnAutoSub.addEventListener('click', async () => {
        const mediaInput = document.getElementById('mediaUpload');
        const mediaFile = mediaInput.files[0];
        const apiKey = document.getElementById('aiApiKey').value.trim();
        const modelName = document.getElementById('aiModel').value.trim() || 'gemini-3.1-flash-lite-preview';
        const langText = langSelect.options[langSelect.selectedIndex].text.split(' ')[0];

        if (!mediaFile) return alert("❌ Vui lòng chọn Video hoặc Audio ở Bước 1 trước!");
        if (!apiKey) return alert("❌ Vui lòng nhập API Key (Gemini) ở Bước 5!");
        if (document.getElementById('aiProvider').value !== 'gemini') {
            return alert("❌ Tính năng này hiện tại chỉ hỗ trợ qua Gemini.");
        }

        if (mediaFile.size > 20 * 1024 * 1024) {
            const confirmRun = confirm("⚠️ File của bạn lớn hơn 20MB. Trình duyệt có thể bị đơ. Chắc chắn tiếp tục?");
            if (!confirmRun) return;
        }

        btnAutoSub.disabled = true;
        autoSubStatus.style.display = "block";
        autoSubStatus.innerText = "⏳ Đang trích xuất dữ liệu video...";
        autoSubStatus.style.color = "#e67e22";
        srtEditorContainer.style.display = "none"; // Ẩn editor nếu đang mở

        try {
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = error => reject(error);
                reader.readAsDataURL(mediaFile);
            });

            autoSubStatus.innerText = "🧠 Đang nghe và chép chính tả (vui lòng giữ màn hình sáng)...";

            // 1. LẤY ĐỘ DÀI CHÍNH XÁC CỦA FILE MEDIA (Tính bằng giây)
            let durationInfo = "";
            if (video.duration && !isNaN(video.duration)) {
                const totalSecs = Math.floor(video.duration);
                const h = Math.floor(totalSecs / 3600).toString().padStart(2, '0');
                const m = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
                const s = (totalSecs % 60).toString().padStart(2, '0');
                
                // Tạo một khối cảnh báo đỏ bằng chữ cho AI
                durationInfo = `
                [CRITICAL MEDIA INFO]
                The exact total length of this media file is ${totalSecs} seconds (Format HH:MM:SS -> ${h}:${m}:${s}). 
                MATHEMATICAL BOUNDARY: It is absolutely impossible for any subtitle timestamp to exceed ${h}:${m}:${s}. 
                WARNING: Do NOT confuse seconds for minutes. If the media is 45 seconds long, your max timestamps must be 00:00:45,XXX, NOT 00:45:XX,XXX.
                `;
            }

            // 2. NHÚNG CẢNH BÁO VÀO PROMPT KỶ LUẬT THÉP
            const prompt = `You are an expert audio-visual transcriber. Your task is to transcribe the spoken audio of this video into the ${langText} language.
            ${durationInfo}
            
            CRITICAL INSTRUCTIONS:
            1. CROSS-REFERENCE AUDIO AND VISUALS: Listen closely to the audio. Analyze on-screen text to verify spelling in ${langText}.
            2. STRICTLY IGNORE TRANSLATIONS: Ignore any subtitles in other languages.
            3. ABSOLUTE MANDATORY FORMAT (SRT): You MUST output the transcription in strictly valid SubRip (SRT) format. 
               - You MUST include a sequential number (1, 2, 3...).
               - You MUST include BOTH START and END timestamps using exactly this format: HH:MM:SS,mmm --> HH:MM:SS,mmm
               - If you are unsure of the exact end time, estimate it based on the audio gap. Do NOT leave it out.
               - You MUST put a blank line between each subtitle block.
               - Do NOT output markdown code blocks (like \`\`\`srt). Just output the raw text.

            EXAMPLE OF EXACT REQUIRED OUTPUT:
            1
            00:00:04,715 --> 00:00:08,445
            Я вас любил,

            2
            00:00:08,445 --> 00:00:11,425
            Любовь ещё, быть может,
            `;
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            // { inlineData: { mimeType: videoFile.type || "video/mp4", data: base64Data } }
                            { inlineData: { mimeType: mediaFile.type || "audio/mp3", data: base64Data } }
                        ]
                    }]
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            let aiSrtText = data.candidates[0].content.parts[0].text;
            aiSrtText = aiSrtText.replace(/```(srt)?\n?/gi, '').replace(/```/g, '').trim();

            // Đẩy kết quả vào khung soạn thảo thay vì áp dụng thẳng
            srtEditor.value = aiSrtText;
            srtEditorContainer.style.display = "block"; // Hiện khung soạn thảo
            
            autoSubStatus.innerText = `✅ Đã tạo nháp thành công! Hãy kiểm tra bên dưới và nhấn "Áp dụng".`;
            autoSubStatus.style.color = "#2ecc71";

        } catch (error) {
            console.error("Lỗi Auto-Sub:", error);
            autoSubStatus.innerText = `❌ Lỗi: ${error.message}`;
            autoSubStatus.style.color = "#e74c3c";
        } finally {
            btnAutoSub.disabled = false;
        }
    });
}

// Xử lý nút Áp dụng Phụ đề từ khung soạn thảo
if (applySrtBtn) {
    applySrtBtn.addEventListener('click', () => {
        const finalSrt = srtEditor.value.trim();
        if (!finalSrt) return alert("Phụ đề đang trống!");
        
        // Dịch văn bản thành mảng Object
        subtitles = parseSRT(finalSrt);
        
        if (subtitles.length > 0) {
            srtEditorContainer.style.display = "none";
            autoSubStatus.innerText = `✅ Đã áp dụng ${subtitles.length} dòng phụ đề!`;
            checkReadyState(); 
            
            // FIX LỖI 1: Reset toàn bộ biến trạng thái về 0 để tránh kẹt chữ
            currentSubId = null;
            currentTargetText = "";
            lastUserText = "";
            currentScores = { accuracy: 0, speed: 0, total: 0 };
            
            // FIX LỖI 2: Tự động tua video đến đúng thời điểm câu phụ đề đầu tiên xuất hiện
            if (subtitles[0].start > 0) {
                video.currentTime = subtitles[0].start;
            }
            
            // Tự động phát video ngay lập tức
            video.play().catch(e => console.warn("Trình duyệt chặn tự động phát:", e));

            setTimeout(() => { autoSubStatus.style.display = "none"; }, 3000);
        } else {
            alert("❌ Không tìm thấy thời gian hợp lệ. Hãy đảm bảo phụ đề có cấu trúc thời gian (VD: 00:00:01,000 --> 00:00:04,000).");
        }
    });
}

// Xử lý nút Hủy bỏ
if (cancelSrtBtn) {
    cancelSrtBtn.addEventListener('click', () => {
        srtEditorContainer.style.display = "none";
        srtEditor.value = "";
        autoSubStatus.style.display = "none";
    });
}
// ==========================================
// --- TÍNH NĂNG TẢI FILE SRT VỀ MÁY ---
// ==========================================
const downloadSrtBtn = document.getElementById('downloadSrtBtn');

if (downloadSrtBtn) {
    downloadSrtBtn.addEventListener('click', () => {
        // Lấy nội dung từ khung soạn thảo
        const srtContent = srtEditor.value.trim();
        
        if (!srtContent) {
            return alert("❌ Phụ đề đang trống, không có dữ liệu để tải về!");
        }
        
        // 1. Gói nội dung văn bản thành một file ảo (Blob) với chuẩn UTF-8 để không bị lỗi font tiếng Nga/Việt
        const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
        
        // 2. Tạo một đường link ẩn (URL ảo) trỏ tới file Blob đó
        const fileUrl = URL.createObjectURL(blob);
        
        // 3. Tạo một thẻ <a> ảo để ra lệnh tải xuống
        const downloadLink = document.createElement("a");
        downloadLink.href = fileUrl;
        
        // Đặt tên file tự động theo thời gian tải (Ví dụ: shadowing_sub_14h30.srt)
        const date = new Date();
        const timeString = `${date.getHours()}h${date.getMinutes()}m`;
        downloadLink.download = `shadowing_sub_${timeString}.srt`;
        
        // 4. Gắn thẻ ảo vào web, giả lập cú click chuột để tải, rồi dọn dẹp xóa thẻ ảo đi
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        // Dọn dẹp bộ nhớ của URL ảo
        URL.revokeObjectURL(fileUrl);
    });
}
// ==========================================
// --- TÍNH NĂNG GEMINI CHẤM ĐIỂM GHI ÂM ---
// ==========================================
const aiEvaluateBtn = document.getElementById('aiEvaluateBtn');
const aiEvaluateResult = document.getElementById('aiEvaluateResult');

if (aiEvaluateBtn) {
    aiEvaluateBtn.addEventListener('click', async () => {
        if (!globalAudioBlob) return alert("❌ Chưa có file ghi âm! Hãy bấm Bắt đầu đọc và ghi âm trước.");
        
        const apiKey = document.getElementById('aiApiKey').value.trim();
        const provider = document.getElementById('aiProvider').value;
        const modelName = document.getElementById('aiModel').value.trim() || 'gemini-1.5-flash';

        if (!apiKey) return alert("❌ Vui lòng nhập API Key ở Bước 5 trước.");
        if (provider !== 'gemini') {
            return alert("❌ Tính năng nghe âm thanh hiện chỉ hỗ trợ mô hình Gemini. Hãy chuyển Nhà cung cấp AI sang Gemini nhé.");
        }

        // Khóa nút
        aiEvaluateBtn.innerText = "⏳ AI đang dỏng tai nghe và phân tích... (Có thể mất 15-30 giây)";
        aiEvaluateBtn.disabled = true;
        aiEvaluateResult.style.display = "block";
        aiEvaluateResult.innerHTML = "<em>Đang tải file âm thanh lên máy chủ Google...</em>";

        try {
            // 1. Chuyển file Âm thanh sang chuỗi Base64
            const reader = new FileReader();
            reader.readAsDataURL(globalAudioBlob);
            
            reader.onloadend = async () => {
                const base64Audio = reader.result.split(',')[1];
                const mimeType = globalAudioBlob.type || "audio/webm";

                // 2. Gom toàn bộ phụ đề trong bài học làm đáp án cho AI
                const allTargetText = subtitles.map(s => s.text).join(' ');
                const langName = document.getElementById('langSelect').options[document.getElementById('langSelect').selectedIndex].text;

                // 3. Prompt đóng vai giáo viên khắt khe
                const prompt = `Bạn là một chuyên gia ngôn ngữ và giáo viên dạy phát âm ${langName} xuất sắc. 
                Học viên của bạn vừa luyện tập phương pháp Shadowing. 
                Dưới đây là ĐÁP ÁN (Văn bản gốc mà học viên phải đọc):
                "${allTargetText}"
                
                Và đính kèm là FILE GHI ÂM giọng đọc thực tế của học viên. Hãy nghe thật kỹ và đánh giá theo format sau:
                
                🎯 **1. Điểm tổng quan:** (Chấm trên thang điểm 100)
                🗣️ **2. Lỗi phát âm:** (Chỉ ra những từ học viên đọc sai, đọc vấp, hoặc bỏ sót so với văn bản gốc. Ghi rõ từ sai và cách đọc đúng).
                🎵 **3. Ngữ điệu & Tốc độ:** (Nhận xét xem học viên đọc có tự nhiên không, có bị chậm quá hay nhanh quá không).
                💡 **4. Lời khuyên:** (1-2 câu khuyên học viên cách cải thiện).
                
                Trình bày rõ ràng, dễ đọc. Không cần chào hỏi dài dòng.`;

                // 4. Gọi API Gemini
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inlineData: { mimeType: mimeType, data: base64Audio } }
                            ]
                        }]
                    })
                });

                const data = await response.json();
                if (data.error) throw new Error(data.error.message);

                // 5. In kết quả ra màn hình (Biến markdown in đậm, xuống dòng thành HTML)
                let feedbackText = data.candidates[0].content.parts[0].text;
                feedbackText = feedbackText.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                
                aiEvaluateResult.innerHTML = feedbackText;
            };

        } catch (error) {
            console.error(error);
            aiEvaluateResult.innerHTML = `<span style="color:red;">❌ Lỗi: ${error.message}</span>`;
        } finally {
            aiEvaluateBtn.innerText = "🤖 Nhờ Gemini nghe và chấm điểm phát âm";
            aiEvaluateBtn.disabled = false;
        }
    });
}