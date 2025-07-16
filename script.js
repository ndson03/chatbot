// IndexedDB Configuration
const DB_NAME = 'SICTChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'chatHistory';
let db = null;

// Initialize IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('✅ IndexedDB initialized successfully');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('✅ IndexedDB store created');
            }
        };
    });
}

// Save message to IndexedDB
function saveMessageToHistory(isUser, content) {
    if (!db) {
        console.warn('Database not initialized, cannot save message');
        return;
    }

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Ensure content is always a string
    let textContent = content;
    if (typeof content === 'object' && content.text) {
        textContent = content.text;
    }

    const message = {
        isUser: isUser,
        content: textContent,
        timestamp: new Date().toISOString()
    };

    const request = store.add(message);

    request.onerror = () => {
        console.error('Failed to save message:', request.error);
    };

    request.onsuccess = () => {
        console.log('✅ Message saved to history');
    };

    transaction.oncomplete = () => {
        cleanupOldMessages();
    };
}

// Clean up old messages (keep only last 50)
function cleanupOldMessages() {
    if (!db) return;

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    const request = index.openCursor(null, 'prev');
    let count = 0;
    const maxMessages = 50;

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            count++;
            if (count > maxMessages) {
                cursor.delete();
            }
            cursor.continue();
        }
    };
}

// Load chat history from IndexedDB
function loadChatHistory() {
    if (!db) {
        console.warn('Database not initialized, cannot load chat history');
        return;
    }

    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'next');

    const messages = [];

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            messages.push(cursor.value);
            cursor.continue();
        } else {
            console.log('✅ Loaded', messages.length, 'messages from history');
            displayChatHistory(messages);
        }
    };

    request.onerror = () => {
        console.error('Failed to load chat history:', request.error);
    };
}

// Display chat history in UI
function displayChatHistory(messages) {
    const chatBox = document.getElementById('chatBox');

    if (messages.length > 0) {
        chatBox.innerHTML = '';
    }

    messages.forEach(message => {
        if (message.isUser) {
            const container = document.createElement('div');
            container.className = 'user-message-container';

            const textDiv = document.createElement('div');
            textDiv.className = 'user-message-text';
            textDiv.textContent = message.content;
            container.appendChild(textDiv);

            chatBox.appendChild(container);
        } else {
            const el = document.createElement('div');
            el.className = 'bot-message';

            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';

            // Ensure content is a string
            let textContent = message.content;
            if (typeof textContent === 'object' && textContent.text) {
                textContent = textContent.text;
            }

            const sanitized = DOMPurify.sanitize(md.render(textContent));
            messageContent.innerHTML = sanitized;

            el.appendChild(messageContent);
            chatBox.appendChild(el);

            // Highlight code blocks
            el.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        }
    });

    scrollToBottom();
}

// Build chat history for API
function buildChatHistoryForAPI() {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.warn('Database not initialized for API history');
            resolve([]);
            return;
        }

        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'next');

        const apiHistory = [];

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const message = cursor.value;
                
                // Ensure content is always a string
                let textContent = message.content;
                if (typeof textContent === 'object' && textContent.text) {
                    textContent = textContent.text;
                }

                if (message.isUser) {
                    apiHistory.push({
                        role: "user",
                        parts: [{ text: textContent }]
                    });
                } else {
                    apiHistory.push({
                        role: "model",
                        parts: [{ text: textContent }]
                    });
                }
                cursor.continue();
            } else {
                console.log('✅ Built API history with', apiHistory.length, 'messages');
                resolve(apiHistory);
            }
        };

        request.onerror = () => {
            console.error('Failed to build API history:', request.error);
            resolve([]);
        };
    });
}

// Clear all chat history
function clearChatHistory() {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử chat không?')) {
        if (!db) {
            console.warn('Database not initialized');
            return;
        }

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('✅ Chat history cleared successfully');
            window.location.reload();
        };

        request.onerror = () => {
            console.error('Failed to clear chat history:', request.error);
            alert('Có lỗi xảy ra khi xóa lịch sử chat!');
        };
    }
}

