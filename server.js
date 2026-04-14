const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
const historyCsvPath = path.join(__dirname, 'history.csv');
const templatesPath = path.join(__dirname, 'public', 'templates');
const uploadDir = path.join(__dirname, 'uploads');

// Inline HTML templates (previously in separate files)
const templates = {
  'layout.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{title}}</title>
  </head>
  <body>
    <main class="page-shell">
      <header class="top-bar">
        <nav class="top-bar__nav" aria-label="Primary navigation">
          <a class="top-bar__link" href="/home">Home</a>
          <a class="top-bar__link top-bar__link--active" href="/chat">Chat</a>
          <a class="top-bar__link" href="/settings">Settings</a>
        </nav>
        <div class="top-bar__actions">
          <input class="top-bar__input" type="text" placeholder="Random text..." aria-label="Random text input" />
        </div>
      </header>
      <div class="page-content">{{content}}</div>
    </main>
  </body>
</html>`,
  'chat/index.html': `<div class="card chat-card">
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

  <script>
    window.addEventListener('load', () => {
      const chatWindow = document.querySelector('.chat-window');
      if (chatWindow) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
      }

      document.addEventListener('click', () => {
        document.querySelectorAll('.chat-message.show-delete').forEach((msg) => {
          msg.classList.remove('show-delete');
        });
      });

      document.querySelectorAll('.chat-message--user').forEach((message) => {
        message.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          document.querySelectorAll('.chat-message.show-delete').forEach((msg) => {
            msg.classList.remove('show-delete');
          });
          message.classList.add('show-delete');
        });
      });

      const fileInput = document.getElementById('media');
      const fileNameDisplay = document.querySelector('.file-picker__name');
      if (fileInput && fileNameDisplay) {
        fileInput.addEventListener('change', () => {
          fileNameDisplay.textContent = fileInput.files.length
            ? fileInput.files[0].name
            : 'No file selected';
        });
      }
    });
  </script>
</div>`,
  'chat/empty.html': `<div class="chat-empty">
  <p>Your chat window is empty. Send a message to start the conversation.</p>
