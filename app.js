/* =================================================================
   CONSTANTS & CONFIG
   ================================================================= */

const STORAGE_KEYS = Object.freeze({
    HISTORY: 'vAI_history',
    VERSION: 'vAI_ver'
});

const MEMORY_CONFIG = Object.freeze({
    CHAR_LIMIT_DEFAULT: 16000,
    MIN_MESSAGES: 10,
    CONTEXT_MESSAGES: 8
});

const API_CONFIG = Object.freeze({
    MODEL_READY_TIMEOUT: 5000,
    MODEL_CHECK_TIMEOUT: 3000,
    MAX_READY_ATTEMPTS: 60,
    CHECK_INTERVAL: 2000,
    RETRY_DELAY: 2000
});

/* =================================================================
   UTILITIES
   ================================================================= */

const Utils = {
    createTimeoutSignal(ms) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
},

    getContentLength(content) {
        if (Array.isArray(content)) {
            return content.reduce((sum, item) => sum + (item.text?.length || 0), 0);
        }
        return typeof content === 'string' ? content.length : 0;
    },

    parseMarkdownSafe(markdown) {
        if (typeof marked === 'undefined') return markdown;
        try {
            const rawHtml = marked.parse(markdown);
            return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
        } catch (e) {
            console.error('[vAI] Ошибка парсинга Markdown:', e);
            return markdown;
        }
    }
};

/* =================================================================
   STATE MANAGEMENT
   ================================================================= */

const AppState = {
    history: {},
    currentChatId: null,
    attachedFileData: null,
    currentVerKey: 'standard',
    isModelLoading: false,
    modelReadyCheckTimer: null,
    
    load() {
        try {
            const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
            this.history = savedHistory ? JSON.parse(savedHistory) : {};
            this.currentVerKey = localStorage.getItem(STORAGE_KEYS.VERSION) || 'standard';
        } catch (e) {
            console.error('[vAI] Ошибка загрузки состояния:', e);
            this.history = {};
            this.currentVerKey = 'standard';
        }
    },
    
    save() {
        try {
            localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
            localStorage.setItem(STORAGE_KEYS.VERSION, this.currentVerKey);
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.warn('[vAI] LocalStorage quota exceeded, clearing old chats...');
                this.trimOldChats();
                localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
            }
        }
    },
    
    trimOldChats() {
        const ids = Object.keys(this.history).sort();
        if (ids.length > 5) {
            const toDelete = ids.slice(0, Math.floor(ids.length / 2));
            toDelete.forEach(id => delete this.history[id]);
        }
    },
    
    cleanup() {
        if (this.modelReadyCheckTimer) clearTimeout(this.modelReadyCheckTimer);
    }
};

/* =================================================================
   DOM HELPER
   ================================================================= */

const DOM = {
    get(id) {
        return document.getElementById(id);
    }
};

/* =================================================================
   INITIALIZATION
   ================================================================= */

function initApp() {
    console.log(`[vAI] Initialization v${window.CONFIG?.APP_VERSION || '2.3.2'}`);
    
    AppState.load();
    initMarkdown();
    initPDF();
    
    if (window.UI && typeof window.UI.init === 'function') {
        window.UI.init();
    }
    
    initModelDropdown();
    updateSelectedModelDisplay(AppState.currentVerKey);
    setupEventListeners();
    loadOrCreateChat();
    
    setTimeout(checkServerStatus, 1000);
    window.addEventListener('beforeunload', () => AppState.cleanup());
}

function initMarkdown() {
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,      
            gfm: true,        
            headerIds: false,
            mangle: false,
            highlight: (code, lang) => {
                if (typeof hljs !== 'undefined') {
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                }
                return code;
            }
        });
    }
}

function initPDF() {
    if (typeof pdfjsLib !== 'undefined' && window.CONFIG?.PDF_WORKER) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = window.CONFIG.PDF_WORKER.trim();
    }
}

/* =================================================================
   UI HELPERS
   ================================================================= */

