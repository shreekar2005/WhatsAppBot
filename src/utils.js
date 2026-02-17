const fs = require('fs');
const { CONFIG, KNOWLEDGE_FILE, INFO_FILE } = require('./config');

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

function updateStatus(text) { 
    fs.writeFileSync(KNOWLEDGE_FILE, text); 
}

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

module.exports = {
    delay,
    scrubSensitiveData,
    updateStatus,
    appendInfo,
    getKnowledgeBase
};