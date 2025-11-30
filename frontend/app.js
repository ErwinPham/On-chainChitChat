// app.js - Frontend logic for FiAI ChitChat
// Dapp: connect MetaMask, interact with ChitChat.sol via ethers v6,

// =====================
// ====== CONFIG =======
// =====================

//CONTRACT ADDRESS
const CONTRACT_ADDRESS = "0x79c175f4C66bcf294645f39B844501c3962D21c4";

// 11155111 = Sepolia
const EXPECTED_CHAIN_ID = 11155111;

// ABI cần dùng trên frontend
const CONTRACT_ABI = [
    // Events
    "event MessageSent(bytes32 indexed conversationId, address indexed from, address indexed to, uint256 index, string content, uint40 timestamp)",
    "event MessageEdited(bytes32 indexed conversationId, uint256 indexed index, string newContent)",
    "event MessageDeleted(bytes32 indexed conversationId, uint256 indexed index)",

    // External / public functions
    //"function initialize()",
    //"function grantCanUpgradeRole(address _account)",
    "function sendMessage(address to, string content)",
    "function editMessage(address user1, address user2, uint256 index, string newContent)",
    "function deleteMessage(address user1, address user2, uint256 index)",
    "function getConversationLength(address user1, address user2) view returns (uint256)"
];

// =====================
// ====== STATE ========
// =====================

let provider = null;       // ethers.BrowserProvider
let signer = null;         // ethers.Signer
let contract = null;       // ethers.Contract

let currentAccount = null; // string
let currentPeer = null;    // string (checksum address)
let currentConversationId = null; // bytes32 string
let messages = [];         // local cache của cuộc trò chuyện hiện tại
let hasProviderListeners = false;

// =====================
// ====== DOM ==========
// =====================

const els = {};

function initDom() {
    els.walletDisplay = document.getElementById("wallet-display");
    els.walletStatus = document.getElementById("wallet-status");
    els.peerInput = document.getElementById("peer-input");
    els.peerDisplay = document.getElementById("peer-display");
    els.btnConnect = document.getElementById("btn-connect");
    els.btnDisconnect = document.getElementById("btn-disconnect");
    els.messagesInner = document.getElementById("messages-inner");
    els.formSend = document.getElementById("form-send");
    els.messageInput = document.getElementById("message-input");
    els.btnSend = document.getElementById("btn-send");
    els.sendStatus = document.getElementById("send-status");
}

// =====================
// ===== HELPERS =======
// =====================

function setWalletStatus(text) {
    if (els.walletStatus) {
        els.walletStatus.textContent = text || "";
    }
}

function setSendStatus(text) {
    if (els.sendStatus) {
        els.sendStatus.textContent = text || "";
    }
}

function shortAddress(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function shortTx(hash) {
    if (!hash) return "";
    return hash.slice(0, 10) + "...";
}

// Chuẩn hoá & validate địa chỉ bằng ethers.getAddress.
// Nếu không hợp lệ -> trả về null
function normalizeAddress(input) {
    if (!input) return null;
    try {
        const addr = ethers.getAddress(input.trim());
        return addr;
    } catch (e) {
        return null;
    }
}

// Tính conversationId off-chain giống hệt _conversationId trong Solidity:
// (a, b) = user1 < user2 ? (user1, user2) : (user2, user1);
// keccak256(abi.encodePacked(a, b));
function computeConversationId(addr1, addr2) {
    const aNorm = normalizeAddress(addr1);
    const bNorm = normalizeAddress(addr2);
    if (!aNorm || !bNorm) {
        throw new Error("Địa chỉ không hợp lệ khi tính conversationId");
    }

    // Sắp xếp theo thứ tự giống so sánh address trong Solidity
    const aLower = aNorm.toLowerCase();
    const bLower = bNorm.toLowerCase();
    const [first, second] = aLower < bLower ? [aNorm, bNorm] : [bNorm, aNorm];

    // ethers.solidityPackedKeccak256 tương đương keccak256(abi.encodePacked(...))
    return ethers.solidityPackedKeccak256(["address", "address"], [first, second]);
}

// format timestamp (uint40) -> string time cho UI
function formatTimestamp(ts) {
    if (!ts) return "";
    try {
        const d = new Date(Number(ts) * 1000);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour12: false
        });
    } catch (e) {
        return "";
    }
}

function updateWalletDisplay() {
    if (!els.walletDisplay) return;
    if (!currentAccount) {
        els.walletDisplay.textContent = "Chưa kết nối ví";
        els.walletDisplay.classList.add("empty");
    } else {
        els.walletDisplay.textContent = shortAddress(currentAccount);
        els.walletDisplay.classList.remove("empty");
    }
}