function updateSelectedModelDisplay(verKey) {
    const config = window.vAI_VERSIONS?.[verKey];
    if (!config) return;

    const iconEl = DOM.get('selected-icon');
    if (iconEl) {
        iconEl.innerHTML = window.MODEL_LOGOS?.[config.family] || config.icon || '🧠';
    }
    
    const labelEl = DOM.get('selected-label');
    if (labelEl) labelEl.textContent = config.label;
    
    const headerTitle = DOM.get('vAI-title');
    if (headerTitle) headerTitle.textContent = config.name;
}

function showConfirm(title, text, icon, onConfirm) {
    const panel = DOM.get('confirm-action-panel');
    if (!panel) return;

    if (DOM.get('confirm-title')) DOM.get('confirm-title').textContent = title;
    if (DOM.get('confirm-text')) DOM.get('confirm-text').textContent = text;
    if (DOM.get('confirm-icon')) DOM.get('confirm-icon').textContent = icon;

    const btn = DOM.get('action-confirm-btn');
    if (btn) {
        btn.onclick = () => {
            onConfirm();
            closeConfirmPanel();
        };
    }

    panel.style.display = 'block';
    void panel.offsetWidth;
    panel.classList.add('active');
    panel.style.opacity = '1';
    panel.style.transform = 'translate(-50%, -50%) scale(1)';
}

function closeConfirmPanel() {
    const panel = DOM.get('confirm-action-panel');
    if (!panel) return;
    panel.classList.remove('active');
    panel.style.opacity = '0';
    panel.style.transform = 'translate(-50%, -50%) scale(0.9)';
    setTimeout(() => { if (!panel.classList.contains('active')) panel.style.display = 'none'; }, 400);
}

function closeFileStatus() {
    const panel = DOM.get('file-success-panel');
    if (!panel) return;
    panel.classList.remove('active');
    panel.style.opacity = '0';
    panel.style.transform = 'translate(-50%, -50%) scale(0.9)';
    setTimeout(() => { panel.style.display = 'none'; }, 400);
}

/* =================================================================
   CHAT & STREAMING LOGIC
   ================================================================= */

