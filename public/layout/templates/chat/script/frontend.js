/**
 * Chat Frontend - Client-side chat interactions
 * Handles chat window scrolling, message deletion, and file picker
 */

window.addEventListener('load', () => {
  initializeChatWindow();
  initializeMessageInteractions();
  initializeFilePicker();
});

/**
 * Initialize chat window - scroll to bottom on load
 */
function initializeChatWindow() {
  const chatWindow = document.querySelector('.chat-window');
  if (chatWindow) {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

/**
 * Initialize message interactions - delete buttons and context menu
 */
function initializeMessageInteractions() {
  // Close delete buttons when clicking elsewhere
  document.addEventListener('click', (event) => {
    const clickedDeleteButton = event.target.classList.contains('chat-message__delete');
    if (!clickedDeleteButton) {
      document.querySelectorAll('.chat-message.show-delete').forEach((msg) => {
        msg.classList.remove('show-delete');
      });
    }
  });

  // Add context menu handler for user messages
  document.querySelectorAll('.chat-message--user').forEach((message) => {
    message.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      document.querySelectorAll('.chat-message.show-delete').forEach((msg) => {
        msg.classList.remove('show-delete');
      });
      message.classList.add('show-delete');
    });
  });

  // Add delete button click handlers
  document.querySelectorAll('.chat-message__delete').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const messageIndex = button.getAttribute('data-message-index');
      deleteMessage(messageIndex);
    });
  });
}

/**
 * Initialize file picker - update displayed filename
 */
function initializeFilePicker() {
  const fileInput = document.getElementById('media');
  const fileNameDisplay = document.querySelector('.file-picker__name');
  
  if (fileInput && fileNameDisplay) {
    fileInput.addEventListener('change', () => {
      fileNameDisplay.textContent = fileInput.files.length
        ? fileInput.files[0].name
        : 'No file selected';
    });
  }
}

/**
 * Delete a message and submit the delete form
 * @param {string} messageIndex - Index of the message to delete
 */
function deleteMessage(messageIndex) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/delete-message';
  
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'messageIndex';
  input.value = messageIndex;
  
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