function updatePeerDisplay(rawInput) {
    if (!els.peerDisplay) return;
    const trimmed = rawInput ? rawInput.trim() : "";
    if (!trimmed) {
        els.peerDisplay.textContent = "Bạn chưa nhập người trò chuyện";
        return;
    }
    els.peerDisplay.textContent = trimmed;
}

// Bật / tắt nút gửi dựa trên state (connect ví + chọn peer + có nội dung msg)
function updateSendButtonState() {
    if (!els.btnSend || !els.messageInput) return;
    const hasContent = !!els.messageInput.value.trim();
    const ready =
        !!contract &&
        !!currentAccount &&
        !!currentPeer &&
        hasContent;
    els.btnSend.disabled = !ready;
}

// =====================
// ====== RENDER =======
// =====================

function renderMessages() {
    if (!els.messagesInner) return;

    els.messagesInner.innerHTML = "";

    if (!messages.length) {
        return;
    }

    for (const msg of messages) {
        const isMe =
            currentAccount &&
            msg.from &&
            msg.from.toLowerCase() === currentAccount.toLowerCase();

        const row = document.createElement("div");
        row.className = "msg-row " + (isMe ? "me" : "them");
        row.dataset.index = String(msg.index);

        const wrapper = document.createElement("div");

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        if (msg.isDeleted) {
            bubble.textContent = "Tin nhắn đã bị xoá";
        } else {
            bubble.textContent = msg.content;
        }
        wrapper.appendChild(bubble);

        const meta = document.createElement("div");
        meta.className = "msg-meta";
        const whoLabel = isMe ? "Bạn" : shortAddress(msg.from);
        meta.textContent = `${whoLabel} • ${formatTimestamp(
            msg.timestamp
        )} • #${msg.index}`;
        wrapper.appendChild(meta);

        if (isMe && !msg.isDeleted) {
            const actions = document.createElement("div");
            actions.className = "msg-actions";

            const btnEdit = document.createElement("button");
            btnEdit.className = "msg-action-btn edit";
            btnEdit.textContent = "Sửa";

            const btnDel = document.createElement("button");
            btnDel.className = "msg-action-btn del";
            btnDel.textContent = "Xoá";

            actions.appendChild(btnEdit);
            actions.appendChild(btnDel);
            wrapper.appendChild(actions);
        }

        row.appendChild(wrapper);
        els.messagesInner.appendChild(row);
    }

    // Scroll xuống cuối mỗi khi render lại
    const scroller = els.messagesInner.parentElement;
    if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
    }
}

// Thêm / cập nhật một message trong cache
function upsertMessage(msgObj) {
    const existingIndex = messages.findIndex((m) => m.index === msgObj.index);
    if (existingIndex === -1) {
        messages.push(msgObj);
    } else {
        messages[existingIndex] = {
            ...messages[existingIndex],
            ...msgObj
        };
    }
    messages.sort((a, b) => a.index - b.index);
    renderMessages();
}

// ===============================
// ====== PROVIDER / WALLET ======
// ===============================

async function connectWallet() {
    if (!window.ethereum) {
        setWalletStatus("Không tìm thấy provider Ethereum. Hãy cài MetaMask.");
        return;
    }

    try {
        setWalletStatus("Đang yêu cầu MetaMask kết nối ví...");

        provider = new ethers.BrowserProvider(window.ethereum);

        // Yêu cầu quyền truy cập account
        await provider.send("eth_requestAccounts", []);

        signer = await provider.getSigner();
        currentAccount = await signer.getAddress();

        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);

        //if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS === "0xYOUR_CHITCHAT_PROXY_ADDRESS_HERE") {
        //    console.warn("Hãy điền CONTRACT_ADDRESS trong app.js trước khi dùng Dapp.");
        //    setWalletStatus("⚠️ Bạn cần cấu hình CONTRACT_ADDRESS trong app.js.");
        //} else 
        if (chainId !== EXPECTED_CHAIN_ID) {
            setWalletStatus(
                `Đã kết nối ví ${shortAddress(
                    currentAccount
                )} trên chainId ${chainId}. Hãy chuyển sang chainId ${EXPECTED_CHAIN_ID} cho đúng mạng Sepolia Ethereum.`
            );
        } else {
            setWalletStatus(
                `Đã kết nối ví ${shortAddress(currentAccount)} trên chainId ${chainId}.`
            );
        }

        updateWalletDisplay();

        els.btnConnect.disabled = true; // tắt nút connnect
        els.btnDisconnect.disabled = false; // bật nút disconnect

        // Khởi tạo contract (kết nối bằng signer -> có thể ghi dữ liệu)
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        // Đăng ký listen event provider (accountsChanged, chainChanged)
        setupProviderEvents();

        // Đăng ký listen event contract (MessageSent / Edited / Deleted)
        setupContractEvents();

        // Nếu đã chọn peer thì load lịch sử chat từ blockchain
        if (currentPeer) {
            await loadConversation();
        }

        updateSendButtonState();
    } catch (err) {
        console.error("connectWallet error:", err);
        setWalletStatus(
            "Lỗi khi kết nối ví: " +
            (err.shortMessage || err.reason || err.message || String(err))
        );
    }
}