async function talk() {
    const input = DOM.get('user-input');
    if (!input) return;
    
    const text = input.value.trim();
    if (!text && !AppState.attachedFileData) return;

    const chat = AppState.history[AppState.currentChatId];
    if (chat?.messages?.length > 0 && chat.modelKey !== AppState.currentVerKey) {
        DOM.get('model-warning-panel')?.classList.add('active');
        return;
    }

    DOM.get('welcome-panel')?.classList.add('fly-away');

    let displayMsg = text;
    let apiContent = text;

    if (AppState.attachedFileData) {
        if (AppState.attachedFileData.type === 'image') {
            apiContent = [
                { type: "text", text: text || "Что на фото?" },
                { type: "image_url", image_url: { url: AppState.attachedFileData.data } }
            ];

        } else if (AppState.attachedFileData.type === 'pdf') {
            apiContent = `[Файл: ${AppState.attachedFileData.name}]\n${AppState.attachedFileData.data}\n\nВопрос: ${text}`;
            displayMsg = `📄 ${AppState.attachedFileData.name}\n${text}`;
        }
    }

    window.UI.createBubble('user', displayMsg);
    input.value = '';
    input.style.height = '56px'; 
    input.focus(); 
    const aiBubbleContent = window.UI.createBubble('assistant', '', false);
    let fullRes = "";

    try {
        let sysPrompt = chat.systemPromptOverride || window.vAI_VERSIONS?.[chat.modelKey]?.systemPrompt || window.SYSTEM_PROMPT || "Ты полезный ассистент.";
        chat.systemPromptOverride = sysPrompt;

        const messagesPayload = buildMessagesPayload(chat, sysPrompt, apiContent);

        const res = await fetch(window.CONFIG?.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.CONFIG?.API_KEY || 'empty'}`
            },
            body: JSON.stringify({
                model: window.vAI_VERSIONS?.[AppState.currentVerKey]?.id || 'default',
                messages: messagesPayload,
                stream: true,
            })
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        removeAttachedFile();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ""; 
        let lastRenderTime = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); 

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine.startsWith('data: ')) continue;
                
                const dataStr = trimmedLine.slice(6).trim();
                if (dataStr === '[DONE]') continue;
                
                try {
                    const json = JSON.parse(dataStr);
                    const content = json.choices?.[0]?.delta?.content;
                    if (content) {
                        fullRes += content;
                        const now = Date.now();
                        if (now - lastRenderTime > 50) {
                            aiBubbleContent.innerHTML = Utils.parseMarkdownSafe(fullRes);
                            const flow = DOM.get('chat-flow');
                            if (flow) flow.scrollTop = flow.scrollHeight;
                            lastRenderTime = now;
                        }
                    }
                } catch (e) {
                }
            }
        }

        aiBubbleContent.innerHTML = Utils.parseMarkdownSafe(fullRes);
        
        if (typeof hljs !== 'undefined') {
            aiBubbleContent.querySelectorAll('pre code:not(.hljs)').forEach(b => {
                hljs.highlightElement(b);
            });
        }
        
        const flow = DOM.get('chat-flow');
        if (flow) requestAnimationFrame(() => flow.scrollTop = flow.scrollHeight);
        chat.messages.push({ role: 'assistant', content: fullRes });
        manageMemory();
        AppState.save();
        updateContext();

    } catch (err) {
        console.error('[vAI] Send error:', err);
        aiBubbleContent.innerHTML = `<span style="color:var(--accent-pink)">⚠️ Error: ${err.message}. Check your connection.</span>`;
    }
}

function buildMessagesPayload(chat, sysPrompt, currentContent) {
    const payload = [{ role: "system", content: sysPrompt }];
    const contextMessages = chat.messages?.slice(-MEMORY_CONFIG.CONTEXT_MESSAGES) || [];

    contextMessages.forEach(msg => {
        const lastMsg = payload[payload.length - 1];
        if (lastMsg && lastMsg.role === msg.role) {
            lastMsg.content += "\n\n" + (msg.content || '');
        } else {
            payload.push({ role: msg.role, content: msg.content || '' });
        }
    });

    const lastMsg = payload[payload.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content += "\n\n" + (typeof currentContent === 'string' ? currentContent : "Attachment.");
    } else {
        payload.push({ role: "user", content: currentContent });
    }

    return payload;
}

/* =================================================================
   MEMORY & CONTEXT
   ================================================================= */

function manageMemory() {
    const chat = AppState.history[AppState.currentChatId];
    if (!chat || !chat.messages) return;

    const limit = window.vAI_VERSIONS?.[AppState.currentVerKey]?.maxChars || MEMORY_CONFIG.CHAR_LIMIT_DEFAULT;
    const getLen = () => chat.messages.reduce((sum, m) => sum + Utils.getContentLength(m.content), 0);
    while (getLen() > limit && chat.messages.length > MEMORY_CONFIG.MIN_MESSAGES) {
        chat.messages.splice(0, 2); 
    }
}

function updateContext() {
    const chat = AppState.history[AppState.currentChatId];
    if (!chat) return;

    const limit = window.vAI_VERSIONS?.[AppState.currentVerKey]?.maxChars || MEMORY_CONFIG.CHAR_LIMIT_DEFAULT;
    const currentText = chat.messages?.reduce((sum, m) => sum + Utils.getContentLength(m.content), 0) || 0;
    const percent = Math.min((currentText / limit) * 100, 100);

    if (DOM.get('ctx-val')) DOM.get('ctx-val').textContent = currentText.toLocaleString();
    if (DOM.get('ctx-max')) DOM.get('ctx-max').textContent = limit.toLocaleString();

    const memoryBar = DOM.get('memory-bar');
    if (memoryBar) {
        memoryBar.style.width = `${percent}%`;
        memoryBar.style.background = percent > 80 ? 'var(--accent-pink)' : 'linear-gradient(90deg, var(--accent-purple), var(--accent-pink))';
        memoryBar.style.boxShadow = percent > 80 ? '0 0 15px var(--accent-pink)' : '0 0 10px var(--accent-purple)';
    }
}

/* =================================================================
   FILE HANDLING
   ================================================================= */

async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    const btn = DOM.get('attach-btn-main');
    
    if (!file) {
        if (btn) btn.classList.remove('loading');
        return;
    }

    const maxSize = (window.CONFIG?.LIMITS?.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
    if (file.size > maxSize) {
        alert(`The file is too large. Maximum: ${window.CONFIG?.LIMITS?.MAX_FILE_SIZE_MB || 10} MB`);
        e.target.value = '';
        if (btn) btn.classList.remove('loading');
        return;
    }

    try {
        if (file.type.startsWith('image/')) {
            await handleImageFile(file);
        } else if (file.type === 'application/pdf') {
            await handlePdfFile(file);
        } else {
            throw new Error('Only images and PDFs are supported.');
        }
    } catch (err) {
        console.error('[vAI] File Error:', err);
        alert(`Error: ${err.message}`);
        if (btn) btn.classList.remove('loading');
    }
}

async function handleImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            AppState.attachedFileData = { type: 'image', data: e.target.result, name: file.name };
            const html = `<img src="${e.target.result}" style="width:80px;height:80px;object-fit:cover;border-radius:15px;border:2px solid var(--accent-purple);">`;
            finishAttachment(file.name, html);
            resolve();
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handlePdfFile(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js не загружен');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    const pagesToProcess = Math.min(pdf.numPages, 20);
    
    const pagePromises = [];
    for (let i = 1; i <= pagesToProcess; i++) {
        pagePromises.push(
            pdf.getPage(i).then(async page => {
                const content = await page.getTextContent();
                return content.items.map(item => item.str || "").join(" ");
            })
        );
    }
    
    const pagesText = await Promise.all(pagePromises);
    let fullText = pagesText.join("\n\n");
    
    if (pdf.numPages > 20) fullText += `\n\n[... ещё ${pdf.numPages - 20} страниц не обработано ...]`;
    
    AppState.attachedFileData = { type: 'pdf', data: fullText, name: file.name };
    const html = `<div style="width:80px;height:80px;background:rgba(255,255,255,0.1);border-radius:15px;display:flex;align-items:center;justify-content:center;color:#ff2d55;font-weight:bold;border:1px solid rgba(255,255,255,0.2);">PDF</div>`;
    finishAttachment(file.name, html);
}

function finishAttachment(fileName, previewHtml) {
    const btn = DOM.get('attach-btn-main');
    if (btn) btn.classList.remove('loading');
    
    if (DOM.get('preview-container')) DOM.get('preview-container').innerHTML = previewHtml;
    if (DOM.get('file-status-name')) DOM.get('file-status-name').textContent = fileName;

    const panel = DOM.get('file-success-panel');
    if (panel) {
        panel.style.display = 'block';
        void panel.offsetWidth;
        panel.style.opacity = '1';
        panel.style.transform = 'translate(-50%, -50%) scale(1)';
        panel.classList.add('active');
    }
}

function removeAttachedFile() {
    AppState.attachedFileData = null;
    if (DOM.get('file-input')) DOM.get('file-input').value = "";
    closeFileStatus();
}

/* =================================================================
   MODEL MANAGEMENT & DROPDOWN
   ================================================================= */

async function applyVersion(verKey) {
    if (AppState.isModelLoading) return;
    const config = window.vAI_VERSIONS?.[verKey];
    if (!config) return;

    AppState.isModelLoading = true;
    AppState.currentVerKey = verKey;

    const overlay = DOM.get('ai-loader-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
    }
    if (DOM.get('loader-status-text')) DOM.get('loader-status-text').textContent = `Loading ${config.name}...`;
    if (DOM.get('loader-progress')) DOM.get('loader-progress').style.width = '5%';

    try {
        if (window.CONFIG?.SERVER_IP) {
            await fetch(`${window.ENV.getProtocol()}//${window.CONFIG.SERVER_IP}:8000/switch_model?config_name=${encodeURIComponent(verKey)}`, {
                method: 'POST',
                signal: Utils.createTimeoutSignal(API_CONFIG.MODEL_READY_TIMEOUT).signal
            }).catch(() => {});
        }

        await new Promise(r => setTimeout(r, API_CONFIG.RETRY_DELAY));
        await waitForModelReady();

        const chat = AppState.history[AppState.currentChatId];
        if (chat) {
            chat.modelKey = verKey;
            chat.modelLabel = config.label;
            chat.modelIcon = config.icon;
            chat.systemPromptOverride = config.systemPrompt;
            chat.title = `Новая беседа (${config.label})`;
        }

        if (config.theme) {
            const root = document.documentElement;
            if (config.theme.purple) root.style.setProperty('--accent-purple', config.theme.purple);
            if (config.theme.blue) root.style.setProperty('--accent-blue', config.theme.blue);
            if (config.theme.pink) root.style.setProperty('--accent-pink', config.theme.pink);
            if (config.theme.extra) root.style.setProperty('--accent-cyan', config.theme.extra);
        }

        updateSelectedModelDisplay(verKey);
        updateContext();
        if (window.UI?.renderHistory) window.UI.renderHistory();

    } finally {
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.style.display = 'none', 500);
        }
        AppState.isModelLoading = false;
        AppState.save();
    }
}

