
// IndexedDB Configuration
const DB_NAME = 'SICTChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'chatHistory';
let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
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
            }
        };
    });
}

function saveMessageToHistory(isUser, content, imageData = null) {
    if (!db) return;

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const message = {
        isUser: isUser,
        content: content,
        imageData: imageData,
        timestamp: new Date().toISOString()
    };

    const request = store.add(message);

    request.onerror = () => {
        console.error('Failed to save message:', request.error);
    };

    transaction.oncomplete = () => {
        cleanupOldMessages();
    };
}

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

function loadChatHistory() {
    if (!db) {
        console.warn('Database not initialized');
        return;
    }

    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'next');

    const chatBox = document.getElementById('chatBox');
    const messages = [];

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            messages.push(cursor.value);
            cursor.continue();
        } else {
            displayChatHistory(messages);
        }
    };

    request.onerror = () => {
        console.error('Failed to load chat history:', request.error);
    };
}

function displayChatHistory(messages) {
    const chatBox = document.getElementById('chatBox');

    if (messages.length > 0) {
        chatBox.innerHTML = '';
    }

    messages.forEach(message => {
        if (message.isUser) {
            const container = document.createElement('div');
            container.className = 'user-message-container';

            if (message.imageData) {
                const img = document.createElement('img');
                img.src = `data:${message.imageData.mimeType};base64,${message.imageData.data}`;
                img.className = 'user-message-image';

                img.onclick = function() {
                    showImageModal(img.src);
                };

                container.appendChild(img);
            }

            if (message.content && message.content.trim()) {
                const textDiv = document.createElement('div');
                textDiv.className = 'user-message-text';
                textDiv.textContent = message.content;
                container.appendChild(textDiv);
            }

            chatBox.appendChild(container);
        } else {
            const el = document.createElement('div');
            el.className = 'bot-message';

            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';

            const sanitized = DOMPurify.sanitize(md.render(message.content));
            messageContent.innerHTML = sanitized;

            el.appendChild(messageContent);
            chatBox.appendChild(el);

            el.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        }
    });

    scrollToBottom(); // Cuộn xuống cuối sau khi tải lịch sử
}

function buildChatHistoryForAPI() {
    return new Promise((resolve, reject) => {
        if (!db) {
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
                if (message.isUser) {
                    const userParts = [];

                    if (message.content && message.content.trim()) {
                        userParts.push({ text: message.content });
                    }

                    if (message.imageData) {
                        userParts.push({
                            inline_data: {
                                mime_type: message.imageData.mimeType,
                                data: message.imageData.data
                            }
                        });
                    }

                    if (userParts.length > 0) {
                        apiHistory.push({
                            role: "user",
                            parts: userParts
                        });
                    }
                } else {
                    apiHistory.push({
                        role: "model",
                        parts: [{ text: message.content }]
                    });
                }
                cursor.continue();
            } else {
                resolve(apiHistory);
            }
        };

        request.onerror = () => {
            console.error('Failed to build API history:', request.error);
            resolve([]);
        };
    });
}

function clearChatHistory() {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử chat không?')) {
        if (!db) return;

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('Chat history cleared successfully');
            window.location.reload();
        };

        request.onerror = () => {
            console.error('Failed to clear chat history:', request.error);
            alert('Có lỗi xảy ra khi xóa lịch sử chat!');
        };
    }
}

async function askQuestion() {
    const input = document.getElementById('questionInput');
    const question = input.value.trim();

    if (!question && !selectedImage) return;

    displayUserMessage(question, selectedImage);

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
    scrollToBottom(); // Cuộn xuống khi thêm tin nhắn loading

    const payload = {
        question: question || "",
        chatHistory: await buildChatHistoryForAPI()
    };

    if (selectedImage) {
        payload.image = selectedImage;
    }

    input.value = '';
    autoResize(input);
    removeSelectedImage();
    document.getElementById('sendIcon').style.pointerEvents = 'none';

    fetch('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.text();
        })
        .then(data => {
            const sanitized = DOMPurify.sanitize(md.render(data));
            loadingDiv.className = 'bot-message';

            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            messageContent.innerHTML = sanitized;

            loadingDiv.innerHTML = '';
            loadingDiv.appendChild(messageContent);

            loadingDiv.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });

            saveMessageToHistory(false, data);
            scrollToBottom(); // Cuộn xuống khi nhận được phản hồi
        })
        .catch(err => {
            console.error('Error:', err);
            loadingDiv.className = 'bot-message';

            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            messageContent.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #e74c3c; margin-right: 8px;"></i>Có lỗi xảy ra. Vui lòng thử lại!';

            loadingDiv.innerHTML = '';
            loadingDiv.appendChild(messageContent);

            saveMessageToHistory(false, 'Có lỗi xảy ra. Vui lòng thử lại!');
            scrollToBottom(); // Cuộn xuống khi có lỗi
        })
        .finally(() => {
            document.getElementById('sendIcon').style.pointerEvents = 'auto';
        });
}
document.addEventListener('DOMContentLoaded', async function() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');

    navLinks.forEach(link => {
        if (link.getAttribute('href') && currentPath.includes(link.getAttribute('href'))) {
            link.classList.add('active');
        }
    });

    try {
        await initDB();
        loadChatHistory();
    } catch (error) {
        console.error('Failed to initialize database:', error);
    }

    const textarea = document.getElementById('questionInput');
    if (textarea) {
        autoResize(textarea);
    }
});

const md = window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true
});

let selectedImage = null;

