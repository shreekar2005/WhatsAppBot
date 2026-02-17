const fs = require('fs');
const path = require('path');

// FILES (Using '..' to point to root)
const MEMORY_FILE = path.join(__dirname, '..', 'agent_memory.json');
const KNOWLEDGE_FILE = path.join(__dirname, '..', 'owner_status.txt');
const INFO_FILE = path.join(__dirname, '..', 'owner_info.txt');
const CONFIG_FILE = path.join(__dirname, '..', 'agent_config.json');
const KEY_PATH = path.join(__dirname, '..', '.env', 'openrouter_key.json');

// AI SETTINGS
const USE_CLOUD_FIRST = false; 
const CLOUD_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free"; 
const LOCAL_MODEL = "llama3.1"; 

// LOAD API KEY
let OPENROUTER_API_KEY = "";
try {
    if (fs.existsSync(KEY_PATH)) {
        const secretData = JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'));
        OPENROUTER_API_KEY = secretData.api_key;
        console.log("✅ Loaded OpenRouter Key securely.");
    } else {
        console.warn("⚠️ Warning: Key file not found.");
    }
} catch (err) {
    console.error("❌ Error reading API key:", err.message);
}

// BOT CONFIGURATION
let CONFIG = {
    owner_name: "Admin",
    agent_name: "Agent",
    owner_group_name: "Admin Control",
    forbidden_words: [],
    my_style: "",
    security_rules: ""
};

function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            CONFIG.owner_name = raw.owner_name || "Admin";
            CONFIG.agent_name = raw.agent_name || "Assistant";
            CONFIG.owner_group_name = raw.owner_group_name || "Admin Control";
            CONFIG.forbidden_words = raw.forbidden_words || [];
            CONFIG.my_style = Array.isArray(raw.my_style) ? raw.my_style.join('\n') : raw.my_style;
            CONFIG.security_rules = Array.isArray(raw.security_rules) ? raw.security_rules.join('\n') : raw.security_rules;
            console.log(`✅ Config loaded. Agent: ${CONFIG.agent_name}`);
        } catch (err) {
            console.error("❌ Config Error. using defaults.");
        }
    }
}
loadConfig();

module.exports = {
    MEMORY_FILE, KNOWLEDGE_FILE, INFO_FILE, CONFIG_FILE,
    USE_CLOUD_FIRST, CLOUD_MODEL, LOCAL_MODEL, OPENROUTER_API_KEY,
    CONFIG
};