function disconnectWallet() {
    // Không thể "ngắt" MetaMask từ Dapp, nhưng có thể reset state ở UI
    cleanupContractEvents();

    //Remove luôn Provider listerner khi disconnect ví
    if (window.ethereum && hasProviderListeners) {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        window.ethereum.removeListener("chainChanged", handleChainChanged);
        hasProviderListeners = false;
    }

    provider = null;
    signer = null;
    contract = null;
    currentAccount = null;
    currentConversationId = null;
    messages = [];

    updateWalletDisplay();
    renderMessages();
    setWalletStatus("Đã ngắt kết nối ví");
    setSendStatus("");

    els.btnConnect.disabled = false;
    els.btnDisconnect.disabled = true;

    updateSendButtonState();
}

function setupProviderEvents() {
    if (!window.ethereum || hasProviderListeners) return;

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    hasProviderListeners = true;
}

async function handleAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
        // User disconnect trong MetaMask
        disconnectWallet();
        return;
    }

    currentAccount = normalizeAddress(accounts[0]);
    updateWalletDisplay();
    setWalletStatus(`Tài khoản đã đổi sang ${shortAddress(currentAccount)}.`);

    // Recreate signer / contract
    if (provider) {
        signer = await provider.getSigner();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        setupContractEvents();
        if (currentPeer) {
            await loadConversation();
        }
    }

    updateSendButtonState();
}

function handleChainChanged(_hexChainId) {
    // Cách đơn giản nhất: reload toàn bộ app
    window.location.reload();
}

// ===========================
// ====== CONTRACT I/O =======
// ===========================

// Load toàn bộ lịch sử chat của (currentAccount, currentPeer) bằng event
async function loadConversation() {
    if (!contract || !currentAccount || !currentPeer) return;

    try {
        currentConversationId = computeConversationId(currentAccount, currentPeer);
    } catch (e) {
        setSendStatus("Không tính được conversationId: " + e.message);
        return;
    }

    setSendStatus("Đang tải lịch sử chat on-chain...");

    try {
        // Lấy độ dài cuộc trò chuyện (call read-only)
        const lengthBig = await contract.getConversationLength(
            currentAccount,
            currentPeer
        );
        const length = Number(lengthBig);

        console.log("On-chain conversation length =", length);

        // queryFilter: đọc lại tất cả event liên quan tới convId
        // Lưu ý: nếu RPC giới hạn block range, bạn có thể chỉnh fromBlock -> -5000 (last 5000 blocks)
        const filterSent = contract.filters.MessageSent(currentConversationId);
        const filterEdited = contract.filters.MessageEdited(currentConversationId);
        const filterDeleted = contract.filters.MessageDeleted(currentConversationId);

        const [sentEvents, editedEvents, deletedEvents] = await Promise.all([
            contract.queryFilter(filterSent, 0),
            contract.queryFilter(filterEdited, 0),
            contract.queryFilter(filterDeleted, 0)
        ]);

        const byIndex = new Map();

        // Khởi tạo messages từ MessageSent
        for (const ev of sentEvents) {
            const args = ev.args;
            const idx = Number(args.index);
            const msgObj = {
                index: idx,
                from: args.from,
                to: args.to,
                content: args.content,
                timestamp: Number(args.timestamp),
                isDeleted: false
            };
            byIndex.set(idx, msgObj);
        }

        // Áp dụng edit
        for (const ev of editedEvents) {
            const args = ev.args;
            const idx = Number(args.index);
            const msg = byIndex.get(idx);
            if (msg) {
                msg.content = args.newContent;
            }
        }

        // Áp dụng delete
        for (const ev of deletedEvents) {
            const args = ev.args;
            const idx = Number(args.index);
            const msg = byIndex.get(idx);
            if (msg) {
                msg.isDeleted = true;
                msg.content = "";
            }
        }

        messages = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
        renderMessages();

        if (messages.length === 0) {
            setSendStatus("Chưa có tin nhắn nào trong cuộc trò chuyện này.");
        } else {
            setSendStatus(`Đã tải ${messages.length} tin nhắn từ blockchain.`);
        }

        updateSendButtonState();
    } catch (err) {
        console.error("loadConversation error:", err);
        setSendStatus(
            "Lỗi khi tải lịch sử chat: " +
            (err.shortMessage || err.reason || err.message || String(err))
        );
    }
}

