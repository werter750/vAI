/* =================================================================
   CONSTANTS
   ================================================================= */

const UI_CONFIG = Object.freeze({
    MODAL_ANIMATION_DURATION: 400,
    EMPTY_HISTORY_MESSAGE: 'История пуста',
    DELETE_MODAL_ID: 'modal-overlay',
    HISTORY_LIST_ID: 'history-list',
    CHAT_FLOW_ID: 'chat-flow',
    SIDEBAR_ID: 'sidebar',
    OVERLAY_ID: 'overlay',
    MODEL_WARNING_ID: 'model-warning-panel',
    CONFIRM_DEL_BTN_ID: 'confirm-del',
    ESCAPE_KEY: 'Escape',
    TOAST_DURATION: 2000
});

/* =================================================================
   UI STATE 
   ================================================================= */

const UIState = {
    pendingDeleteId: null,
    eventHandlers: {},
    
    setPendingDelete(id) { this.pendingDeleteId = id; },
    clearPendingDelete() { this.pendingDeleteId = null; },
    getPendingDelete() { return this.pendingDeleteId; },
    
    cleanup() {
        Object.values(this.eventHandlers).forEach(handler => {
            if (handler.element && handler.event && handler.func) {
                handler.element.removeEventListener(handler.event, handler.func);
            }
        });
        this.eventHandlers = {};
    },
    
    registerHandler(element, event, func) {
        const id = `${element.id || 'anon'}_${event}_${Date.now()}`;
        this.eventHandlers[id] = { element, event, func };
    }
};

/* =================================================================
   UI OBJECT 
   ================================================================= */