function autoResize(textarea) {
    // Đặt lại chiều cao của textarea và container
    textarea.style.height = 'auto';
    const container = textarea.parentElement;
    container.style.height = 'auto';

    // Tính toán chiều cao nội dung của textarea
    const contentHeight = textarea.scrollHeight;

    // Tính toán chiều cao container (bao gồm padding và button-container)
    const padding = 0; // Padding trên và dưới của .chat-input-container (10px + 10px)
    const buttonContainerHeight = 35; // Ước lượng chiều cao của .button-container (35px button + margin/padding)
    const totalHeight = contentHeight + padding + buttonContainerHeight;

    // Giới hạn chiều cao tối đa là 450px
    const newHeight = Math.min(totalHeight, 400);

    // Cập nhật chiều cao của container
    container.style.height = `${newHeight}px`;

    // Cập nhật chiều cao của textarea (trừ đi phần padding và button-container)
    textarea.style.height = `${newHeight - padding - buttonContainerHeight}px`;
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        if (!file.type.startsWith('image/')) {
            alert('Vui lòng chọn file ảnh!');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert('Kích thước ảnh không được vượt quá 5MB!');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            selectedImage = {
                data: e.target.result.split(',')[1],
                mimeType: file.type,
                fileName: file.name
            };
            showImagePreview(e.target.result, file.name);
        };
        reader.readAsDataURL(file);
    }
}

function showImagePreview(imageSrc, fileName) {
    const previewContainer = document.getElementById('imagePreview');
    previewContainer.innerHTML = `
        <div style="display: flex; align-items: center; background: #f0f2f5; padding: 8px; border-radius: 8px; margin-bottom: 10px;">
            <img src="${imageSrc}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px; margin-right: 10px;">
            <span style="flex: 1; font-size: 14px; color: #333;">${fileName}</span>
            <button onclick="removeSelectedImage()" style="background: none; border: none; color: #666; cursor: pointer; font-size: 16px;">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    previewContainer.style.display = 'block';
}

function removeSelectedImage() {
    selectedImage = null;
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('imageInput').value = '';
}

function displayUserMessage(text, imageData = null) {
    const container = document.createElement('div');
    container.className = 'user-message-container';

    if (imageData) {
        const img = document.createElement('img');
        img.src = `data:${imageData.mimeType};base64,${imageData.data}`;
        img.className = 'user-message-image';

        img.onclick = function() {
            showImageModal(img.src);
        };

        container.appendChild(img);
    }

    if (text && text.trim()) {
        const textDiv = document.createElement('div');
        textDiv.className = 'user-message-text';
        textDiv.textContent = text;
        container.appendChild(textDiv);
    }

    appendMessage(container);
    saveMessageToHistory(true, text, imageData);
}

function handlePaste(e) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = items[i].getAsFile();

            if (file.size > 5 * 1024 * 1024) {
                alert('Kích thước ảnh không được vượt quá 5MB!');
                return;
            }

            const reader = new FileReader();
            reader.onload = function(event) {
                selectedImage = {
                    data: event.target.result.split(',')[1],
                    mimeType: file.type,
                    fileName: `pasted-image-${Date.now()}.${file.type.split('/')[1]}`
                };
                showImagePreview(event.target.result, selectedImage.fileName);
            };
            reader.readAsDataURL(file);
            break;
        }
    }
}

function appendMessage(el) {
    const box = document.getElementById('chatBox');
    box.appendChild(el);
    scrollToBottom();
}

function scrollToBottom() {
    const mainContent = document.querySelector('.main-content');
    const botMessage = document.querySelectorAll('.bot-message');
    const lastBotMessage = botMessage[botMessage.length - 1];

    if (lastBotMessage) {
        lastBotMessage.scrollIntoView({
            behavior: 'smooth',
            block: 'start' // cuộn phần tử lên đầu trang
        });
    } else {
        // fallback nếu không có user message thì cuộn xuống cuối như cũ
        mainContent.scrollTo({
            top: mainContent.scrollHeight,
            behavior: 'smooth'
        });
    }
}

function scrollToBottomAns() {
    const mainContent = document.querySelector('.main-content');
    const UserMessage = document.querySelectorAll('.bot-message');
    const lastUserMessage = UserMessage[UserMessage.length - 1];

    if (lastUserMessage) {
        lastUserMessage.scrollIntoView({
            behavior: 'smooth',
            block: 'start' // cuộn phần tử lên đầu trang
        });
    } else {
        // fallback nếu không có user message thì cuộn xuống cuối như cũ
        mainContent.scrollTo({
            top: mainContent.scrollHeight,
            behavior: 'smooth'
        });
    }
}


function checkEnter(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askQuestion();
    }
}

document.addEventListener('paste', handlePaste);

function showImageModal(imageSrc) {
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.className = 'image-modal';
        modal.innerHTML = `
                <span class="image-modal-close">&times;</span>
                <img class="image-modal-content" id="modalImage">
            `;
        document.body.appendChild(modal);
    }

    const modalImage = document.getElementById('modalImage');
    const closeBtn = modal.querySelector('.image-modal-close');

    modalImage.src = imageSrc;
    modal.style.display = 'block';
    document.body.classList.add('modal-open');

    function closeModal() {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
        document.removeEventListener('keydown', keydownHandler);
        modal.removeEventListener('click', clickHandler);
        closeBtn.removeEventListener('click', closeModal);
    }

    function keydownHandler(event) {
        if (event.key === 'Escape') {
            closeModal();
        }
    }

    function clickHandler(event) {
        if (event.target === modal || event.target === closeBtn) {
            closeModal();
        }
    }

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', clickHandler);
    document.addEventListener('keydown', keydownHandler);
}

