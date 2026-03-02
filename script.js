/**
 * Presentation Q&A System Logic
 * Handles Chat Widget (Audience) and Dashboard (Speaker) interactions
 */

// --- n8n Backend Configuration ---
// 設定為 true 並填入您的 n8n Webhook URL 以啟用後端整合
// 設定為 false 則使用本地 Mock 模式 (LocalStorage)
const USE_N8N = true;
const N8N_BASE_URL = 'https://j2550420-n8n-free.hf.space/webhook'; // 您的 n8n Webhook URL
const N8N_ENDPOINTS = {
    ask: `${N8N_BASE_URL}/qa`,              // POST: 提交問題 (AI 處理)
    pending: `${N8N_BASE_URL}/qa/pending`,   // GET:  讀取待回覆
    resolve: `${N8N_BASE_URL}/qa/resolve`,   // POST: 標記已解決
    escalate: `${N8N_BASE_URL}/qa/escalate`, // POST: 直接寫入 (跳過 AI)
    clear: `${N8N_BASE_URL}/qa/clear`,       // POST: 清除所有資料
    hide: `${N8N_BASE_URL}/qa/hide`,         // POST: 切換隱藏狀態
    auth: `${N8N_BASE_URL}/qa/auth`,         // POST: 講者登入驗證
    verify: `${N8N_BASE_URL}/qa/verify`,      // POST: Token 驗證
    changePassword: `${N8N_BASE_URL}/qa/change-password` // POST: 更改密碼
};

// --- Global State ---
const state = {
    isChatOpen: false,
    messages: JSON.parse(localStorage.getItem('chatMessages')) || [],
    currentTab: 'pending',
    questions: JSON.parse(localStorage.getItem('qa_questions')) || []
};

// Helper to save state
function saveQuestions() {
    localStorage.setItem('qa_questions', JSON.stringify(state.questions));

    // Dispatch event for cross-tab sync (optional but good for UX)
    window.dispatchEvent(new Event('storage'));
}

// --- DOM Elements ---
const toggleChatBtn = document.getElementById('toggleChatBtn');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatWindow = document.getElementById('chatWindow');
const questionInput = document.getElementById('questionInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const chatMessages = document.getElementById('chatMessages');
const speakerQuestionsGrid = document.getElementById('speakerQuestionsGrid');
const speakerLoginBtn = document.getElementById('speakerLoginBtn');
const loginModal = document.getElementById('loginModal');
const closeModalSpan = document.querySelector('.close-modal');
const passwordInput = document.getElementById('passwordInput');
const submitPasswordBtn = document.getElementById('submitPasswordBtn');
const loginError = document.getElementById('loginError');



// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Chat Widget Init
    if (chatMessages) initChatHistory();

    // Speaker Dashboard Init
    if (speakerQuestionsGrid) renderSpeakerDashboard();

    // Public Board Init (Audience)
    if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();

    // Event Listeners
    setupEventListeners();

    // Cross-tab synchronization
    window.addEventListener('storage', (e) => {
        if (e.key === 'qa_questions') {
            state.questions = JSON.parse(e.newValue) || [];
            if (speakerQuestionsGrid) renderSpeakerDashboard();
            if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();
        }
    });
});

// --- Public Question Board Logic ---
function renderPublicQuestions() {
    const grid = document.getElementById('publicQuestionsGrid');
    if (!grid) return;

    grid.innerHTML = '';

    // Filter pending AND NOT HIDDEN
    const publicQuestions = state.questions
        .filter(q => q.status === 'pending' && !q.isHidden)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (publicQuestions.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;">
            目前沒有待回覆的問題
        </div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    publicQuestions.forEach(q => {
        const card = document.createElement('div');
        card.classList.add('question-card');

        const timeString = new Date(q.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        card.innerHTML = `
            <div class="card-header">
                <span class="category-tag">${escapeHtml(q.category)}</span>
                <span>${timeString}</span>
            </div>
            <div class="question-text" style="font-size: 1rem; margin-bottom: 0.5rem;">${escapeHtml(q.text)}</div>
        `;
        fragment.appendChild(card);
    });

    requestAnimationFrame(() => {
        grid.innerHTML = '';
        grid.appendChild(fragment);
    });
}

function setupEventListeners() {
    // Chat
    if (toggleChatBtn) toggleChatBtn.addEventListener('click', toggleChat);
    if (closeChatBtn) closeChatBtn.addEventListener('click', toggleChat);
    if (sendMessageBtn) sendMessageBtn.addEventListener('click', handleSendMessage);
    if (questionInput) {
        questionInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
        // Auto-resize textarea as user types
        questionInput.addEventListener('input', () => {
            questionInput.style.height = 'auto';
            questionInput.style.height = Math.min(questionInput.scrollHeight, 100) + 'px';
        });
    }

    // Login Modal
    if (speakerLoginBtn) {
        speakerLoginBtn.addEventListener('click', () => {
            loginModal.classList.remove('hidden');
            setTimeout(() => passwordInput.focus(), 100);
        });
    }
    if (closeModalSpan) {
        closeModalSpan.addEventListener('click', closeModal);
    }
    if (submitPasswordBtn) submitPasswordBtn.addEventListener('click', checkPassword);
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkPassword();
        });
    }

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target === loginModal) closeModal();
    });
}