// Main function to ask question
async function askQuestion() {
    const input = document.getElementById('questionInput');
    const question = input.value.trim();

    if (!question) {
        console.warn('Empty question, not sending');
        return;
    }

    console.log('🚀 Asking question:', question);

    // Display user message
    displayUserMessage(question);

    // Create loading indicator
    const chatBox = document.getElementById('chatBox');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'bot-message loading-message';

    const loadingContent = document.createElement('div');
    loadingContent.className = 'message-content';

    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.innerHTML = '<span></span><span></span><span></span>';

    loadingContent.appendChild(typingIndicator);
    loadingDiv.appendChild(loadingContent);
    chatBox.appendChild(loadingDiv);
    scrollToBottom();

    // Build payload
    const chatHistory = await buildChatHistoryForAPI();
    const payload = {
        question: question,
        chatHistory: chatHistory
    };

    // Clear input
    input.value = '';
    autoResize(input);
    
    // Disable send button
    const sendIcon = document.getElementById('sendIcon');
    if (sendIcon) {
        sendIcon.style.pointerEvents = 'none';
    }

    console.log('📤 Sending payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch('https://chatbot-api-rouge.vercel.app/api', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('📡 Response status:', response.status, response.statusText);

        if (!response.ok) {
            let errorText = 'Unknown error';
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorText;
            } catch (e) {
                errorText = await response.text();
            }
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ Response data:', data);

        if (!data.text) {
            throw new Error('No text in response');
        }

        const responseText = data.text;
        console.log('📝 Response text:', responseText);

        // Update UI
        const sanitized = DOMPurify.sanitize(md.render(responseText));
        loadingDiv.className = 'bot-message';

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.innerHTML = sanitized;

        loadingDiv.innerHTML = '';
        loadingDiv.appendChild(messageContent);

        // Highlight code blocks
        loadingDiv.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
        });

        // Save to history (save only the text string, not the object)
        saveMessageToHistory(false, responseText);
        scrollToBottom();

    } catch (error) {
        console.error('❌ Error:', error);

        // Update UI with error
        loadingDiv.className = 'bot-message';
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: #e74c3c; margin-right: 8px;"></i>Có lỗi xảy ra: ${error.message}`;

        loadingDiv.innerHTML = '';
        loadingDiv.appendChild(messageContent);

        // Save error to history
        saveMessageToHistory(false, `Có lỗi xảy ra: ${error.message}`);
        scrollToBottom();
    } finally {
        // Re-enable send button
        if (sendIcon) {
            sendIcon.style.pointerEvents = 'auto';
        }
    }
}

// Display user message
function displayUserMessage(text) {
    const container = document.createElement('div');
    container.className = 'user-message-container';

    const textDiv = document.createElement('div');
    textDiv.className = 'user-message-text';
    textDiv.textContent = text;
    container.appendChild(textDiv);

    appendMessage(container);
    saveMessageToHistory(true, text);
}

// Append message to chat
function appendMessage(el) {
    const box = document.getElementById('chatBox');
    box.appendChild(el);
    scrollToBottom();
}

// Scroll to bottom
function scrollToBottom() {
    const mainContent = document.querySelector('.main-content');
    const botMessages = document.querySelectorAll('.bot-message');
    const lastBotMessage = botMessages[botMessages.length - 1];

    if (lastBotMessage) {
        lastBotMessage.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    } else if (mainContent) {
        mainContent.scrollTo({
            top: mainContent.scrollHeight,
            behavior: 'smooth'
        });
    }
}

// Auto resize textarea
function autoResize(textarea) {
    if (!textarea) return;
    
    textarea.style.height = 'auto';
    const container = textarea.parentElement;
    if (container) {
        container.style.height = 'auto';

        const contentHeight = textarea.scrollHeight;
        const padding = 0;
        const buttonContainerHeight = 35;
        const totalHeight = contentHeight + padding + buttonContainerHeight;

        const newHeight = Math.min(totalHeight, 400);

        container.style.height = `${newHeight}px`;
        textarea.style.height = `${newHeight - padding - buttonContainerHeight}px`;
    }
}

// Handle Enter key
function checkEnter(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askQuestion();
    }
}

// Initialize markdown parser
const md = window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true
});

// Test API function (for debugging)
async function testAPI() {
    console.log('🧪 Testing API...');
    
    try {
        const response = await fetch('https://chatbot-api-rouge.vercel.app/api', {
            method: 'GET'
        });

        console.log('🧪 Health check response:', response.status, response.statusText);

        if (response.ok) {
            const data = await response.json();
            console.log('🧪 Health check data:', data);
        }
    } catch (error) {
        console.error('🧪 Health check failed:', error);
    }

    // Test POST
    const testPayload = {
        question: "Hello test",
        chatHistory: []
    };

    try {
        const response = await fetch('https://chatbot-api-rouge.vercel.app/api', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(testPayload)
        });

        console.log('🧪 POST test response:', response.status, response.statusText);

        if (response.ok) {
            const data = await response.json();
            console.log('🧪 POST test data:', data);
        } else {
            const errorText = await response.text();
            console.log('🧪 POST test error:', errorText);
        }
    } catch (error) {
        console.error('🧪 POST test failed:', error);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Initializing chat application...');
    
    // Set active nav link
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');

    navLinks.forEach(link => {
        if (link.getAttribute('href') && currentPath.includes(link.getAttribute('href'))) {
            link.classList.add('active');
        }
    });

    // Initialize database and load history
    try {
        await initDB();
        loadChatHistory();
    } catch (error) {
        console.error('❌ Failed to initialize database:', error);
    }

    // Setup textarea auto-resize
    const textarea = document.getElementById('questionInput');
    if (textarea) {
        autoResize(textarea);
        
        // Add input event listener for auto-resize
        textarea.addEventListener('input', function() {
            autoResize(this);
        });
    }

    // Test API on load (optional - remove if not needed)
    // testAPI();
    
    console.log('✅ Chat application initialized successfully');
});