async function waitForModelReady() {
    let attempts = 0;
    return new Promise(resolve => {
        const check = async () => {
            attempts++;
            if (DOM.get('loader-progress')) DOM.get('loader-progress').style.width = `${Math.min(10 + attempts * 1.5, 98)}%`;

            try {
                const res = await fetch(`${window.ENV.getProtocol()}//${window.CONFIG.SERVER_IP}:1337/v1/models`, {
                    signal: Utils.createTimeoutSignal(API_CONFIG.MODEL_CHECK_TIMEOUT).signal
                });
                if (res.ok) {
                    if (DOM.get('loader-progress')) DOM.get('loader-progress').style.width = '100%';
                    AppState.cleanup();
                    return resolve();
                }
            } catch (e) {}

            if (attempts >= API_CONFIG.MAX_READY_ATTEMPTS) {
                AppState.cleanup();
                resolve();
            } else {
                AppState.modelReadyCheckTimer = setTimeout(check, API_CONFIG.CHECK_INTERVAL);
            }
        };
        check();
    });
}

async function checkServerStatus() {
    const { signal, clear } = Utils.createTimeoutSignal(API_CONFIG.MODEL_CHECK_TIMEOUT);
    try {
        const res = await fetch(window.CONFIG.STATUS_URL, { signal });
        clear();
        if (!res.ok) applyVersion(AppState.currentVerKey);
    } catch (e) {
        clear(); 
        applyVersion(AppState.currentVerKey);
    }
}