// --- Chat Logic (Audience) ---

function toggleChat() {
    state.isChatOpen = !state.isChatOpen;
    if (state.isChatOpen) {
        chatWindow.classList.add('active');
        toggleChatBtn.style.transform = 'scale(0)';
        setTimeout(() => questionInput.focus(), 100);
    } else {
        chatWindow.classList.remove('active');
        toggleChatBtn.style.transform = 'scale(1)';
    }
}

let lastSendTime = 0;
const SEND_COOLDOWN_MS = 5000;

function handleSendMessage() {
    const text = questionInput.value.trim();
    if (!text) return;
    if (text.length > 50) {
        addMessage('⚠️ 問題長度不得超過 50 字。', 'system', false);
        return;
    }

    const now = Date.now();
    if (now - lastSendTime < SEND_COOLDOWN_MS) {
        addMessage('⏳ 請稍候幾秒再發送下一則提問。', 'system', false);
        return;
    }
    lastSendTime = now;

    addMessage(text, 'user');
    questionInput.value = '';
    questionInput.style.height = 'auto';

    const loadingId = addLoadingIndicator();

    if (USE_N8N && N8N_BASE_URL) {
        // --- n8n API Mode ---
        fetch(N8N_ENDPOINTS.ask, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: text })
        })
            .then(res => res.json())
            .then(data => {
                removeMessage(loadingId);

                if (data.can_answer) {
                    addMessage(data.answer, 'system', true);
                } else {
                    const replyText = data.answer || '收到您的問題！AI 知識庫暫無解答，已將問題傳送給講者，請稍候。';
                    addMessage(replyText, 'system', false);

                    // Also add to local state for immediate UI feedback
                    const newQuestion = {
                        id: data.id || Date.now().toString(),
                        text: text,
                        category: data.category || '未分類',
                        timestamp: new Date().toISOString(),
                        status: 'pending',
                        isHidden: false,
                        suggestedReplies: data.suggested_replies || ['稍後回答', '請參考補充資料', '這是一個很好的問題']
                    };
                    state.questions.unshift(newQuestion);
                    saveQuestions();
                    if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();
                    if (speakerQuestionsGrid) renderSpeakerDashboard();
                }
            })
            .catch(err => {
                removeMessage(loadingId);
                console.error('n8n webhook error:', err);
                addMessage('⚠️ 連線失敗，請稍後再試。', 'system', false);
            });
    } else {
        // --- Mock Mode (LocalStorage) ---
        setTimeout(() => {
            removeMessage(loadingId);

            let replyText = '';
            let showFeedback = false;

            if (text.includes('你好') || text.includes('嗨')) {
                replyText = '你好！有什麼我可以幫你的嗎？';
                showFeedback = true;
            } else if (text.includes('投影片') || text.includes('簡報')) {
                replyText = '關於簡報檔案，講者稍後會提供下載連結喔！';
                showFeedback = true;
            } else {
                replyText = '收到您的問題！AI 知識庫暫無解答，已將問題傳送給講者，請稍候。';

                const newQuestion = {
                    id: Date.now().toString(),
                    text: text,
                    category: '未分類 (新提問)',
                    timestamp: new Date().toISOString(),
                    status: 'pending',
                    isHidden: false,
                    suggestedReplies: ['稍後回答', '請參考補充資料', '這是一個很好的問題']
                };

                state.questions.unshift(newQuestion);
                saveQuestions();

                if (typeof renderPublicQuestions === 'function' && document.getElementById('publicQuestionsGrid')) {
                    renderPublicQuestions();
                }
                if (typeof renderSpeakerDashboard === 'function' && document.getElementById('speakerQuestionsGrid')) {
                    renderSpeakerDashboard();
                }
            }

            addMessage(replyText, 'system', showFeedback);
        }, 1500);
    }
}

