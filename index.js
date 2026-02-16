const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

//  AI CONFIGURATION
let OPENROUTER_API_KEY = "";
try {
    const keyPath = path.join(__dirname, '.env', 'openrouter_key.json');
    if (fs.existsSync(keyPath)) {
        const secretData = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
        OPENROUTER_API_KEY = secretData.api_key;
        console.log("✅ Loaded OpenRouter Key securely.");
    } else {
        console.warn("⚠️ Warning: Key file not found at .env/openrouter_key.json");
    }
    OPENROUTER_API_KEY = "";
} catch (err) {
    console.error("❌ Error reading API key:", err.message);
}

const USE_CLOUD_FIRST = false; // If you want to default to OLLAMA LLM then set it "false"
const CLOUD_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free"; 
const LOCAL_MODEL = "llama3.1"; 


// CONFIGURATION & SETTINGS

const MEMORY_FILE = path.join(__dirname, 'agent_memory.json');
const KNOWLEDGE_FILE = path.join(__dirname, 'owner_status.txt'); 
const INFO_FILE = path.join(__dirname, 'owner_info.txt');        
const CONFIG_FILE = path.join(__dirname, 'agent_config.json');

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

let chatHistory = loadMemory();
let activeSessions = new Map();
let OWNER_GROUP_ID = null; 
let IS_AGENT_ACTIVE = false; // default: sleeping 💤

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrubSensitiveData(text) {
    if (!text) return "";
    let cleanText = text;
    CONFIG.forbidden_words.forEach(secret => {
        const regex = new RegExp(secret, "gi"); 
        cleanText = cleanText.replace(regex, "[REDACTED]");
    });
    return cleanText;
}

function loadMemory() {
    if (fs.existsSync(MEMORY_FILE)) {
        try { return new Map(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'))); } 
        catch (err) { return new Map(); }
    }
    return new Map();
}

function saveMemory(historyMap) {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify([...historyMap])); } 
    catch (err) { console.error("error saving memory:", err); }
}

function updateStatus(text) { fs.writeFileSync(KNOWLEDGE_FILE, text); }

function appendInfo(text) { 
    let prefix = "";
    if (fs.existsSync(INFO_FILE)) {
        const stats = fs.statSync(INFO_FILE);
        if (stats.size > 0) prefix = "\n";
    }
    fs.appendFileSync(INFO_FILE, prefix + "- " + text); 
}

function getKnowledgeBase() {
    let status = "";
    let facts = "";

    if (fs.existsSync(KNOWLEDGE_FILE)) status = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
    if (fs.existsSync(INFO_FILE)) facts = fs.readFileSync(INFO_FILE, 'utf-8');

    return { status, facts };
}

function getSystemPrompt() {
    const timeNow = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const { status, facts } = getKnowledgeBase();

    const identityLine = `You are ${CONFIG.agent_name} — ${CONFIG.owner_name}'s Personal Assistant.`;

    return `
${identityLine}
${CONFIG.my_style}

CURRENT TIME: ${timeNow}

MY KNOWLEDGE (About ${CONFIG.owner_name}):
- CURRENT STATUS: ${status}
- If status is "Available", tell them to call ${CONFIG.owner_name} directly.
- If status is "Busy", take a message. If urgent, tell them to call ${CONFIG.owner_name}.
${facts}

${CONFIG.security_rules}
`;
}