const UI = {
    escapeHtml(text) {
        if (typeof text !== 'string') return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    /* =================================================================
       HISTORY
       ================================================================= */

    renderHistory() {
        const list = document.getElementById(UI_CONFIG.HISTORY_LIST_ID);
        if (!list) return;

        const chatHistory = window.AppState?.history || {};
        const currentChatId = window.AppState?.currentChatId;
        const ids = Object.keys(chatHistory).sort((a, b) => b - a);
        
        if (ids.length === 0) {
            list.innerHTML = `<div class="empty-history-message">${UI_CONFIG.EMPTY_HISTORY_MESSAGE}</div>`;
            return;
        }

        list.innerHTML = ids.map(id => {
            const chat = chatHistory[id];
            if (!chat) return '';

            const isActive = String(id) === String(currentChatId);
            const modelConfig = window.vAI_VERSIONS?.[chat.modelKey];
            const icon = window.MODEL_LOGOS?.[modelConfig?.family] || chat.modelIcon || 'G';
            
            const title = this.escapeHtml(chat.title || 'Без названия');

            return `
                <div class="history-item ${isActive ? 'active' : ''}" data-chat-id="${id}">
                    <span class="history-item-title" data-chat-id="${id}">
                        <span class="history-model-letter">${icon}</span> ${title}
                    </span>
                    <div class="history-actions">
                        <span class="info-chat" data-chat-id="${id}">i</span>
                        <span class="del-chat" data-chat-id="${id}">🗑</span>
                    </div>
                </div>
            `;
        }).join('');

        this.attachHistoryEventListeners(list);
    },

    attachHistoryEventListeners(list) {
        if (!list) return;

        const oldHandler = UIState.eventHandlers['historyListClick'];
        if (oldHandler) {
            oldHandler.element.removeEventListener(oldHandler.event, oldHandler.func);
        }

        const clickHandler = (e) => {
            const title = e.target.closest('.history-item-title');
            const delBtn = e.target.closest('.del-chat');
            const infoBtn = e.target.closest('.info-chat'); 
            
            if (infoBtn) {
                e.stopPropagation();
                const chatId = infoBtn.getAttribute('data-chat-id');
                if (chatId) this.showModelInfo(Number(chatId)); 
                return;
            }

            if (delBtn) {
                e.stopPropagation();
                const chatId = delBtn.getAttribute('data-chat-id');
                if (chatId) this.openDeleteModal(Number(chatId));
                return; 
            }

            const item = e.target.closest('.history-item');
            if (item) {
                const chatId = item.getAttribute('data-chat-id');
                if (chatId && typeof window.switchChat === 'function') {
                    window.switchChat(Number(chatId));
                }
            }
        };

        list.addEventListener('click', clickHandler);
        UIState.registerHandler(list, 'click', clickHandler);
    },

    /* =================================================================
       MODALS 
       ================================================================= */

    openDeleteModal(id) {
        UIState.setPendingDelete(id);
        const modal = document.getElementById(UI_CONFIG.DELETE_MODAL_ID);
        if (modal) {
            modal.style.display = 'flex';
            void modal.offsetWidth; 
            modal.classList.add('active');
        }
    },

    closeDeleteModal() {
        const modal = document.getElementById(UI_CONFIG.DELETE_MODAL_ID);
        if (!modal) return;

        modal.classList.remove('active');
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.style.display = 'none';
            }
        }, UI_CONFIG.MODAL_ANIMATION_DURATION);
    },

    handleDeleteConfirm() {
        const pendingId = UIState.getPendingDelete();
        if (pendingId === null) return;
        
        if (window.AppState?.history) {
            delete window.AppState.history[pendingId];
            window.AppState.save();
        }

        const currentChatId = window.AppState?.currentChatId;
        if (String(currentChatId) === String(pendingId)) {
            if (typeof window.createNewChat === 'function') window.createNewChat();
        } else {
            this.renderHistory();
        }

        this.closeDeleteModal();
        UIState.clearPendingDelete();
    },
    showModelInfo(chatId = null) {
        const modal = document.getElementById('info-modal');
        const nameSpan = document.getElementById('info-model-full-name');
        
        const targetId = chatId || window.AppState?.currentChatId;
        const chat = window.AppState?.history[targetId];

        if (chat && nameSpan) {
            const modelConfig = window.vAI_VERSIONS[chat.modelKey];
            nameSpan.textContent = modelConfig ? modelConfig.name : "The model is not defined";
            
            if (modelConfig?.theme?.purple) {
                nameSpan.style.color = modelConfig.theme.purple;
            }
        }

        if (modal) {
            modal.style.display = 'flex';
            void modal.offsetWidth; 
            modal.classList.add('active');
        }
    },

    closeInfoModal() {
        const modal = document.getElementById('info-modal');
        if (!modal) return;

        modal.classList.remove('active'); 
        
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.style.display = 'none'; 
            }
        }, 400);
    },

    /* =================================================================
       CHAT BUBBLES
       ================================================================= */

    createBubble(role, text = "", shouldSave = true) {
        const flow = document.getElementById(UI_CONFIG.CHAT_FLOW_ID);
        if (!flow) return null;

        if (role === 'assistant' && text === "") {
            shouldSave = false;
        }

        const container = document.createElement('div');
        container.className = `bubble-container ${role}-container`;

        
let htmlContent = "";
if (role === 'assistant') {
    htmlContent = window.Utils ? window.Utils.parseMarkdownSafe(text) : this.escapeHtml(text);
} else {
    htmlContent = this.escapeHtml(text);
}

        container.innerHTML = `
            <div class="bubble ${role}">
                <div class="content">${htmlContent}</div>
            </div>
            ${role === 'assistant' ? `
            <div class="action-row">
                <button class="copy-btn" aria-label="Copy">
                    <svg class="icon-copy" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <svg class="icon-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34c759" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
                <span class="copy-toast">Copied</span>
            </div>
            ` : ''}
        `;

        if (shouldSave && window.AppState?.history && window.AppState?.currentChatId) {
            window.AppState.history[window.AppState.currentChatId].messages.push({ role, content: text });
            window.AppState.save();
        }

        flow.appendChild(container);
        
        requestAnimationFrame(() => {
            container.classList.add('show');
            setTimeout(() => { container.style.willChange = 'auto'; }, 400);
        });
        
        setTimeout(() => {
        flow.scrollTo({ top: flow.scrollHeight, behavior: 'smooth' });
       }, 50);
        return container.querySelector('.content');
    },

    /* =================================================================
       SIDEBAR & WARNINGS
       ================================================================= */
       handleCopy(btn, container) {
        const contentEl = container.querySelector('.content');
        if (!contentEl) return;
        
        // innerText сохраняет форматирование Markdown (отступы, списки)
        navigator.clipboard.writeText(contentEl.innerText.trim()).then(() => {
            btn.classList.add('copied');
            const toast = btn.nextElementSibling;
            if (toast) toast.classList.add('show');

            setTimeout(() => {
                btn.classList.remove('copied');
                if (toast) toast.classList.remove('show');
            }, UI_CONFIG.TOAST_DURATION);
        }).catch(err => {
            console.error('[UI] Copy error:', err);
        });
    },

    toggleSidebar() {
        const sidebar = document.getElementById(UI_CONFIG.SIDEBAR_ID);
        const overlay = document.getElementById(UI_CONFIG.OVERLAY_ID);
        
        if (!sidebar || !overlay) return;

        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
        
        if (sidebar.classList.contains('open')) {
            this.renderHistory();
        }
    },

    closeWarning() {
        const warning = document.getElementById(UI_CONFIG.MODEL_WARNING_ID);
        if (warning) warning.classList.remove('active');

        const currentChatId = window.AppState?.currentChatId;
        if (currentChatId && window.AppState?.history?.[currentChatId]?.modelKey) {
            const modelKey = window.AppState.history[currentChatId].modelKey;
            if (typeof window.applyVersion === 'function') {
                window.applyVersion(modelKey);
            }
        }
    },

    /* =================================================================
       INITIALIZATION
       ================================================================= */

    init() {
        console.log('[UI] Инициализация...');

        const confirmDelBtn = document.getElementById(UI_CONFIG.CONFIRM_DEL_BTN_ID);
        if (confirmDelBtn) {
            const clickHandler = () => this.handleDeleteConfirm();
            confirmDelBtn.addEventListener('click', clickHandler);
            UIState.registerHandler(confirmDelBtn, 'click', clickHandler);
        }

        const overlay = document.getElementById(UI_CONFIG.DELETE_MODAL_ID);
        if (overlay) {
            const overlayHandler = (e) => {
                if (e.target === overlay) this.closeDeleteModal();
            };
            overlay.addEventListener('click', overlayHandler);
            UIState.registerHandler(overlay, 'click', overlayHandler);
        }

        const flow = document.getElementById(UI_CONFIG.CHAT_FLOW_ID);
flow.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
        const container = copyBtn.closest('.bubble-container');
        // Вызываем функцию UI.handleCopy
        UI.handleCopy(copyBtn, container); 
    }
})

        const escapeHandler = (e) => {
            if (e.key === UI_CONFIG.ESCAPE_KEY) {
                const modal = document.getElementById(UI_CONFIG.DELETE_MODAL_ID);
                if (modal && modal.classList.contains('active')) {
                    this.closeDeleteModal();
                }
            }
        };
        document.addEventListener('keydown', escapeHandler);
        UIState.registerHandler(document, 'keydown', escapeHandler);
    },

    cleanup() {
        UIState.cleanup();
    }
};

/* =================================================================
   GLOBAL EXPORTS
   ================================================================= */

window.UI = UI;
window.UIState = UIState;
window.toggleSidebar = () => UI.toggleSidebar();
window.closeWarning = () => UI.closeWarning();