function initModelDropdown() {
    const list = DOM.get('model-dropdown-list');
    if (!list || !window.vAI_VERSIONS) return;
    
    list.innerHTML = '';
    Object.entries(window.vAI_VERSIONS).forEach(([key, config]) => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        
        const iconSvg = window.MODEL_LOGOS?.[config.family] || config.icon || '🧠';
        
        item.innerHTML = `
            <div class="model-icon-container">${iconSvg}</div>
            <div class="model-info"><span class="model-name">${config.name}</span></div>
        `;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            applyVersion(key);
            toggleDropdown();
        });
        list.appendChild(item);
    });
}

function toggleDropdown(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    DOM.get('model-dropdown')?.classList.toggle('active');
}

/* =================================================================
   SESSION & EVENT LISTENERS
   ================================================================= */

function loadOrCreateChat() {
    const chatIds = Object.keys(AppState.history).sort((a, b) => b - a);
    
    if (chatIds.length > 0) {
        switchChat(Number(chatIds[0]));
    } else {
        createNewChat();
    }
}

   function createNewChat() {
    DOM.get('welcome-panel')?.classList.remove('fly-away');
    AppState.currentChatId = Date.now();
    const config = window.vAI_VERSIONS?.[AppState.currentVerKey];

    AppState.history[AppState.currentChatId] = {
        title: `Chat (${config?.label || 'AI'})`,
        messages: [],
        modelKey: AppState.currentVerKey,
        modelLabel: config?.label || 'AI',
        modelIcon: config?.icon || '🧠',
        systemPromptOverride: config?.systemPrompt || '',
        createdAt: Date.now()
    };

    if (DOM.get('chat-flow')) DOM.get('chat-flow').innerHTML = '';
    AppState.save();
    updateContext();
    if (window.UI?.renderHistory) window.UI.renderHistory();
    if (DOM.get('sidebar')?.classList.contains('open')) window.UI.toggleSidebar();
}