// LLM STUFF
async function askLLM(senderID, userText) {
    // 1. PREPARE CONTEXT
    let userContext = chatHistory.get(senderID) || [];
    userContext.push({ role: 'user', content: userText });

    // Keep memory short (last 30 messages) to save costs/speed
    if (userContext.length > 30) userContext = userContext.slice(-30);

    const payloadMessages = [
        { role: 'system', content: getSystemPrompt() },
        ...userContext
    ];

    let cleanReply = "";
    let capturedReasoning = null; 

    // --- HELPER: CALL OPENROUTER ---
    const callOpenRouter = async () => {
        console.log(`☁️  Using Cloud Model: ${CLOUD_MODEL}`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'WhatsApp Bot'
            },
            body: JSON.stringify({
                model: CLOUD_MODEL,
                messages: payloadMessages,
                reasoning: { enabled: true }, 
                stream: false,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`OpenRouter Error: ${response.status} - ${errData}`);
        }
        
        const data = await response.json();
        const msg = data.choices?.[0]?.message;
        
        return { 
            content: msg?.content, 
            reasoning_details: msg?.reasoning_details 
        };
    };

    // --- HELPER: CALL LOCAL OLLAMA ---
    const callOllama = async () => {
        console.log(`🦙 Using Local Model: ${LOCAL_MODEL}`);
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LOCAL_MODEL,
                messages: payloadMessages,
                stream: false,
                options: { num_ctx: 4096, num_predict: 1000, temperature: 0.7 }
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.status}`);
        
        const data = await response.json();
        return { content: data.message?.content };
    };

    // 2. EXECUTE WITH FALLBACK LOGIC
    try {
        let result = null;
        if (USE_CLOUD_FIRST) {
            try {
                result = await callOpenRouter();
            } catch (cloudErr) {
                console.error("⚠️ Cloud failed, switching to Local:", cloudErr.message);
                result = await callOllama();
            }
        } else {
            try {
                result = await callOllama();
            } catch (localErr) {
                console.error("⚠️ Local failed, switching to Cloud:", localErr.message);
                result = await callOpenRouter();
            }
        }
        
        if (result) {
            cleanReply = result.content;
            capturedReasoning = result.reasoning_details;
        }

    } catch (finalError) {
        console.error("❌ All AI providers failed:", finalError);
        return "I'm having trouble connecting to my brain right now.";
    }

    // 3. FINAL CLEANUP & SAVE
    if (!cleanReply) cleanReply = "I'm speechless.";

    // Scrub secrets (like passwords/names) from the reply
    cleanReply = scrubSensitiveData(cleanReply);

    
    const assistantMsg = { 
        role: 'assistant', 
        content: cleanReply,
    };
    
    if (capturedReasoning) {
        assistantMsg.reasoning_details = capturedReasoning;
    }

    userContext.push(assistantMsg);
    chatHistory.set(senderID, userContext);
    saveMemory(chatHistory);

    // Natural typing delay
    await delay(1000 + Math.random() * 1000);
    return cleanReply;
}


// MAIN LOGIC

async function startAgent() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }) 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startAgent();
        } else if (connection === 'open') {
            console.log(`${CONFIG.agent_name} is ready! (State: Sleeping) 💤`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        
        if (!text) return;

        // If message starts with /ignore, do absolutely nothing.
        if (text.trim().toLowerCase().startsWith('/ignore')) return;

        
        // GUARD BLOCK
        if (text.startsWith(`${CONFIG.agent_name} :`)) return;
        if (text.startsWith(`*${CONFIG.owner_name} is Busy!*`)) return;
        if (text.startsWith(`Commands for Agent ${CONFIG.agent_name}`)) return;
        
        
        // OWNER GROUP CONTROL (THE ONLY PLACE FOR ADMIN COMMANDS)

        if (sender.endsWith('@g.us')) {
            if (!OWNER_GROUP_ID) {
                try {
                    const metadata = await sock.groupMetadata(sender);
                    if (metadata.subject === CONFIG.owner_group_name) {
                        OWNER_GROUP_ID = sender;
                        await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : Owner Group Connected! Type /help.` });
                        console.log("Owner Group Linked:", OWNER_GROUP_ID);
                    }
                } catch (err) {}
            }

            if (sender === OWNER_GROUP_ID) {
                const cmd = text.trim();
                const cmdLower = cmd.toLowerCase();
                
                if (cmdLower === "/help") {
                    const adminMenu = 
`*${CONFIG.agent_name} Control Center*
- */wake* : Activate Agent
- */sleep* : Deactivate Agent
- */status* : Check Agent Status
- */agentname* : Check Agent Name
- */agentname [name]* : Change Agent Name
- */mystatus* : Check Owner Status
- */mystatus [msg]* : Update Owner Status
- */myinfo* : View Facts about Owner
- */myinfo [msg]* : Add Fact about Owner
- */clear* : Wipe All chats Memory (RESET AGENT)`;
                    await sock.sendMessage(sender, { text: adminMenu });
                }
                else if (cmd.startsWith("/mystatus")) {
                    const newStatus = text.slice(9).trim(); 
                    if (newStatus.length > 0) {
                        updateStatus(newStatus);
                        await sock.sendMessage(sender, { text: `✅ Status Updated: "${newStatus}"` });
                    } else {
                        const currentStatus = getKnowledgeBase().status;
                        await sock.sendMessage(sender, { text: `ℹ️ Current Status: "${currentStatus}"` });
                    }
                }
                else if (cmd.startsWith("/myinfo")) {
                    const newInfo = text.slice(7).trim(); 
                    if (newInfo.length > 0) {
                        appendInfo(newInfo);
                        await sock.sendMessage(sender, { text: `✅ Fact Added: "${newInfo}"` });
                    } else {
                        const { facts } = getKnowledgeBase();
                        await sock.sendMessage(sender, { text: `📜 *Stored Facts:*\n${facts}` });
                    }
                }
                else if (cmdLower === "/status") {
                    const { status } = getKnowledgeBase();
                    
                    // Logic: Calculate uptime and determine the status emoji/text
                    const uptimeMin = (process.uptime() / 60).toFixed(1);
                    const stateText = IS_AGENT_ACTIVE ? "✅ AWAKE & ACTIVE" : "💤 SLEEPING (SILENT)";
                    const activeModel = USE_CLOUD_FIRST ? CLOUD_MODEL : LOCAL_MODEL;

                    // Clean, readable template for the WhatsApp message
                    const report = 
`📊 *${CONFIG.agent_name} Health Report*

👤 *State:* ${stateText}
🧠 *Owner Status:* "${status || 'Empty'}"
🤖 *Model:* ${activeModel}
💬 *Active Chats:* ${chatHistory.size}
⏱️ *Uptime:* ${uptimeMin} mins`.trim();

                    await sock.sendMessage(sender, { text: report });
                }
                else if (cmdLower === "/clear mystatus") {
                    fs.writeFileSync(KNOWLEDGE_FILE, ""); 
                    await sock.sendMessage(sender, { text: "🧹 Status cleared." });
                }
                else if (cmdLower === "/clear myinfo") {
                    fs.writeFileSync(INFO_FILE, ""); 
                    await sock.sendMessage(sender, { text: "🧹 All Facts deleted." });
                }
                else if (cmdLower === "/clear") { 
                    chatHistory.clear(); 
                    saveMemory(chatHistory); 
                    activeSessions.clear(); 
                    // greetedUsers.clear(); // No longer needed
                    await sock.sendMessage(sender, { text: "🧹 SYSTEM RESET: All memories wiped." }); 
                }
                else if (cmdLower === "/sleep") { 
                    IS_AGENT_ACTIVE = false; 
                    await sock.sendMessage(sender, { text: `💤 ${CONFIG.agent_name} is now SLEEPING.` }); 
                }
                else if (cmdLower === "/wake") { 
                    IS_AGENT_ACTIVE = true; 
                    await sock.sendMessage(sender, { text: `⚡ ${CONFIG.agent_name} is now AWAKE.` }); 
                }
                else if (cmd.startsWith("/agentname")) {
                    const newName = text.slice(10).trim(); // Slice after "/agentname"
                    if (newName.length > 0) {
                        // Update the live config and the file
                        CONFIG.agent_name = newName;
                        
                        // Save to file so it persists after restart
                        const currentConfig = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
                        currentConfig.agent_name = newName;
                        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));

                        await sock.sendMessage(sender, { text: `✅ Agent renamed to: *${newName}*` });
                    } else {
                        // Just show the current name
                        await sock.sendMessage(sender, { text: `ℹ️ Current Agent Name: *${CONFIG.agent_name}*` });
                    }
                }
                return; 
            }
            return; 
        }


        
        // SELF-CHAT HANDLING (TESTING ONLY - NO ADMIN POWERS)

        const agentId = sock.user.id.split(':')[0] + "@s.whatsapp.net";
        const agentLid = sock.user.lid;

        if (msg.key.fromMe) {
            const isSelf = (sender === agentId) || (sender === agentLid) || (sender.endsWith('@lid'));
            if (!isSelf) return;
        }

        
        // GLOBAL USER LOGIC

        console.log(`User ${sender} says: ${text}`);
        const cmd = text.toLowerCase().trim();

        if (cmd === '/agent') {
            if (!IS_AGENT_ACTIVE) {
                await sock.sendMessage(sender, { text: `💤 ${CONFIG.agent_name} is currently sleeping. Please contact ${CONFIG.owner_name} directly.` });
                return;
            }
            activeSessions.set(sender, true);
            await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : Yes, how can I help?` });
            return;
        }

        if (cmd === '/clear') {
            chatHistory.delete(sender);
            activeSessions.delete(sender);
            saveMemory(chatHistory);
            await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : 🧹 Chat memory cleared` });
            if (!IS_AGENT_ACTIVE) {
                await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : Going to sleep again 💤` });
            }
            return;
        }

        // STOP HERE IF SLEEPING (Admin Global Sleep)
        if (!IS_AGENT_ACTIVE) return;

        if ((cmd === '/q' || cmd === '/exit') && activeSessions.has(sender)) {
            activeSessions.delete(sender);
            await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : Bye bayeee! 👋` });
            return;
        }

        if (cmd === '/help') {
            const helpMsg = 
`Commands for Agent ${CONFIG.agent_name}

- */ignore <text>* : Agent will fully ignore text after '/ignore'
- */agent* : Start chat with agent
- */clear* : Clear your chat memory for agent
- */q* : Stop chat with agent
- */help* : Show this menu

*WARNING* : Currently I am in development stage, so please be kind :)`;
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }

        if (activeSessions.has(sender)) {
            // User is in a session - talk to AI
            await sock.sendPresenceUpdate('composing', sender);
            const aiReply = await askLLM(sender, text);
            
            // --- NEW: LOG THE REPLY TO CONSOLE ---
            console.log(`🤖 ${CONFIG.agent_name} replied: ${aiReply}`);
            // -------------------------------------

            await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : ` + aiReply });
            await sock.sendPresenceUpdate('paused', sender);
        } else {
            const autoMessage = 
`*${CONFIG.owner_name} is Busy!*

I am his assistant "${CONFIG.agent_name}"

- */ignore <text>* : Agent will fully ignore text after '/ignore'
- */agent* : Start chat with agent
- */clear* : Clear your chat memory for agent
- */q* : Stop chat with agent
- */help* : Show this menu

*WARNING* : Currently I am in development stage, so please be kind :)`;

            await sock.sendMessage(sender, { text: autoMessage });
        }
    });
}

startAgent();