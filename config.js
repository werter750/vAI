/* =================================================================
    BASIC SETTINGS (USER)
    Here you can change the server IP, keys, and prompts.
   ================================================================= */

// IP address of your local server
const USER_SERVER_IP = '127.0.0.1';

// Main API port (KoboldCPP: 5001, LM Studio: 1234, Ollama: 11434, or any other, for example: 1337)
const USER_API_PORT = '1337'; 

// Port for the model switcher (switcher.py)
const USER_SWITCH_PORT = '8000'; 

// Your local API key (leave 'empty' if not needed)
const USER_API_KEY = 'empty';

// Basic system prompt (default)
const SYSTEM_PROMPT = "";

/* =================================================================
   ENVIRONMENT DETECTION
   ================================================================= */

const isBrowser = typeof window !== 'undefined';

const ENV = Object.freeze({
    isBrowser,
    
    get isLocalhost() {
        if (!isBrowser) return false;
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
    },
    
    get isProduction() {
        return isBrowser && window.location.protocol === 'https:';
    },
    
    getServerIP() {
        if (isBrowser && window.vAI_SERVER_IP) return window.vAI_SERVER_IP.trim();
        return isBrowser && window.location.hostname !== '' ? window.location.hostname : USER_SERVER_IP;
    },
    
    getAPIKey() {
        if (isBrowser && window.vAI_API_KEY) return window.vAI_API_KEY.trim();
        return USER_API_KEY;
    },
    
    getProtocol() {
        return isBrowser && window.location.protocol === 'https:' ? 'https:' : 'http:';
    }
});
/* =================================================================
   API & NETWORK SETTINGS (System - best left alone)
   ================================================================= */

const CONFIG = Object.freeze({
    get API_KEY() { return ENV.getAPIKey(); },
    get SERVER_IP() { return ENV.getServerIP(); },
    
    // Dynamic generation of links
    get API_URL() { return `${ENV.getProtocol()}//${ENV.getServerIP()}:${USER_API_PORT}/v1/chat/completions`; },
    get MODEL_SWITCH_URL() { return `${ENV.getProtocol()}//${ENV.getServerIP()}:${USER_SWITCH_PORT}/switch_model`; },
    get STATUS_URL() { return `${ENV.getProtocol()}//${ENV.getServerIP()}:${USER_API_PORT}/v1/models`; },
    
    // External dependencies
    PDF_WORKER: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    
    // Timeouts (in milliseconds)
    TIMEOUTS: Object.freeze({
        MODEL_SWITCH: 5000,
        MODEL_CHECK: 3000,
        API_REQUEST: 30000,
        FILE_UPLOAD: 60000
    }),
    
    // Browser protection limits
    LIMITS: Object.freeze({
        MAX_FILE_SIZE_MB: 10,
        MAX_IMAGE_SIZE_MB: 5,
        MAX_MESSAGES_IN_CONTEXT: 8,
        MIN_MESSAGES_TO_KEEP: 10
    }),
    
    DEBUG: ENV.isLocalhost,
    APP_VERSION: '2.3.1'
});

/* =================================================================
   MODEL CONFIGURATION (vAI_VERSIONS)
   ================================================================= */

const vAI_VERSIONS = Object.freeze({
    standard: {
        id: "gemma-3-12b-it-Q4_K_M",
        name: "vAI",
        family: "gemma",
        label: "vAI",
        contextTokens: 16384,
        maxChars: 65536,
        theme: { purple: "#af52de", blue: "#5856d6", pink: "#ff2d55" },
        systemPrompt: "",
        capabilities: { vision: true, code: true, files: true }
    },
    pro: {
        id: "gemma-3-12b-it-Q4_K_M2",
        name: "vAI PRO",
        family: "gemma",
        label: "vAI PRO",
        contextTokens: 8192,
        maxChars: 32768,
        theme: { purple: "#5ac8fa", blue: "#007aff", pink: "#5856d6" },
        systemPrompt: "",
        capabilities: { vision: true, code: true, files: true }
    },
    ultra: {
        id: "gemma-3-12b-it-Q4_K_M3",
        name: "vAI ULTRA",
        family: "gemma",
        label: "vAI ULTRA",
        contextTokens: 4096,
        maxChars: 16384,
        theme: { purple: "#007aff", blue: "#0040dd", pink: "#00c7be" },
        systemPrompt: "",
        capabilities: { vision: true, code: true, files: true }
    }
});


/* =================================================================
   SVG ICONS FOR MODEL FAMILIES
   ================================================================= */

const MODEL_LOGOS = Object.freeze({
    gemma: `<span class="model-letter">G</span>`,
    qwen: `<span class="model-letter">Q</span>`,
    deepseek: `<span class="model-letter">D</span>`,
    glm: `<span class="model-letter">G</span>`,
    lfm: `<span class="model-letter">L</span>`,
    nemotron: `<span class="model-letter">N</span>`,
    gpt: `<span class="model-letter">G</span>`,
    mistral: `<span class="model-letter">M</span>`,
    phi: `<span class="model-letter">P</span>`
});

/* =================================================================
   CONFIGURATION VALIDATION AT STARTUP
   ================================================================= */

(function validateConfig() {
    const errors = [];
    const warnings = [];
    
    if (!CONFIG.PDF_WORKER) errors.push('PDF_WORKER is not configured');
    if (!vAI_VERSIONS || Object.keys(vAI_VERSIONS).length === 0) errors.push('The vAI_VERSIONS dictionary is empty');
    
    Object.entries(vAI_VERSIONS).forEach(([key, config]) => {
        if (!config.id) errors.push(`Model "${key}": missing id`);
        if (!config.name) errors.push(`Model "${key}": missing name`);
        if (!config.maxChars) warnings.push(`Model "${key}": maxChars not set, memory may overflow`);
    });
    
    if (errors.length > 0) {
        console.error('[Config] ❌ Critical configuration errors:', errors);
        
        const renderError = () => {
            document.body.innerHTML = `
                <div style="color:white;background:#1a1a2e;padding:20px;text-align:center;font-family:sans-serif;height:100vh;display:flex;flex-direction:column;justify-content:center;">
                    <h2 style="color:#ff2d55">⚠️ Configuration error</h2>
                    <p>The application cannot start due to incorrect settings in config.js.</p>
                    <details style="text-align:left;max-width:600px;margin:20px auto;background:#000;padding:15px;border-radius:8px;">
                        <summary style="cursor:pointer;color:#5ac8fa">Show details</summary>
                        <pre style="margin-top:10px;white-space:pre-wrap;color:#ff9999">${errors.join('\n')}</pre>
                    </details>
                </div>
            `;
        };
        
        if (isBrowser) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', renderError);
            } else {
                renderError();
            }
        }
        
        throw new Error('Config validation failed: ' + errors.join('; '));
    }
    
    if (CONFIG.DEBUG) {
        if (warnings.length > 0) console.warn('[Config] ⚠️ Warnings:', warnings);
        console.log(`[Config] vAI v${CONFIG.APP_VERSION} loaded (IP: ${CONFIG.SERVER_IP})`);
    }
})();

/* =================================================================
   EXPORT TO THE GLOBAL AREA (WINDOW)
   ================================================================= */

if (isBrowser) {
    window.CONFIG = CONFIG;
    window.vAI_VERSIONS = vAI_VERSIONS;
    window.MODEL_LOGOS = MODEL_LOGOS;
    window.SYSTEM_PROMPT = SYSTEM_PROMPT;
    window.ENV = ENV;
}