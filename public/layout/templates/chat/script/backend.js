/**
 * Chat Backend - Server-side chat functionality
 * Handles chat routes, message rendering, and file uploads
 */

const path = require('path');
const fs = require('fs');

// Reference to main backend for utilities (passed from main backend.js)
let utils = null;

/**
 * Initialize chat backend with utilities from main backend
 * @param {object} mainBackendUtils - Utility functions from main backend
 */
function initializeChatBackend(mainBackendUtils) {
  utils = mainBackendUtils;
}

/**
 * Get chat page template
 * @returns {string} Chat HTML template
 */
function getChatTemplate() {
  return `<div class="card chat-card">
  <div class="brand">
    <span class="brand__mark">💬</span>
    <div>
      <h1>Chat interface</h1>
      <p class="meta">A chat-style view for submitting text and seeing recent entries as messages.</p>
    </div>
  </div>

  <div class="chat-window">{{chatItems}}</div>
  {{formNotice}}

  <form class="chat-form" method="POST" action="/upload" enctype="multipart/form-data">
    <input type="hidden" name="source" value="chat" />
    <div class="form-row">
      <label for="text">Message</label>
      <textarea id="text" name="text" placeholder="Type your message here..."></textarea>
    </div>
    <div class="form-row file-picker">
      <input id="media" name="media" type="file" accept="image/*,video/*" />
      <label class="file-picker__button" for="media">Choose file</label>
      <span class="file-picker__name">No file selected</span>
    </div>
    <div class="chat-actions">
      <button type="submit">Send message</button>
    </div>
  </form>

  <script src="/layout/templates/chat/script/frontend.js"></script>
</div>`;
}

/**
 * Get empty chat template
 * @returns {string} Empty chat HTML
 */
function getEmptyChatTemplate() {
  return `<div class="chat-empty">
  <p>Your chat window is empty. Send a message to start the conversation.</p>
</div>`;
}

/**
 * Render media attachment HTML
 * @param {object} item - Submission object with media info
 * @returns {string} HTML for media attachment
 */
