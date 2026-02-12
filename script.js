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
    ask: `${N8N_BASE_URL}/qa`,           // POST: 提交問題
    pending: `${N8N_BASE_URL}/qa/pending`, // GET:  讀取待回覆
    resolve: `${N8N_BASE_URL}/qa/resolve`  // POST: 標記已解決
};

// --- Global State ---
const state = {
    isChatOpen: false,
    messages: JSON.parse(localStorage.getItem('chatMessages')) || [],
    currentTab: 'pending',
    questions: JSON.parse(localStorage.getItem('qa_questions')) || [
        {
            id: '1',
            text: '請問這份簡報之後會提供下載嗎？',
            category: '行政相關',
            timestamp: new Date().toISOString(),
            status: 'pending',
            isHidden: false,
            suggestedReplies: [
                '會的，會後將統一寄發 Email。',
                '簡報連結已置於活動官網。',
                '主要內容會釋出，部分敏顯資料會移除。'
            ]
        },
        {
            id: '2',
            text: '可以詳細解釋一下 n8n 的 webhook 設定嗎？',
            category: '技術細節',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            status: 'pending',
            isHidden: false,
            suggestedReplies: [
                '好的，我們稍後的 Demo 環節會詳細示範。',
                '這是個好問題，我們可以會後交流。',
                '請參考官方文件關於 Webhook 的章節。'
            ]
        }
    ]
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

const SPEAKER_PASSWORD = 'M&WttJ&cLSJ5NPN2mtzfeUu!eY&u8h';

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
                <span class="category-tag">${q.category}</span>
                <span>${timeString}</span>
            </div>
            <div class="question-text" style="font-size: 1rem; margin-bottom: 0.5rem;">${q.text}</div>
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

function handleSendMessage() {
    const text = questionInput.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    questionInput.value = '';

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

function addMessage(text, type, showFeedback = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', type);
    msgDiv.textContent = text;

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
            msgDiv.textContent = msg.text;

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

    const actionButton = question.status === 'pending'
        ? `<button onclick="markAsResolved('${question.id}')" style="color: var(--accent-success); border: none; background: none; cursor: pointer; font-weight: 500;">✓ 標記為已回答</button>`
        : `<span style="color: var(--text-secondary); font-size: 0.9rem;">已於 ${new Date().toLocaleTimeString()} 解決</span>`;

    const visibilityBtn = `<button onclick="toggleVisibility('${question.id}')" style="color: ${question.isHidden ? 'var(--primary-color)' : '#64748B'}; border: none; background: none; cursor: pointer; font-size: 0.9rem; margin-right: 1rem;">
        ${question.isHidden ? '👁️ 解除隱藏' : '🚫 隱藏'}
    </button>`;

    card.innerHTML = `
        <div class="card-header">
            <span class="category-tag">${question.category} ${question.isHidden ? '(隱藏中)' : ''}</span>
            <span>${timeString}</span>
        </div>
        <div class="question-text">${question.text}</div>
        <div class="suggested-replies">
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.25rem;">建議回覆：</div>
            ${question.suggestedReplies.map(reply => `
                <button class="reply-btn" onclick="useReply(this)">${reply}</button>
            `).join('')}
        </div>
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

    const bom = '\uFEFF';
    const headers = ['ID', 'Category', 'Question', 'Timestamp', 'Status', 'IsHidden'];
    const rows = state.questions.map(q => [
        q.id,
        q.category,
        `"${q.text.replace(/"/g, '""')}"`,
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
        saveQuestions(); // Update Questions LS
        renderSpeakerDashboard();
        // Clear Public Board mock
        const publicGrid = document.getElementById('publicQuestionsGrid');
        if (publicGrid) publicGrid.innerHTML = '';
        alert('資料已清除，場次重置完成。');
    }
}

window.toggleVisibility = function (id) {
    const qIndex = state.questions.findIndex(q => q.id === id);
    if (qIndex > -1) {
        state.questions[qIndex].isHidden = !state.questions[qIndex].isHidden;
        saveQuestions();
        renderSpeakerDashboard();
        // Since public board does not auto-refresh strictly in this mock without event listeners, 
        // we manually call it if it exists.
        if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();
    }
}

// --- Global Functions (Exposed for HTML onclick) ---

window.handleFeedback = function (btn, isLike) {
    const container = btn.parentElement;

    if (isLike) {
        container.innerHTML = '<span style="color: #10B981; font-size: 0.85rem;">感謝您的回饋！</span>';
    } else {
        container.innerHTML = '<span style="color: #F59E0B; font-size: 0.85rem;">已收到回饋，此問題已轉送給講者。</span>';

        // Logic: Find the original question text (Previous sibling of the system message parent)
        // Structure: .message.user -> .message.system(contains .feedback-actions)
        // So getting the system message div, then previous sibling.
        const systemMsgDiv = container.closest('.message.system');
        if (systemMsgDiv) {
            const userMsgDiv = systemMsgDiv.previousElementSibling;
            if (userMsgDiv && userMsgDiv.classList.contains('user')) {
                const questionText = userMsgDiv.textContent;

                // Add to Board
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
                saveQuestions(); // Sync to storage

                // Refresh Views
                if (typeof renderPublicQuestions === 'function' && document.getElementById('publicQuestionsGrid')) {
                    renderPublicQuestions();
                }
                if (typeof renderSpeakerDashboard === 'function' && document.getElementById('speakerQuestionsGrid')) {
                    renderSpeakerDashboard();
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
    const qIndex = state.questions.findIndex(q => q.id === id);
    if (qIndex > -1) {
        state.questions[qIndex].status = 'resolved';
        saveQuestions();
        renderSpeakerDashboard();

        // If n8n mode, also notify backend
        if (USE_N8N && N8N_BASE_URL) {
            fetch(N8N_ENDPOINTS.resolve, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            }).catch(err => console.error('n8n resolve error:', err));
        }
    }
}

// --- n8n Polling (Speaker Dashboard) ---
// Fetches latest questions from n8n backend and replaces local state
function fetchPendingQuestions() {
    if (!USE_N8N || !N8N_BASE_URL) return;

    fetch(N8N_ENDPOINTS.pending)
        .then(res => res.json())
        .then(data => {
            if (data.questions && Array.isArray(data.questions)) {
                state.questions = data.questions;
                saveQuestions();
                if (speakerQuestionsGrid) renderSpeakerDashboard();
                if (document.getElementById('publicQuestionsGrid')) renderPublicQuestions();
            }
        })
        .catch(err => console.error('n8n pending fetch error:', err));
}

// Auto-poll every 10 seconds if n8n is enabled and we're on the speaker page
if (USE_N8N && N8N_BASE_URL) {
    setInterval(fetchPendingQuestions, 10000);
}

// --- Login Modal Implementations ---

function closeModal() {
    loginModal.classList.add('hidden');
    loginError.textContent = '';
    passwordInput.value = '';
}

function checkPassword() {
    const input = passwordInput.value;
    if (input === SPEAKER_PASSWORD) {
        loginError.textContent = '';
        window.location.href = 'speaker.html';
    } else {
        loginError.textContent = '密碼錯誤，請重試。';
        passwordInput.classList.add('shake');
        setTimeout(() => passwordInput.classList.remove('shake'), 500);
        passwordInput.value = '';
        passwordInput.focus();
    }
}