/** 將 HTML 特殊字元轉義，防止 XSS */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** 偵測純文字中的 URL 並轉換為可點擊的超連結 (已轉義的 HTML 輸入) */
function linkify(escapedHtml) {
    return escapedHtml.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#6366F1; text-decoration:underline;">$1</a>'
    );
}

function addMessage(text, type, showFeedback = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', type);
    msgDiv.innerHTML = linkify(escapeHtml(text));

    if (showFeedback && type === 'system') {
        const feedbackDiv = document.createElement('div');
        feedbackDiv.classList.add('feedback-actions');
        feedbackDiv.innerHTML = `
            <span style="font-size: 0.8rem; color: #64748B; margin-right: 8px;">這有幫助嗎？</span>
            <button onclick="handleFeedback(this, true)" class="feedback-btn like">👍</button>
            <button onclick="handleFeedback(this, false)" class="feedback-btn dislike">👎</button>
        `;
        msgDiv.appendChild(feedbackDiv);
    }

    chatMessages.appendChild(msgDiv);
    scrollToBottom();

    state.messages.push({ text, type, showFeedback });

    // Optimization: Keep only last 50 messages to prevent LS bloat
    if (state.messages.length > 50) {
        state.messages = state.messages.slice(-50);
    }

    localStorage.setItem('chatMessages', JSON.stringify(state.messages));

    return msgDiv;
}

function addLoadingIndicator() {
    const id = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.classList.add('message', 'system');
    msgDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function scrollToBottom() {
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initChatHistory() {
    if (state.messages.length > 0) {
        chatMessages.innerHTML = '';
        state.messages.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.classList.add('message', msg.type);
            msgDiv.innerHTML = linkify(escapeHtml(msg.text));

            if (msg.showFeedback) {
                const feedbackDiv = document.createElement('div');
                feedbackDiv.classList.add('feedback-actions');
                feedbackDiv.innerHTML = `
                    <span style="font-size: 0.8rem; color: #64748B; margin-right: 8px;">這有幫助嗎？</span>
                    <button onclick="handleFeedback(this, true)" class="feedback-btn like">👍</button>
                    <button onclick="handleFeedback(this, false)" class="feedback-btn dislike">👎</button>
                `;
                msgDiv.appendChild(feedbackDiv);
            }
            chatMessages.appendChild(msgDiv);
        });
        scrollToBottom();
    }
}

// --- Speaker Dashboard Logic ---