// Gửi message mới
async function sendMessage(content) {
    if (!contract || !currentAccount) {
        setSendStatus("Bạn cần kết nối ví trước khi gửi.");
        return;
    }
    if (!currentPeer) {
        setSendStatus("Hãy nhập địa chỉ ví muốn nhắn tới ở ô màu vàng.");
        return;
    }

    const trimmed = content.trim();
    if (!trimmed) {
        setSendStatus("Nội dung tin nhắn không được rỗng.");
        return;
    }

    try {
        // Ước tính gas
        const gasEstimate = await contract.sendMessage.estimateGas(
            currentPeer,
            trimmed
        );
        console.log("Estimated gas for sendMessage:", gasEstimate.toString());

        setSendStatus("Đang gửi transaction gửi tin nhắn lên MetaMask...");

        // Gửi transaction (write)
        const tx = await contract.sendMessage(currentPeer, trimmed);

        setSendStatus("Transaction pending: " + shortTx(tx.hash));

        // Chờ mined
        const receipt = await tx.wait();

        if (receipt.status === 1n || receipt.status === 1) {
            setSendStatus("Gửi tin nhắn thành công: " + shortTx(tx.hash));
            els.messageInput.value = "";
            updateSendButtonState();
            // UI sẽ được cập nhật realtime bởi event MessageSent
        } else {
            setSendStatus("Transaction bị revert (status != 1).");
        }
    } catch (err) {
        console.error("sendMessage error:", err);
        handleTxError(err, "gửi tin nhắn");
    }
}

// Sửa tin nhắn (edit)
async function editMessageOnChain(index, newContent) {
    if (!contract || !currentAccount || !currentPeer) {
        setSendStatus("Bạn cần kết nối ví và chọn người nhận trước khi sửa tin.");
        return;
    }

    const trimmed = newContent.trim();
    if (!trimmed) {
        setSendStatus("Nội dung mới không được rỗng.");
        return;
    }

    try {
        setSendStatus("Đang gửi transaction sửa tin nhắn...");

        const tx = await contract.editMessage(
            currentAccount,
            currentPeer,
            index,
            trimmed
        );

        setSendStatus("Pending edit tx: " + shortTx(tx.hash));

        const receipt = await tx.wait();

        if (receipt.status === 1n || receipt.status === 1) {
            setSendStatus("Sửa tin nhắn thành công.");
            // UI sẽ được cập nhật realtime bởi event MessageEdited
        } else {
            setSendStatus("Transaction sửa tin bị revert.");
        }
    } catch (err) {
        console.error("editMessageOnChain error:", err);
        handleTxError(err, "sửa tin nhắn");
    }
}

// Xoá tin nhắn (soft delete)
async function deleteMessageOnChain(index) {
    if (!contract || !currentAccount || !currentPeer) {
        setSendStatus("Bạn cần kết nối ví và chọn người nhận trước khi xoá tin.");
        return;
    }

    try {
        setSendStatus("Đang gửi transaction xoá tin nhắn...");

        const tx = await contract.deleteMessage(currentAccount, currentPeer, index);

        setSendStatus("Pending delete tx: " + shortTx(tx.hash));

        const receipt = await tx.wait();

        if (receipt.status === 1n || receipt.status === 1) {
            setSendStatus("Xoá tin nhắn thành công.");
            // UI sẽ được cập nhật realtime bởi event MessageDeleted
        } else {
            setSendStatus("Transaction xoá tin bị revert.");
        }
    } catch (err) {
        console.error("deleteMessageOnChain error:", err);
        handleTxError(err, "xoá tin nhắn");
    }
}

// Xử lý lỗi transaction chung (Pending / Success / Error)
function handleTxError(err, actionLabel) {
    // Lỗi user reject trong MetaMask
    if (err && (err.code === 4001 || err.code === "ACTION_REJECTED")) {
        setSendStatus("Bạn đã từ chối transaction " + actionLabel + " trong MetaMask.");
        return;
    }

    const msg =
        err.shortMessage ||
        err.reason ||
        (err.error && err.error.message) ||
        err.message ||
        String(err);

    setSendStatus("Lỗi khi " + actionLabel + ": " + msg);
}

// =============================
// ====== CONTRACT EVENTS ======
// =============================

