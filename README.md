# WhatsApp AI Helper Agent

This project implements a fully customizable AI-powered WhatsApp assistant using the **Baileys** library and **Ollama** (local LLM). The bot features a distinct personality, maintains persistent conversation memory, and allows for real-time status and knowledge updates via a configuration file.

### Directory Structure

```text
.
├── auth_info/           # Session credentials (generated automatically)
├── node_modules/        # Dependencies
├── index.js             # Main bot logic
├── agent_config.json    # Configuration (Name, Style, Rules)
├── agent_memory.json    # Stores user conversation history (Auto-generated)
├── owner_status.txt     # Real-time Status file (Auto-generated/Editable)
├── owner_info.txt       # Real-time Facts file (Auto-generated/Editable)
├── package.json         # NPM configuration
├── package-lock.json    # Dependency lock file
└── README.md

```

> **Note:** The `auth_info/` folder, `agent_config.json`, and memory files contain sensitive data and are excluded from git.

### Key Features

1. **AI Integration:** Uses a local LLM (via Ollama) to generate intelligent and context-aware responses.
2. **JSON Configuration:** Easily change the Bot's Name, Owner's Name, Personality, and Security Rules via `agent_config.json` without touching the code.
3. **Persistent Memory:** Saves the last 30 messages per user to `agent_memory.json`.
4. **Owner Control Group:** A specific WhatsApp group ("Bantu-PA") acts as a control room to wake/sleep the bot, update status, or add facts commands.
5. **Privacy Focused:** Automatically redacts sensitive patterns (like phone numbers or passwords) before saving to memory.
6. **Smart Ignoring:** The bot can be told to ignore specific messages starting with `/ignore`, preventing it from processing text meant for others.

### Prerequisites

* **Node.js** (v16 or higher)
* **Ollama** installed and running locally.
* **Llama 3 Model** (or your preferred model) pulled in Ollama.

### How to Run

1. **Clone the repository**

```bash
git clone https://github.com/your-username/WhatsAppBot.git
cd WhatsAppBot
```

2. **Install dependencies**

```bash
npm install
```

3. **Setup Configuration**
Create a file named `agent_config.json` in the root folder:

```json
{
  "owner_name": "Shreekar",
  "agent_name": "Bantu",
  "owner_group_name": "Bantu-PA",
  "forbidden_words": ["SecretKey"],
  "my_style": ["- Be funny", "- Speak Hinglish"],
  "security_rules": ["- No passwords"]
}
```

4. **Setup Ollama**
Ensure Ollama is running:

```bash
ollama pull llama3.1
```

5. **Start the bot**

```bash
node index.js
```

6. **Scan QR Code**

* The terminal will display a QR code.
* Open WhatsApp on your phone -> Three dots -> Linked devices -> Link a device.
* Scan the code.

7. **Create Control Group**

* Create a new WhatsApp group containing only yourself.
* **Important:** Name the group exactly **`Bantu-PA`** (or whatever you set in `agent_config.json`).
* This group acts as your "Command Center".
* Type `/help` in this group to confirm the bot is listening.

### Usage Commands

#### Public Commands (In personal chats)

* **`/agent`** : Wake up the AI and start a conversation.
* **`/q`** or **`/exit`** : End the session.
* **`/help`** : Show the menu of commands.
* **`/clear`** : Wipe your personal chat history with the bot.
* **`/ignore <text>`** : The bot will completely ignore any message starting with this tag. Useful if you want to send a note to yourself without triggering the bot.
* **Note:** If you message the bot without using `/agent`, it will automatically reply with a help menu every single time.

#### Owner Commands (In "Bantu-PA" Group chat)

* **`/wake`** & **`/sleep`** : Turn the bot ON or OFF globally.
* **`/mystatus [msg]`** : Update the owner's current status (e.g., "Driving").
* **`/myinfo [msg]`** : Add a permanent fact about the owner.
* **`/status`** : View system health and uptime.
* **`/clear`** : System-wide memory wipe.

---

### Troubleshooting

* **Bot replies "Server is unreachable":** Ensure Ollama is running (`ollama serve`).
* **Bot is sleeping:** The bot starts in Sleep mode by default. Go to your Control Group and type `/wake`.