</div>`,
  'home/index.html': '',
  'settings/index.html': ''
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const originalName = file.originalname || 'upload';
    const safeName = originalName
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-');
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video uploads are allowed.'));
    }
  }
});

ensureCsvFile();
ensureUploadDir();
let submissions = loadCsvSubmissions();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function parseCookies(cookieHeader) {
  return (cookieHeader || '')
    .split(';')
    .map((cookiePair) => cookiePair.trim())
    .filter(Boolean)
    .reduce((cookies, cookiePair) => {
      const separatorIndex = cookiePair.indexOf('=');
      if (separatorIndex === -1) return cookies;
      const name = cookiePair.slice(0, separatorIndex).trim();
      const value = cookiePair.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie || '');
  next();
});

function getCookieValue(req, name) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader
    .split(';')
    .map((cookiePair) => cookiePair.trim())
    .reduce((acc, cookiePair) => {
      const separatorIndex = cookiePair.indexOf('=');
      if (separatorIndex === -1) return acc;
      const key = cookiePair.slice(0, separatorIndex).trim();
      const value = cookiePair.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {})[name] || '';
}

function getUsernameFromRequest(req) {
  return (req.cookies.username || '').trim();
}

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

app.post('/upload', upload.single('media'), (req, res) => {
  const textContent = (req.body.text || '').trim();
  const senderUsername = (req.body.senderUsername || '').trim();
  const usernameFromCookie = getUsernameFromRequest(req);
  const usernameForRender = senderUsername || usernameFromCookie;
  const storedSenderUsername = senderUsername || usernameForRender;
  const file = req.file;
  const hasText = textContent.length > 0;
  const hasMedia = Boolean(file);

  if (!hasText && !hasMedia) {
    const contentTemplate = loadTemplate('chat/index.html');
    const content = contentTemplate
      .replace('{{chatItems}}', buildChatItems(usernameForRender))
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
    mediaPath = `/uploads/${encodeURIComponent(path.basename(file.filename))}`;
    mediaType = file.mimetype.startsWith('image/') ? 'image' : file.mimetype.startsWith('video/') ? 'video' : '';
  }

  const submission = {
    senderUsername: storedSenderUsername,
    textContent,
    mediaPath,
    mediaType,
    receivedDate,
    receivedTime
  };

  submissions.push(submission);

  try {
    appendToCsv(submission);
  } catch (error) {
    console.error('Failed to write history.csv:', error);
    const errorContent = `
      <div class="card">
        <div class="brand">
          <span class="brand__mark">⚠️</span>
          <div>
            <h1>Server error</h1>
            <p class="meta">Unable to save your submission right now.</p>
          </div>
        </div>
      </div>`;
    return res.status(500).send(renderPage('Server error', errorContent, getUsernameFromRequest(req)));
  }

  res.redirect('/chat');
});

app.post('/delete-message', (req, res) => {
  const currentUsername = getUsernameFromRequest(req);
  const messageIndex = Number(req.body.messageIndex);

  if (!Number.isNaN(messageIndex)) {
    const allSubmissions = loadCsvSubmissions();
    if (messageIndex >= 0 && messageIndex < allSubmissions.length) {
      const item = allSubmissions[messageIndex];
      const storedSender = item.senderUsername || '';

      if (currentUsername && currentUsername === storedSender) {
        allSubmissions.splice(messageIndex, 1);
        submissions.splice(messageIndex, 1);
        saveCsvSubmissions(allSubmissions);
      }
    }
  }

  res.redirect('/chat');
});

function renderMediaAttachment(item) {
  if (!item.mediaPath) {
    return '';
  }

  const src = escapeHtml(item.mediaPath);
  const filename = escapeHtml(path.basename(item.mediaPath));
  const downloadButton = `<a class="chat-message__download" href="${src}" download="${filename}" title="Download attachment" aria-label="Download attachment">⬇</a>`;

  if (item.mediaType === 'image') {
    return `<div class="chat-message__media-container"><img class="chat-message__media" src="${src}" alt="Shared image" />${downloadButton}</div>`;
  }

  if (item.mediaType === 'video') {
    return `<div class="chat-message__media-container"><video class="chat-message__media" controls preload="metadata" src="${src}"></video>${downloadButton}</div>`;
  }

  return `<div class="chat-message__media-container"><a class="chat-message__media-link" href="${src}" target="_blank" rel="noopener noreferrer">Open attachment</a>${downloadButton}</div>`;
}

function buildChatItems(currentUsername = '') {
  const allSubmissions = loadCsvSubmissions();
  const recentSubmissions = allSubmissions.slice(-8);
  const normalizedCurrent = currentUsername.trim();
  return recentSubmissions.length
    ? recentSubmissions
        .map((item, index) => {
          const globalIndex = allSubmissions.length - recentSubmissions.length + index;
          const sender = item.senderUsername ? escapeHtml(item.senderUsername) : 'Anonymous';
          const message = escapeHtml(item.textContent);
          const mediaHtml = renderMediaAttachment(item);
          const bodyHtml = message ? `<div class="chat-message__body">${message}</div>` : '';
          const isOwnMessage = normalizedCurrent && sender === normalizedCurrent;
          const bubbleClass = isOwnMessage ? 'chat-message--user' : 'chat-message--other';
          const deleteButton = isOwnMessage
            ? `<form class="chat-message__delete-form" method="POST" action="/delete-message">
                 <input type="hidden" name="messageIndex" value="${globalIndex}" />
                 <button type="submit" class="chat-message__delete-button">Delete</button>
               </form>`
            : '';

          return `
            <div class="chat-message ${bubbleClass}">
              ${bodyHtml}
              ${mediaHtml}
              <div class="chat-message__meta">${escapeHtml(item.receivedDate)} ${escapeHtml(item.receivedTime)}</div>
              ${deleteButton}
            </div>`;
        })
        .join('')
    : loadTemplate('chat/empty.html');
}

app.get('/home', (req, res) => {
  const content = loadTemplate('home/index.html');
  res.send(renderPage('Home', content));
});

app.get('/chat', (req, res) => {
  const currentUsername = getUsernameFromRequest(req);
  const contentTemplate = loadTemplate('chat/index.html');
  const content = contentTemplate
    .replace('{{chatItems}}', buildChatItems(currentUsername))
    .replace('{{formNotice}}', '')
    .replace('{{usernameInput}}', '');
  res.send(renderPage('Chat interface', content, currentUsername));
});

app.get('/settings', (req, res) => {
  const content = loadTemplate('settings/index.html');
  res.send(renderPage('Settings', content));
});

app.get('/submissions', (req, res) => {
  const csvSubmissions = loadCsvSubmissions();
  const rows = csvSubmissions
    .map((item, index) => {
      const mediaCell = item.mediaPath
        ? `<a href="${escapeHtml(item.mediaPath)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.mediaType || 'file')}</a>`
        : '';
      return `<tr><td>${index + 1}</td><td><pre>${escapeHtml(item.textContent)}</pre></td><td>${mediaCell}</td><td>${escapeHtml(item.receivedDate)}</td><td>${escapeHtml(item.receivedTime)}</td></tr>`;
    })
    .join('');

  const rowsHtml = rows || '<tr><td colspan="5">No submissions found.</td></tr>';
  const content = `
    <div class="card">
      <div class="brand">
        <span class="brand__mark">📥</span>
        <div>
          <h1>Received submissions</h1>
          <p class="meta">Browse all saved text submissions from the form.</p>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Text</th>
              <th>Media</th>
              <th>Date</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div class="footer-links">
        <a class="button-link" href="/">Back to upload page</a>
      </div>
    </div>`;
  res.send(renderPage('Received submissions', content, getUsernameFromRequest(req)));
});