function renderSpeakerDashboard() {
    if (!speakerQuestionsGrid) return;

    speakerQuestionsGrid.innerHTML = '';
    const filteredQuestions = state.questions.filter(q => q.status === state.currentTab);

    if (filteredQuestions.length === 0) {
        speakerQuestionsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 3rem;">
            目前沒有${state.currentTab === 'pending' ? '待回覆' : '已解決'}的問題
        </div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    filteredQuestions.forEach(q => {
        const card = createQuestionCard(q);
        fragment.appendChild(card);
    });

    requestAnimationFrame(() => {
        speakerQuestionsGrid.innerHTML = '';
        speakerQuestionsGrid.appendChild(fragment);
    });
}

function createQuestionCard(question) {
    const card = document.createElement('div');
    card.classList.add('question-card');
    if (question.isHidden) {
        card.style.opacity = '0.6';
        card.style.borderLeftColor = '#94a3b8'; // Grey out
    }

    const timeString = new Date(question.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const questionText = question.text || question.Question || '';
    const replies = Array.isArray(question.suggestedReplies) ? question.suggestedReplies : [];
    const qId = String(question.id).replace(/'/g, "\\'");

    const actionButton = question.status === 'pending'
        ? `<button onclick="markAsResolved('${qId}')" style="color: var(--accent-success); border: none; background: none; cursor: pointer; font-weight: 500;">✓ 標記為已回答</button>`
        : `<span style="color: var(--text-secondary); font-size: 0.9rem;">已於 ${new Date().toLocaleTimeString()} 解決</span>`;

    const visibilityBtn = `<button onclick="toggleVisibility('${qId}')" style="color: ${question.isHidden ? 'var(--primary-color)' : '#64748B'}; border: none; background: none; cursor: pointer; font-size: 0.9rem; margin-right: 1rem;">
        ${question.isHidden ? '👁️ 解除隱藏' : '🚫 隱藏'}
    </button>`;

    const repliesHtml = replies.length > 0
        ? `<div class="suggested-replies">
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.25rem;">建議回覆：</div>
            ${replies.map(reply => `
                <button class="reply-btn" onclick="useReply(this)">${escapeHtml(reply)}</button>
            `).join('')}
        </div>`
        : '';

    card.innerHTML = `
        <div class="card-header">
            <span class="category-tag">${escapeHtml(question.category || '未分類')} ${question.isHidden ? '(隱藏中)' : ''}</span>
            <span>${timeString}</span>
        </div>
        <div class="question-text">${escapeHtml(questionText)}</div>
        ${repliesHtml}
        <div style="margin-top: 1rem; text-align: right; display: flex; justify-content: flex-end; align-items: center;">
            ${visibilityBtn}
            ${actionButton}
        </div>
    `;

    return card;
}

// --- System Management Logic ---

window.exportToCSV = function () {
    if (state.questions.length === 0) {
        alert('目前沒有資料可匯出');
        return;
    }

    // CSV Injection 防護：移除公式起始字元
    function sanitizeCsv(val) {
        const s = String(val);
        return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    }

    const bom = '\uFEFF';
    const headers = ['ID', 'Category', 'Question', 'Timestamp', 'Status', 'IsHidden'];
    const rows = state.questions.map(q => [
        sanitizeCsv(q.id),
        sanitizeCsv(q.category),
        `"${sanitizeCsv(q.text).replace(/"/g, '""')}"`,
        new Date(q.timestamp).toLocaleString(),
        q.status,
        q.isHidden ? 'Yes' : 'No'
    ]);

    const csvContent = bom + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `qa_session_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

window.clearAllData = function () {
    if (confirm('確定要清除所有問題與對話紀錄嗎？此動作無法復原。\n(這將開啟一個全新的問答場次)')) {
        state.questions = [];
        state.messages = [];
        localStorage.removeItem('chatMessages');
        saveQuestions();
        renderSpeakerDashboard();
        const publicGrid = document.getElementById('publicQuestionsGrid');
        if (publicGrid) publicGrid.innerHTML = '';

        // n8n: 同步清除 Google Sheets
        if (USE_N8N && N8N_BASE_URL) {
            resetSyncTimer();
            fetch(N8N_ENDPOINTS.clear, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'clear', token: sessionStorage.getItem('speaker_token') || '' })
            })
                .then(() => alert('資料已清除（含 Google Sheets），場次重置完成。'))
                .catch(err => {
                    console.error('n8n clear error:', err);
                    alert('本地資料已清除，但 Google Sheets 清除失敗，請手動清除。');
                });
        } else {
            alert('資料已清除，場次重置完成。');
        }
    }
}

window.toggleVisibility = function (id) {
    const qIndex = state.questions.findIndex(q => String(q.id) === String(id));
    if (qIndex > -1) {
        state.questions[qIndex].isHidden = !state.questions[qIndex].isHidden;
        saveQuestions();
        renderSpeakerDashboard();
        if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();

        // n8n: 同步隱藏狀態到 Google Sheets
        if (USE_N8N && N8N_BASE_URL) {
            fetch(N8N_ENDPOINTS.hide, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, isHidden: state.questions[qIndex].isHidden, token: sessionStorage.getItem('speaker_token') || '' })
            }).catch(err => console.error('n8n hide error:', err));
            resetSyncTimer();
        }
    }
}

// --- Global Functions (Exposed for HTML onclick) ---

window.handleFeedback = function (btn, isLike) {
    const container = btn.parentElement;

    if (isLike) {
        container.innerHTML = '<span style="color: #10B981; font-size: 0.85rem;">感謝您的回饋！</span>';
    } else {
        container.innerHTML = '<span style="color: #F59E0B; font-size: 0.85rem;">已收到回饋，此問題已轉送給講者。</span>';

        const systemMsgDiv = container.closest('.message.system');
        if (systemMsgDiv) {
            const userMsgDiv = systemMsgDiv.previousElementSibling;
            if (userMsgDiv && userMsgDiv.classList.contains('user')) {
                const questionText = userMsgDiv.textContent;

                const newQuestion = {
                    id: Date.now().toString(),
                    text: questionText,
                    category: '待解疑問 (回饋轉送)',
                    timestamp: new Date().toISOString(),
                    status: 'pending',
                    isHidden: false,
                    suggestedReplies: ['好的，我們會再補充說明', '請參考這份文件', '這個觀點很有趣']
                };

                state.questions.unshift(newQuestion);
                saveQuestions();

                if (typeof renderPublicQuestions === 'function' && document.getElementById('publicQuestionsGrid')) {
                    renderPublicQuestions();
                }
                if (typeof renderSpeakerDashboard === 'function' && document.getElementById('speakerQuestionsGrid')) {
                    renderSpeakerDashboard();
                }

                // n8n: 直接寫入 Google Sheets (跳過 AI)
                if (USE_N8N && N8N_BASE_URL) {
                    fetch(N8N_ENDPOINTS.escalate, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            question: questionText,
                            category: '待解疑問 (回饋轉送)',
                            suggested_replies: ['好的，我們會再補充說明', '請參考這份文件', '這個觀點很有趣']
                        })
                    }).catch(err => console.error('n8n escalation error:', err));
                    resetSyncTimer();
                }
            }
        }
    }
}

window.useReply = function (btn) {
    const originalText = btn.textContent;
    btn.textContent = '已發送！';
    btn.style.background = '#dcfce7';
    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '#f1f5f9';
    }, 2000);
}

window.switchTab = function (tabName) {
    state.currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
            btn.style.borderColor = 'var(--primary-color)';
            btn.style.color = 'var(--primary-color)';
            btn.style.fontWeight = '600';
        } else {
            btn.classList.remove('active');
            btn.style.borderColor = 'transparent';
            btn.style.color = 'var(--text-secondary)';
            btn.style.fontWeight = 'normal';
        }
    });
    renderSpeakerDashboard();
}

window.markAsResolved = function (id) {
    const qIndex = state.questions.findIndex(q => String(q.id) === String(id));
    if (qIndex > -1) {
        state.questions[qIndex].status = 'resolved';
        saveQuestions();
        renderSpeakerDashboard();

        // If n8n mode, also notify backend
        if (USE_N8N && N8N_BASE_URL) {
            fetch(N8N_ENDPOINTS.resolve, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, token: sessionStorage.getItem('speaker_token') || '' })
            }).catch(err => console.error('n8n resolve error:', err));
            resetSyncTimer();
        }
    }
}

// --- n8n Polling (Speaker Dashboard) ---
// Fetches latest questions from n8n backend and replaces local state
function fetchPendingQuestions() {
    if (!USE_N8N || !N8N_BASE_URL || !syncEnabled) return;

    fetch(N8N_ENDPOINTS.pending)
        .then(res => res.json())
        .then(data => {
            if (!syncEnabled) return; // 已關閉同步，忽略回應
            if (data.questions && Array.isArray(data.questions)) {
                // 以後端 (Google Sheets) 為單一事實來源 (ID 統一轉 string)
                state.questions = data.questions.map(remote => {
                    remote.id = String(remote.id);
                    return remote;
                });
                saveQuestions();
                if (speakerQuestionsGrid) renderSpeakerDashboard();
                if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();
            }
        })
        .catch(err => console.error('n8n pending fetch error:', err));
}

// --- n8n Polling Toggle ---
let syncEnabled = false;
let syncIntervalId = null;

function startSync() {
    if (syncIntervalId) return;
    syncEnabled = true;
    fetchPendingQuestions();
    syncIntervalId = setInterval(fetchPendingQuestions, 30000);
    updateSyncButton(true);
    console.log('[Sync] Started');
}

function stopSync() {
    syncEnabled = false;
    if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
    }
    updateSyncButton(false);
    console.log('[Sync] Stopped');
}

// 重置同步計時器：按下操作按鈕後延後下次同步，避免讀到尚未更新的 Google Sheets
function resetSyncTimer() {
    if (!syncEnabled || !syncIntervalId) return;
    clearInterval(syncIntervalId);
    syncIntervalId = setInterval(fetchPendingQuestions, 30000);
    console.log('[Sync] Timer reset');
}

function updateSyncButton(isOn) {
    const btn = document.getElementById('syncToggleBtn');
    if (!btn) return;

    if (isOn) {
        btn.innerHTML = '<span id="syncIndicator" class="sync-dot"></span> 自動同步：ON';
    } else {
        btn.innerHTML = '<span id="syncIndicator" class="sync-dot" style="background:#94a3b8; animation:none;"></span> 自動同步：OFF';
    }
}

window.toggleSync = function () {
    console.log('[Sync] Toggle clicked, current state:', syncEnabled);
    if (syncEnabled) {
        stopSync();
    } else {
        if (!USE_N8N || !N8N_BASE_URL) {
            alert('請先設定 n8n Webhook URL 才能啟用自動同步。');
            return;
        }
        startSync();
    }
};

// Auto-start polling if n8n is enabled and we're on a page that needs sync
if (USE_N8N && N8N_BASE_URL && (speakerQuestionsGrid || document.getElementById('publicQuestionsGrid'))) {
    startSync();
}

// --- Login Modal Implementations ---

// --- Change Password ---
window.changePassword = function () {
    const newPw = prompt('請輸入新的講者密碼（至少 4 個字元）：');
    if (!newPw) return;
    if (newPw.length < 4) {
        alert('密碼長度至少 4 個字元。');
        return;
    }

    const token = sessionStorage.getItem('speaker_token') || '';
    if (!token) {
        alert('Session 已過期，請重新登入。');
        window.location.href = 'index.html';
        return;
    }

    fetch(N8N_ENDPOINTS.changePassword, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: newPw })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert('✅ 密碼已成功更新！下次登入請使用新密碼。');
            } else {
                alert('❌ 更改失敗：' + (data.message || '未知錯誤'));
            }
        })
        .catch(err => {
            console.error('Change password error:', err);
            alert('連線失敗，請稍後再試。');
        });
}

function closeModal() {
    loginModal.classList.add('hidden');
    loginError.textContent = '';
    passwordInput.value = '';
}

function checkPassword() {
    const input = passwordInput.value;
    if (!input) return;

    // Disable button to prevent rapid submissions
    submitPasswordBtn.disabled = true;
    submitPasswordBtn.textContent = '驗證中...';

    if (USE_N8N && N8N_BASE_URL) {
        fetch(N8N_ENDPOINTS.auth, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: input })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.token) {
                    loginError.textContent = '';
                    sessionStorage.setItem('speaker_token', data.token);
                    window.location.href = 'speaker.html';
                } else {
                    loginError.textContent = '密碼錯誤，請重試。';
                    passwordInput.classList.add('shake');
                    setTimeout(() => passwordInput.classList.remove('shake'), 500);
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            })
            .catch(err => {
                console.error('Auth error:', err);
                loginError.textContent = '連線失敗，請稍後再試。';
            })
            .finally(() => {
                submitPasswordBtn.disabled = false;
                submitPasswordBtn.textContent = '確認';
            });
    } else {
        // Mock mode fallback
        sessionStorage.setItem('speaker_token', 'mock-token');
        window.location.href = 'speaker.html';
    }
}

// --- Speaker Session Verification ---
function verifySpeakerSession() {
    const token = sessionStorage.getItem('speaker_token');

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    if (USE_N8N && N8N_BASE_URL) {
        fetch(N8N_ENDPOINTS.verify, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        })
            .then(res => res.json())
            .then(data => {
                if (data.valid) {
                    document.body.style.visibility = 'visible';
                } else {
                    sessionStorage.removeItem('speaker_token');
                    window.location.href = 'index.html';
                }
            })
            .catch(err => {
                console.error('Token verify error:', err);
                // Graceful degradation: allow access on network error if token exists
                document.body.style.visibility = 'visible';
            });
    } else {
        // Mock mode
        document.body.style.visibility = 'visible';
    }
}
