const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { CONFIG, MEMORY_FILE, KNOWLEDGE_FILE, INFO_FILE, CONFIG_FILE, USE_CLOUD_FIRST, CLOUD_MODEL, LOCAL_MODEL } = require('./src/config');
const { updateStatus, appendInfo, getKnowledgeBase } = require('./src/utils');
const { askLLM } = require('./src/handleLLM');

// --- STATE VARIABLES (CRITICAL TO KEEP HERE) ---
let chatHistory = new Map();
if (fs.existsSync(MEMORY_FILE)) {
    try { chatHistory = new Map(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'))); } 
    catch (err) { chatHistory = new Map(); }
}

let activeSessions = new Map();
let OWNER_GROUP_ID = null; 
let IS_AGENT_ACTIVE = false; // default: sleeping 💤

// Helper to save memory explicitly if needed in index.js
function saveMemory() {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify([...chatHistory])); } 
    catch (err) { console.error("error saving memory:", err); }
}

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
        if (text.trim().toLowerCase().startsWith('/ignore')) return;

        // GUARD BLOCK
        if (text.startsWith(`${CONFIG.agent_name} :`)) return;
        if (text.startsWith(`*${CONFIG.owner_name} is Busy!*`)) return;
        if (text.startsWith(`Commands for Agent ${CONFIG.agent_name}`)) return;
        
        // --- ADMIN GROUP LOGIC (Kept in index.js to ensure connection) ---
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
                    const uptimeMin = (process.uptime() / 60).toFixed(1);
                    const stateText = IS_AGENT_ACTIVE ? "✅ AWAKE & ACTIVE" : "💤 SLEEPING (SILENT)";
                    const activeModel = USE_CLOUD_FIRST ? CLOUD_MODEL : LOCAL_MODEL;

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
                    saveMemory(); 
                    activeSessions.clear(); 
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
                    const newName = text.slice(10).trim();
                    if (newName.length > 0) {
                        CONFIG.agent_name = newName;
                        const currentConfig = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
                        currentConfig.agent_name = newName;
                        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
                        await sock.sendMessage(sender, { text: `✅ Agent renamed to: *${newName}*` });
                    } else {
                        await sock.sendMessage(sender, { text: `ℹ️ Current Agent Name: *${CONFIG.agent_name}*` });
                    }
                }
                return; 
            }
            return; 
        }

        // --- SELF CHAT FILTER ---
        const agentId = sock.user.id.split(':')[0] + "@s.whatsapp.net";
        const agentLid = sock.user.lid;
        if (msg.key.fromMe) {
            const isSelf = (sender === agentId) || (sender === agentLid) || (sender.endsWith('@lid'));
            if (!isSelf) return;
        }

        // --- USER LOGIC ---
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
            saveMemory();
            await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : 🧹 Chat memory cleared` });
            if (!IS_AGENT_ACTIVE) {
                await sock.sendMessage(sender, { text: `${CONFIG.agent_name} : Going to sleep again 💤` });
            }
            return;
        }

        // STOP HERE IF SLEEPING
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
            await sock.sendPresenceUpdate('composing', sender);
            
            // Call the LLM (which is now in handleLLM.js)
            // We pass the chatHistory map so it can update memory
            const aiReply = await askLLM(sender, text, chatHistory);
            
            console.log(`🤖 ${CONFIG.agent_name} replied: ${aiReply}`);
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