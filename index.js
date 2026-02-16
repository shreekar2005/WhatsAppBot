const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');


// CONFIGURATION & SETTINGS


const MEMORY_FILE = 'agent_memory.json';
const KNOWLEDGE_FILE = 'owner_status.txt'; 
const INFO_FILE = 'owner_info.txt';        
const CONFIG_FILE = 'agent_config.json';   

let CONFIG = {
    owner_name: "Admin",
    agent_name: "Bot",
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
let greetedUsers = new Set();
let OWNER_GROUP_ID = null; 
let IS_AGENT_ACTIVE = false; // default: sleeping 💤

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrubSensitiveData(text) {
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

// OLLAMA STUFF
async function askOllama(senderID, userText) {
    try {
        let userContext = chatHistory.get(senderID) || [];
        userContext.push({ role: 'user', content: userText });

        if (userContext.length > 30) userContext = userContext.slice(-30);

        const payloadMessages = [
            { role: 'system', content: getSystemPrompt() },
            ...userContext
        ];

        const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.1',
                messages: payloadMessages,
                stream: false,
                options: { num_ctx: 4096, num_predict: 1000, temperature: 0.7 }
            })
        });

        const data = await response.json();
        const rawReply = data.message?.content || "I'm having trouble thinking right now.";
        const cleanReply = scrubSensitiveData(rawReply);

        userContext.push({ role: 'assistant', content: cleanReply });
        
        chatHistory.set(senderID, userContext);
        saveMemory(chatHistory);

        await delay(1000 + Math.random() * 1000);
        return cleanReply;

    } catch (error) {
        console.error("ollama error:", error);
        return "Server is unreachable.";
    }
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

        
        // GUARD BLOCK
        if (text.startsWith(`${CONFIG.agent_name} :`)) return;
        if (text.startsWith(`*${CONFIG.owner_name} is Busy!*`)) return;
        if (text.startsWith(`Commands for ${CONFIG.agent_name}`)) return;
        
        
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
                
                if (cmdLower === "/help" || cmdLower === "help") {
                    const adminMenu = 
`*${CONFIG.agent_name} Control Center*
*/wake* : Activate Agent
*/sleep* : Deactivate Agent
*/mystatus* : Check Owner Status
*/mystatus [msg]* : Update Owner Status
*/status* : Check Agent Status
*/myinfo* : View Facts about Owner
*/myinfo [msg]* : Add Fact about Owner
*/clear* : Wipe All chats Memory (RESET AGENT)`;
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
                    const stateIcon = IS_AGENT_ACTIVE ? "✅ AWAKE" : "💤 SLEEPING";
                    const { status } = getKnowledgeBase();
                    const uptimeMin = (process.uptime() / 60).toFixed(1);
                    const report = `*${CONFIG.agent_name} Health Report*\n\n*State:* ${stateIcon}\n*Mode:* ${IS_AGENT_ACTIVE ? "Active" : "Silent"}\n*Knowledge:* "${status}"\n*Active Chats:* ${chatHistory.size}\n*Uptime:* ${uptimeMin} mins`;
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
                    greetedUsers.clear(); 
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
                return; 
            }
            return; 
        }


        
        // SELF-CHAT HANDLING (TESTING ONLY - NO ADMIN POWERS)

        const botId = sock.user.id.split(':')[0] + "@s.whatsapp.net";
        const botLid = sock.user.lid;

        if (msg.key.fromMe) {
            const isSelf = (sender === botId) || (sender === botLid) || (sender.endsWith('@lid'));
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

        // STOP HERE IF SLEEPING
        if (!IS_AGENT_ACTIVE) return;

        if (cmd === '/q' || cmd === '/exit') {
            activeSessions.delete(sender);
            await sock.sendMessage(sender, { text: "Bye! 👋" });
            return;
        }

        if (cmd === '/clear') {
            chatHistory.delete(sender);
            activeSessions.delete(sender);
            saveMemory(chatHistory);
            await sock.sendMessage(sender, { text: `🧹 Chat memory cleared.` });
            return;
        }

        if (cmd === '/help' || cmd === 'help') {
            const helpMsg = 
`Commands for ${CONFIG.agent_name}

*/agent* : Start Chat
*/clear* : Clear memory
*/q* : Stop Chat
*/help* : Show this menu

*WARNING* : Currently I am in developing stage, so please be kind :)`;
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }

        if (activeSessions.has(sender)) {
            await sock.sendPresenceUpdate('composing', sender);
            const aiReply = await askOllama(sender, text);
            await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : ` + aiReply });
            await sock.sendPresenceUpdate('paused', sender);
        } else {
            const isSelf = (sender === botId) || (sender.endsWith('@lid'));
            
            // Auto-Greeting
            if (!greetedUsers.has(sender)) {
                const autoMessage = 
`*${CONFIG.owner_name} is Busy!*

I am his assistant "${CONFIG.agent_name}"

*/agent* : Start Chat
*/clear* : Clear memory
*/q* : Stop Chat
*/help* : Show this menu

*WARNING* : Currently I am in developing stage, so please be kind :)`;

                await sock.sendMessage(sender, { text: autoMessage });
                greetedUsers.add(sender);
            }
        }
    });
}

startAgent();