function switchChat(id) {
    const chat = AppState.history[id];
    if (!chat) return;

    AppState.currentChatId = id;
    
    const welcome = DOM.get('welcome-panel');
    if (welcome) {
        chat.messages?.length > 0 ? welcome.classList.add('fly-away') : welcome.classList.remove('fly-away');
    }

    if (chat.modelKey && chat.modelKey !== AppState.currentVerKey) {
        applyVersion(chat.modelKey);
    }

    const flow = DOM.get('chat-flow');
    if (flow) {
        flow.innerHTML = '';
        
        if (chat.messages && chat.messages.length > 0) {
            chat.messages.forEach(m => {
                window.UI.createBubble(m.role, m.content, false);
            });

            requestAnimationFrame(() => {
                if (typeof hljs !== 'undefined') {
                    flow.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }
                flow.scrollTop = flow.scrollHeight;
            });
        }
    }

    updateContext();
    if (DOM.get('sidebar')?.classList.contains('open')) window.UI.toggleSidebar();
}

function clearCurrentChat() {
    showConfirm("Clear history?", "The memory archive and current correspondence will be deleted.", "🗑️", () => {
        const chat = AppState.history[AppState.currentChatId];
        if (chat) {
            chat.messages = [];
            AppState.save();
            if (DOM.get('chat-flow')) DOM.get('chat-flow').innerHTML = '';
            DOM.get('welcome-panel')?.classList.remove('fly-away');
            updateContext();
            if (window.UI?.renderHistory) window.UI.renderHistory();
        }
    });
}

function resetEverything() {
    showConfirm("Full reset?", "All vAI memory will be deleted without the possibility of recovery.", "⚠️", () => {
        localStorage.removeItem(STORAGE_KEYS.HISTORY);
        localStorage.removeItem(STORAGE_KEYS.VERSION);
        location.reload();
    });
}

function exportMemory() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(AppState.history, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `vAI_memory_${Date.now()}.json`;
    a.click();
}

function setupEventListeners() {
    document.querySelectorAll('.send-btn, .attach-btn').forEach(btn => {
        btn.addEventListener('pointerdown', function() {
            const isSendBtn = this.classList.contains('send-btn');
            const isInputFocused = document.activeElement === DOM.get('user-input');
            
            const baseScale = (isSendBtn && isInputFocused) ? 0.85 : 1;
            const squashScale = (isSendBtn && isInputFocused) ? 0.75 : 0.85;
            this.animate([
                { transform: `scale(${baseScale})`, boxShadow: '0 8px 20px rgba(255, 45, 85, 0.3)' },
                { transform: `scale(${squashScale})`, boxShadow: '0 2px 10px rgba(255, 45, 85, 0.5)', offset: 0.3 },
                { transform: `scale(${baseScale})`, boxShadow: '0 8px 20px rgba(255, 45, 85, 0.3)' }
            ], {
                duration: 550,
                easing: 'ease-out', 
                fill: 'none',
            });
        });
    });

    const input = DOM.get('user-input');
    if (input) {
        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                talk();
            }
        });
    }

    const attachBtn = DOM.get('attach-btn-main');
    if (attachBtn) {
        attachBtn.addEventListener('click', () => {
            attachBtn.classList.add('loading');
        });
    }
    
    DOM.get('file-input')?.addEventListener('change', handleFileSelect);
    
    DOM.get('overlay')?.addEventListener('click', () => { 
        if (window.UI?.toggleSidebar) window.UI.toggleSidebar(); 
    });

    window.addEventListener('focus', () => {
        setTimeout(() => {
            if (!DOM.get('file-input')?.files?.length) {
                DOM.get('attach-btn-main')?.classList.remove('loading');
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        const dropdown = DOM.get('model-dropdown');
        if (dropdown && !dropdown.contains(e.target)) dropdown.classList.remove('active');
    });
}

/* =================================================================
   GLOBAL EXPORTS
   ================================================================= */

window.talk = talk;
window.switchChat = switchChat;
window.applyVersion = applyVersion;
window.toggleDropdown = toggleDropdown;
window.clearCurrentChat = clearCurrentChat;
window.resetEverything = resetEverything;
window.removeAttachedFile = removeAttachedFile;
window.exportMemory = exportMemory;
window.closeConfirmPanel = closeConfirmPanel;
window.closeFileStatus = closeFileStatus;
window.createNewChat = createNewChat;
window.Utils = Utils;

window.AppState = AppState;
window.DOM = DOM;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}