app.get('/skip', (req, res) => {
  const username = 'anonymous';
  res.setHeader('Set-Cookie', `username=${encodeURIComponent(username)}; Path=/; SameSite=Lax; Max-Age=31536000`);
  res.redirect('/');
});

app.get('/signout', (req, res) => {
  res.setHeader('Set-Cookie', 'username=; Path=/; SameSite=Lax; Max-Age=0');
  res.redirect('/chat');
});

app.get(['/', '/index.html'], (req, res) => {
  res.redirect('/chat');
});

app.use('/uploads', express.static(uploadDir));

app.use((err, req, res, next) => {
  if (!err) {
    return next();
  }

  const currentUsername = getUsernameFromRequest(req);
  const usernameInput = '';

  const contentTemplate = loadTemplate('chat/index.html');
  const content = contentTemplate
    .replace('{{chatItems}}', buildChatItems(currentUsername))
    .replace('{{formNotice}}', `<div class="notice">${escapeHtml(err.message)}</div>`)
    .replace('{{usernameInput}}', usernameInput);

  res.status(400).send(renderPage('Upload error', content, currentUsername));
});

const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

function ensureCsvFile() {
  if (!fs.existsSync(historyCsvPath)) {
    fs.writeFileSync(historyCsvPath, 'senderUsername,textContent,mediaPath,mediaType,receivedDate,receivedTime\n', 'utf8');
  } else {
    migrateCsvToCurrentFormat();
  }
}