function setupContractEvents() {
    if (!contract) return;

    // Clear trước nếu đã có listener cũ
    cleanupContractEvents();

    // Realtime: lắng nghe mọi MessageSent từ blockchain
    contract.on(
        "MessageSent",
        (conversationId, from, to, index, content, timestamp, event) => {
            if (!currentAccount || !currentPeer || !currentConversationId) {
                return;
            }
            if (
                conversationId.toLowerCase() !== currentConversationId.toLowerCase()
            ) {
                return;
            }

            const msgObj = {
                index: Number(index),
                from,
                to,
                content,
                timestamp: Number(timestamp),
                isDeleted: false
            };

            upsertMessage(msgObj);
        }
    );

    // Lắng nghe sửa tin
    contract.on(
        "MessageEdited",
        (conversationId, index, newContent, event) => {
            if (!currentConversationId) return;
            if (
                conversationId.toLowerCase() !== currentConversationId.toLowerCase()
            ) {
                return;
            }

            const idx = Number(index);
            const msg = messages.find((m) => m.index === idx);
            if (msg) {
                msg.content = newContent;
                renderMessages();
            }
        }
    );

    // Lắng nghe xoá tin
    contract.on("MessageDeleted", (conversationId, index, event) => {
        if (!currentConversationId) return;
        if (
            conversationId.toLowerCase() !== currentConversationId.toLowerCase()
        ) {
            return;
        }

        const idx = Number(index);
        const msg = messages.find((m) => m.index === idx);
        if (msg) {
            msg.isDeleted = true;
            msg.content = "";
            renderMessages();
        }
    });
}

function cleanupContractEvents() {
    if (!contract) return;
    contract.removeAllListeners("MessageSent");
    contract.removeAllListeners("MessageEdited");
    contract.removeAllListeners("MessageDeleted");
}

// =========================
// ====== UI EVENTS ========
// =========================

function setupUiEvents() {
    if (els.btnConnect) {
        els.btnConnect.addEventListener("click", () => {
            connectWallet();
        });
    }

    if (els.btnDisconnect) {
        els.btnDisconnect.addEventListener("click", () => {
            disconnectWallet();
        });
    }

    if (els.peerInput) {
        // Khi nhập text
        els.peerInput.addEventListener("input", (e) => {
            updatePeerDisplay(e.target.value);
        });

        // Khi blur hoặc nhấn Enter -> set peer & load lịch sử
        const applyPeer = async () => {
            const raw = els.peerInput.value;
            const normalized = normalizeAddress(raw);

            if (!normalized) {
                currentPeer = null;
                currentConversationId = null;
                messages = [];
                renderMessages();
                setSendStatus("Địa chỉ người nhận không hợp lệ.");
                updateSendButtonState();
                return;
            }

            currentPeer = normalized;
            updatePeerDisplay(currentPeer);
            setSendStatus(`Đang mở cuộc trò chuyện với ${shortAddress(currentPeer)}.`);

            if (currentAccount && contract) {
                await loadConversation();
            }

            updateSendButtonState();
        };

        els.peerInput.addEventListener("change", applyPeer);
        els.peerInput.addEventListener("keyup", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applyPeer();
            }
        });
    }

    if (els.formSend) {
        els.formSend.addEventListener("submit", async (e) => {
            e.preventDefault();
            const content = els.messageInput.value;
            await sendMessage(content);
        });
    }

    if (els.messageInput) {
        els.messageInput.addEventListener("input", () => {
            updateSendButtonState();
        });
    }

    if (els.messagesInner) {
        // Event delegation cho nút Sửa / Xoá
        els.messagesInner.addEventListener("click", async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            const row = target.closest(".msg-row");
            if (!row) return;
            const indexStr = row.dataset.index;
            const index = indexStr ? parseInt(indexStr, 10) : NaN;
            if (!Number.isFinite(index)) return;

            if (target.classList.contains("edit")) {
                const existing = messages.find((m) => m.index === index);
                const currentContent = existing && existing.content ? existing.content : "";
                const newContent = window.prompt(
                    "Nội dung mới cho tin nhắn:",
                    currentContent
                );
                if (newContent == null) return; // user bấm Cancel
                await editMessageOnChain(index, newContent);
            } else if (target.classList.contains("del")) {
                const ok = window.confirm("Bạn chắc chắn muốn xoá tin nhắn này?");
                if (!ok) return;
                await deleteMessageOnChain(index);
            }
        });
    }
}

// ======================
// ====== BOOTSTRAP =====
// ======================

(function main() {
    initDom();
    updateWalletDisplay();
    updatePeerDisplay("");
    updateSendButtonState();
    setupUiEvents();
})();
