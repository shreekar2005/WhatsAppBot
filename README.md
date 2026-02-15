# WhatsApp Bot (Bantu 🐒)

This project implements an AI-powered WhatsApp assistant using the **Baileys** library and **Ollama** (local LLM). The bot, named "Bantu," features a distinct personality, maintains persistent conversation memory, and allows for real-time knowledge updates without restarting the server.

### Directory Structure

```text
.
├── auth_info/           # Session credentials (generated automatically) (ignored by git)
├── node_modules/        # Dependencies (ignored by git)
├── bot.js               # Main bot logic
├── bantu_memory.json    # Stores user conversation history (generated automatically)
├── bantu_knowledge.txt  # Real-time knowledge base for the AI (create manually)
├── package.json         # NPM configuration
├── package-lock.json    # Dependency lock file
└── README.md
```

> **Note:** The `auth_info/` folder contains sensitive session data. The `bantu_memory.json` file contains chat history. Neither should be committed to public repositories.

### Key Features

1. **AI Integration:** Uses a local LLM (via Ollama) to generate intelligent, witty, and context-aware responses in "Hinglish."
2. **Persistent Memory:** Saves the last 30 messages per user to `bantu_memory.json`, allowing the bot to remember context even after a server restart.
3. **Dynamic Knowledge:** Reads from `bantu_knowledge.txt` on every message. You can update this file to change the bot's status or knowledge in real-time without stopping the code.
4. **Privacy Focused:** Automatically redacts sensitive patterns (like phone numbers or passwords) before saving to memory.
5. **Command System:** Users can start/stop the AI session using commands to avoid spamming.

### How it Works

The bot operates on an event-based architecture:

1. **Authentication:**
* Uses `useMultiFileAuthState` to store session credentials in `auth_info`.
* Generates a QR code on the first run for linking your WhatsApp account.


2. **AI Processing (Ollama):**
* When a user activates the bot (via `/bantu`), messages are sent to a local Ollama instance.
* The bot injects a "System Prompt" containing the current time, personality guidelines, and content from `bantu_knowledge.txt`.


3. **Memory Management:**
* Conversation history is loaded from `bantu_memory.json` on startup.
* After every reply, the updated history is saved back to the file.
* To manage token limits, only the last 30 messages are stored per user.



### Prerequisites

* **Node.js** (v16 or higher)
* **Ollama** installed and running locally.
* **Llama 3 Model** (or your preferred model) pulled in Ollama.

### How to Run

1. **Clone the repository**
```bash
git clone https://github.com/shreekar2005/WhatsAppBot.git
cd WhatsAppBot
```


2. **Install dependencies**
```bash
npm install
```


3. **Setup Ollama**
Make sure Ollama is running and you have the model downloaded.
```bash
ollama pull llama3.1
# Keep Ollama running in a separate terminal or background service
```


4. **Create Knowledge File (Optional)**
Create a file named `bantu_knowledge.txt` in the root folder to give the bot initial context.
```text
STATUS: Shreekar is currently coding.
PROJECT: Working on the WhatsApp AI Bot.
```


5. **Start the bot**
```bash
node bot.js
```


6. **Scan QR Code**
* The terminal will display a QR code.
* Open WhatsApp on your phone -> Three dots -> Linked devices -> Link a device.
* Scan the code.



### Usage Commands

Once the bot is running, users can interact with it using the following commands:

* **`/bantu`** : Wake up the AI and start a conversation.
* **`/q`** or **`/exit`** : End the session (the bot stops replying to that user).
* **`/help`** : Show the menu of commands.

If a user who hasn't started a session messages you, the bot will send a one-time automated reply informing them that you are busy and how to activate Bantu.