function migrateCsvToCurrentFormat() {
  const content = fs.readFileSync(historyCsvPath, 'utf8');
  const rows = splitCsvRows(content);
  if (rows.length === 0) {
    return;
  }

  const header = parseCsvLine(rows[0]);
  const currentHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'receivedDate', 'receivedTime'];
  const previousHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'channel', 'receivedDate', 'receivedTime'];
  const oldPreviousHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
  const isPreviousFormat = arraysEqual(header, previousHeader);
  const isOldPreviousFormat = arraysEqual(header, oldPreviousHeader);
  const isOldFormat = arraysEqual(header, oldHeader);
  const isLegacyFormat = arraysEqual(header, legacyHeader);

  if (isCurrentFormat) {
    return;
  }

  const migratedRows = rows
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line);
      if (values.length === 0 || (values.length === 1 && values[0] === '')) {
        return null;
      }

      if (isPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime] = values;
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(mediaPath)},${escapeCsv(mediaType)},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isOldPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = values;
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(mediaPath)},${escapeCsv(mediaType)},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv('')},${escapeCsv('')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const date = createdAt ? new Date(createdAt) : null;
        const receivedDate = date ? date.toISOString().slice(0, 10) : '';
        const receivedTime = date ? date.toISOString().slice(11, 19) : '';
        return `${escapeCsv('')},${escapeCsv(text)},${escapeCsv('')},${escapeCsv('')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      return null;
    })
    .filter((line) => line !== null)
    .join('\n');

  fs.writeFileSync(historyCsvPath, currentHeader.join(',') + '\n' + (migratedRows ? migratedRows + '\n' : ''), 'utf8');
}

function loadCsvSubmissions() {
  const content = fs.readFileSync(historyCsvPath, 'utf8');
  const rows = splitCsvRows(content);

  if (rows.length <= 1) {
    return [];
  }

  const header = parseCsvLine(rows[0]);
  const currentHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'receivedDate', 'receivedTime'];
  const previousHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'channel', 'receivedDate', 'receivedTime'];
  const oldPreviousHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
  const isPreviousFormat = arraysEqual(header, previousHeader);
  const isOldPreviousFormat = arraysEqual(header, oldPreviousHeader);
  const isOldFormat = arraysEqual(header, oldHeader);
  const isLegacyFormat = arraysEqual(header, legacyHeader);

  return rows
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line);
      if (values.length === 0 || (values.length === 1 && values[0] === '')) {
        return null;
      }

      if (isCurrentFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
      }

      if (isPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
      }

      if (isOldPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
      }

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return { senderUsername, textContent, mediaPath: '', mediaType: '', receivedDate, receivedTime };
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const [receivedDate, receivedTime] = createdAt.split('T');
        return {
          senderUsername: '',
          textContent: text,
          mediaPath: '',
          mediaType: '',
          receivedDate: receivedDate || '',
          receivedTime: receivedTime ? receivedTime.replace(/Z$/, '') : ''
        };
      }

      const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = values.concat(['', '', '', '', '', '']).slice(0, 6);
      return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
    })
    .filter(Boolean);
}

function splitCsvRows(content) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\n') {
        rows.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim() !== '') {
    rows.push(current);
  }

  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === ',') {
      result.push(current);
      current = '';
    } else if (char === '"') {
      inQuotes = true;
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function appendToCsv(submission) {
  const line = `${escapeCsv(submission.senderUsername)},${escapeCsv(submission.textContent)},${escapeCsv(submission.mediaPath || '')},${escapeCsv(submission.mediaType || '')},${escapeCsv(submission.receivedDate)},${escapeCsv(submission.receivedTime)}\n`;
  fs.appendFileSync(historyCsvPath, line, 'utf8');
}

function saveCsvSubmissions(items) {
  const header = 'senderUsername,textContent,mediaPath,mediaType,receivedDate,receivedTime\n';
  const body = items
    .map(({ senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime }) =>
      `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(mediaPath || '')},${escapeCsv(mediaType || '')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`
    )
    .join('\n');
  fs.writeFileSync(historyCsvPath, header + (body ? body + '\n' : ''), 'utf8');
}

function escapeCsv(value) {
  const stringValue = String(value);
  const needsQuotes = /[",\n\r]/.test(stringValue);
  const escaped = stringValue.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadTemplate(filename) {
  return templates[filename] || '';
}

function renderPage(title, content, username = '') {
  const layout = loadTemplate('layout.html');
  const usernameDisplay = '';

  return layout
    .replace('{{title}}', escapeHtml(title))
    .replace('{{usernameDisplay}}', usernameDisplay)
    .replace('{{content}}', content);
}

function renderPageFromTemplate(title, templateName, username = '') {
  const content = loadTemplate(templateName);
  return renderPage(title, content, username);
}
