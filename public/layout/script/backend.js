const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const chatBackend = require('../templates/chat/script/backend.js');

const app = express();
const port = process.env.PORT || 3000;
const projectRoot = path.join(__dirname, '../../../');
const historyCsvPath = path.join(projectRoot, 'history.csv');
const templatesPath = path.join(projectRoot, 'public', 'templates');
const uploadDir = path.join(projectRoot, 'uploads');

// Inline HTML templates (previously in separate files)
const templates = {
  'layout.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{title}}</title>
    <link rel="stylesheet" href="/layout/stylesheet/styles.css" />
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
  'home/index.html': `<div class="home-container">
  <h1 class="home-title">Welcome to Our App</h1>
  <p class="home-subtitle">Get started by entering your message below</p>
  <div class="home-input-group">
    <input type="text" class="home-textbox" id="homeInput" placeholder="Enter your message..." />
    <button class="home-button" id="homeButton">Send</button>
  </div>
</div>
<link rel="stylesheet" href="/layout/templates/home/stylesheet/home.css" />
<script src="/layout/templates/home/script/frontend.js" defer></script>`,
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
app.use(express.static(path.join(projectRoot, 'public')));

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

// Initialize chat backend
chatBackend.initializeChatBackend({
  escapeHtml,
  loadCsvSubmissions: () => loadCsvSubmissions(),
  appendToCsv: (submission) => appendToCsv(submission),
  saveCsvSubmissions: (items) => saveCsvSubmissions(items)
});

// Register chat routes
chatBackend.registerChatRoutes(app, {
  uploadHandler: upload.single('media'),
  getUsernameFromRequest,
  renderPage,
  loadCsvSubmissions: () => loadCsvSubmissions(),
  appendToCsv: (submission) => appendToCsv(submission),
  saveCsvSubmissions: (items) => saveCsvSubmissions(items),
  escapeHtml
});

app.get('/home', (req, res) => {
  const content = loadTemplate('home/index.html');
  res.send(renderPage('Home', content));
});

app.get('/settings', (req, res) => {
  const content = loadTemplate('settings/index.html');
  res.send(renderPage('Settings', content));
});

app.get('/submissions', (req, res) => {
  const csvSubmissions = loadCsvSubmissions();
  const rows = csvSubmissions
    .map((item, index) => {
      const text = escapeHtml(item.textContent);
      const media = item.mediaPath ? '✓' : '—';
      return `<tr><td>${index + 1}</td><td>${text}</td><td>${media}</td><td>${item.receivedDate}</td><td>${item.receivedTime}</td></tr>`;
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
  res.redirect('/home');
});

app.get(['/', '/index.html'], (req, res) => {
  res.redirect('/home');
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
    migrateCsvToCurrentFormat();
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
      const fields = parseCsvLine(line);
      if (isPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, , receivedDate, receivedTime] = fields;
        return [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime];
      }
      if (isOldPreviousFormat) {
        return fields;
      }
      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = fields;
        return [senderUsername, textContent, '', '', receivedDate, receivedTime];
      }
      if (isLegacyFormat) {
        const [text, createdAt] = fields;
        const date = createdAt.slice(0, 10);
        const time = createdAt.slice(11, 19);
        return ['', text, '', '', date, time];
      }
      return null;
    })
    .filter((line) => line !== null)
    .map((fields) => fields.map(escapeCsv).join(','))
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
      const fields = parseCsvLine(line);
      if (isCurrentFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = fields;
        return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
      }
      if (isPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, , receivedDate, receivedTime] = fields;
        return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
      }
      if (isOldPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = fields;
        return { senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime };
      }
      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = fields;
        return { senderUsername, textContent, mediaPath: '', mediaType: '', receivedDate, receivedTime };
      }
      if (isLegacyFormat) {
        const [text, createdAt] = fields;
        const receivedDate = createdAt.slice(0, 10);
        const receivedTime = createdAt.slice(11, 19);
        return { senderUsername: '', textContent: text, mediaPath: '', mediaType: '', receivedDate, receivedTime };
      }
      return null;
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

    if (char === '"' && (inQuotes || (current === '' || current.slice(-1) === ','))) {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '\n' && !inQuotes) {
      rows.push(current);
      current = '';
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
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
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
