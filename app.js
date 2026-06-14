// --- Global Variables ---
let peer;
let conn;
let myPeerId = null;
let receivedFiles = []; // Array to store { name, blob } for bulk download
let html5QrcodeScanner;

// --- DOM Elements ---
const viewConnection = document.getElementById('connection-view');
const viewTransfer = document.getElementById('transfer-view');
const btnScan = document.getElementById('scan-btn');
const modalScanner = document.getElementById('scanner-modal');
const btnCloseScanner = document.getElementById('close-scanner-btn');
const messagesContainer = document.getElementById('messages-container');
const btnSend = document.getElementById('send-btn');
const inputField = document.getElementById('text-input');
const fileInput = document.getElementById('file-input');
const btnAttach = document.getElementById('attach-btn');
const btnDownloadAll = document.getElementById('download-all-btn');
const toast = document.getElementById('toast');

// --- Initialization ---
function init() {
    // Initialize PeerJS
    peer = new Peer({
        debug: 2
    });

    peer.on('open', (id) => {
        myPeerId = id;
        generateQRCode(id);
        checkUrlForConnection();
    });

    // When someone connects to us
    peer.on('connection', (connection) => {
        if (conn) {
            connection.close(); // Only allow one connection at a time
            return;
        }
        conn = connection;
        setupConnection();
    });

    peer.on('error', (err) => {
        console.error(err);
        showToast("Connection error: " + err.type);
    });
}

// Generate QR Code containing the link to this app with the peer ID
function generateQRCode(id) {
    const qrcodeContainer = document.getElementById('qrcode');
    qrcodeContainer.innerHTML = "";
    
    const connectUrl = `${window.location.origin}${window.location.pathname}?peer=${id}`;
    
    new QRCode(qrcodeContainer, {
        text: connectUrl,
        width: 180,
        height: 180,
        colorDark : "#1D1B20",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

// Check if app was opened via scanned URL link
function checkUrlForConnection() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetPeer = urlParams.get('peer');
    
    if (targetPeer && targetPeer !== myPeerId) {
        connectToPeer(targetPeer);
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

function connectToPeer(id) {
    conn = peer.connect(id, { reliable: true });
    setupConnection();
}

// --- Connection Handling ---
function setupConnection() {
    conn.on('open', () => {
        switchView(viewTransfer);
        btnDownloadAll.classList.remove('hidden');
    });

    conn.on('data', (data) => {
        handleReceivedData(data);
    });

    conn.on('close', () => {
        showToast("Connection closed");
        setTimeout(() => location.reload(), 2000); // Reload to reset state safely
    });
}

// --- Data Handling ---
function handleReceivedData(data) {
    if (data.type === 'text') {
        addMessageBubble(data.content, 'received', 'text');
    } else if (data.type === 'file') {
        // Convert received ArrayBuffer/Uint8Array back to Blob
        const fileBlob = new Blob([data.fileData], { type: data.fileType });
        const fileObj = {
            name: data.fileName,
            blob: fileBlob,
            url: URL.createObjectURL(fileBlob)
        };
        receivedFiles.push(fileObj);
        addMessageBubble(data.fileName, 'received', 'file', fileObj);
    }
}

// --- Sending Logic ---
btnSend.addEventListener('click', sendText);
inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendText();
});

function sendText() {
    const text = inputField.value.trim();
    if (!text || !conn || !conn.open) return;

    conn.send({ type: 'text', content: text });
    addMessageBubble(text, 'sent', 'text');
    inputField.value = '';
}

btnAttach.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (files.length === 0 || !conn || !conn.open) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Read file as ArrayBuffer for reliable transfer via WebRTC
        const arrayBuffer = await file.arrayBuffer();
        
        conn.send({
            type: 'file',
            fileName: file.name,
            fileType: file.type,
            fileData: arrayBuffer
        });

        addMessageBubble(file.name, 'sent', 'file');
    }
    fileInput.value = ''; // Reset
});

// --- UI Logic ---
function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    view.classList.add('active');
}

function addMessageBubble(content, sender, type, fileObj = null) {
    const div = document.createElement('div');
    div.className = `bubble ${sender}`;

    const textSpan = document.createElement('span');
    textSpan.textContent = type === 'file' ? `📁 ${content}` : content;
    div.appendChild(textSpan);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'bubble-actions';

    if (type === 'text' && sender === 'received') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-btn';
        copyBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">content_copy</span> Copy`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(content);
            showToast('Copied to clipboard!');
        };
        actionsDiv.appendChild(copyBtn);
        div.appendChild(actionsDiv);
    } 
    else if (type === 'file' && sender === 'received' && fileObj) {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'action-btn';
        dlBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">download</span> Save`;
        dlBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = fileObj.url;
            a.download = fileObj.name;
            a.click();
        };
        actionsDiv.appendChild(dlBtn);
        div.appendChild(actionsDiv);
    }

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- Bulk Download Logic ---
btnDownloadAll.addEventListener('click', async () => {
    if (receivedFiles.length === 0) {
        showToast("No files received yet.");
        return;
    }

    showToast("Generating ZIP file...");
    const zip = new JSZip();
    
    receivedFiles.forEach(file => {
        zip.file(file.name, file.blob);
    });

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = `DropShare_Files_${new Date().getTime()}.zip`;
    a.click();
});

// --- Scanner Logic ---
btnScan.addEventListener('click', () => {
    modalScanner.classList.remove('hidden');
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: {width: 250, height: 250} },
        false
    );
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});

btnCloseScanner.addEventListener('click', closeScanner);

function onScanSuccess(decodedText, decodedResult) {
    closeScanner();
    // Check if it's a URL
    try {
        const url = new URL(decodedText);
        const peerParam = url.searchParams.get('peer');
        if (peerParam) {
            connectToPeer(peerParam);
            return;
        }
    } catch (e) {
        // Not a valid URL, might be raw ID
        connectToPeer(decodedText);
    }
}

function onScanFailure(error) {
    // Suppress console spam from continuous scanning
}

function closeScanner() {
    modalScanner.classList.add('hidden');
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(e => console.error("Failed to clear scanner", e));
    }
}

// --- Helpers ---
function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.log('ServiceWorker registered');
        }).catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// Run app
init();