function renderMediaAttachment(item) {
  if (!item.mediaPath) {
    return '';
  }

  const src = utils.escapeHtml(item.mediaPath.replace(/^\.\//, '/'));
  const filename = utils.escapeHtml(path.basename(item.mediaPath));
  const downloadButton = `<a class="chat-message__download" href="${src}" download="${filename}" title="Download attachment" aria-label="Download attachment">⬇</a>`;

  if (item.mediaType === 'image') {
    return `<div class="chat-message__media-container"><img src="${src}" alt="User attachment" class="chat-message__image" />${downloadButton}</div>`;
  }

  if (item.mediaType === 'video') {
    return `<div class="chat-message__media-container"><video class="chat-message__video" controls><source src="${src}" /></video>${downloadButton}</div>`;
  }

  return `<div class="chat-message__media-container"><a class="chat-message__media-link" href="${src}" target="_blank" rel="noopener noreferrer">Open attachment</a>${downloadButton}</div>`;
}

/**
 * Build chat items HTML
 * @param {array} allSubmissions - All chat submissions
 * @param {string} currentUsername - Current user's username
 * @returns {string} HTML for chat messages
 */
function buildChatItems(allSubmissions, currentUsername = '') {
  const recentSubmissions = allSubmissions.slice(-8);
  const normalizedCurrent = currentUsername.trim();
  
  return recentSubmissions.length
    ? recentSubmissions
        .map((item, index) => {
          const isUserMessage = item.senderUsername === normalizedCurrent;
          const messageClass = isUserMessage ? 'chat-message--user' : 'chat-message--other';
          const deleteButton = isUserMessage
            ? `<button class="chat-message__delete" data-message-index="${index}" title="Delete message" aria-label="Delete message">🗑</button>`
            : '';
          const username = utils.escapeHtml(item.senderUsername || 'Anonymous');
          const textContent = utils.escapeHtml(item.textContent);
          const mediaAttachment = renderMediaAttachment(item);
          const timestamp = `${item.receivedDate} ${item.receivedTime}`;
          return `<div class="chat-message ${messageClass}"><div class="chat-message__header"><strong>${username}</strong><span class="chat-message__timestamp">${timestamp}</span>${deleteButton}</div><div class="chat-message__body">${textContent}${mediaAttachment}</div></div>`;
        })
        .join('')
    : getEmptyChatTemplate();
}

/**
 * Register chat routes with Express app
 * @param {object} app - Express app instance
 * @param {object} options - Configuration options
 */
function registerChatRoutes(app, options) {
  const {
    uploadHandler,
    getUsernameFromRequest,
    renderPage,
    loadCsvSubmissions,
    appendToCsv,
    saveCsvSubmissions,
    escapeHtml
  } = options;

  // Chat GET route
  app.get('/chat', (req, res) => {
    const currentUsername = getUsernameFromRequest(req);
    const allSubmissions = loadCsvSubmissions();
    const chatItems = buildChatItems(allSubmissions, currentUsername);
    const contentTemplate = getChatTemplate();
    const content = contentTemplate
      .replace('{{chatItems}}', chatItems)
      .replace('{{formNotice}}', '')
      .replace('{{usernameInput}}', '');
    res.send(renderPage('Chat interface', content, currentUsername));
  });

  // Upload POST route
  app.post('/upload', uploadHandler, (req, res) => {
    const textContent = (req.body.text || '').trim();
    const senderUsername = (req.body.senderUsername || '').trim();
    const usernameFromCookie = getUsernameFromRequest(req);
    const usernameForRender = senderUsername || usernameFromCookie;
    const storedSenderUsername = senderUsername || usernameForRender;
    const file = req.file;
    const hasText = textContent.length > 0;
    const hasMedia = Boolean(file);

    if (!hasText && !hasMedia) {
      const allSubmissions = loadCsvSubmissions();
      const chatItems = buildChatItems(allSubmissions, usernameForRender);
      const contentTemplate = getChatTemplate();
      const content = contentTemplate
        .replace('{{chatItems}}', chatItems)
        .replace('{{formNotice}}', '<div class="notice">Please add text or attach a photo/video.</div>')
        .replace('{{usernameInput}}', '');
      return res.status(400).send(renderPage('Chat interface', content, usernameForRender));
    }

    const now = new Date();
    const receivedDate = now.toISOString().slice(0, 10);
    const receivedTime = now.toISOString().slice(11, 19);

    if (usernameForRender) {
      res.setHeader('Set-Cookie', `username=${encodeURIComponent(usernameForRender)}; Path=/; SameSite=Lax; Max-Age=31536000`);
    }

    let mediaPath = '';
    let mediaType = '';

    if (hasMedia) {
      mediaPath = `./uploads/${file.filename}`;
      mediaType = file.mimetype.startsWith('image') ? 'image' : 'video';
    }

    const submission = {
      senderUsername: storedSenderUsername,
      textContent,
      mediaPath,
      mediaType,
      receivedDate,
      receivedTime
    };

    try {
      appendToCsv(submission);
    } catch (error) {
      const allSubmissions = loadCsvSubmissions();
      const chatItems = buildChatItems(allSubmissions, usernameForRender);
      const contentTemplate = getChatTemplate();
      const content = contentTemplate
        .replace('{{chatItems}}', chatItems)
        .replace('{{formNotice}}', `<div class="notice">Failed to save submission: ${escapeHtml(error.message)}</div>`)
        .replace('{{usernameInput}}', '');
      return res.status(500).send(renderPage('Submission error', content, usernameForRender));
    }

    res.redirect('/chat');
  });

  // Delete message POST route
  app.post('/delete-message', (req, res) => {
    const currentUsername = getUsernameFromRequest(req);
    const messageIndex = Number(req.body.messageIndex);

    if (!Number.isNaN(messageIndex)) {
      const allSubmissions = loadCsvSubmissions();
      if (messageIndex >= 0 && messageIndex < allSubmissions.length) {
        const messageToDelete = allSubmissions[messageIndex];
        if (messageToDelete.senderUsername === currentUsername) {
          allSubmissions.splice(messageIndex, 1);
          saveCsvSubmissions(allSubmissions);
        }
      }
    }

    res.redirect('/chat');
  });
}

module.exports = {
  initializeChatBackend,
  getChatTemplate,
  getEmptyChatTemplate,
  renderMediaAttachment,
  buildChatItems,
  registerChatRoutes
};
