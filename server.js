const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const historyCsvPath = path.join(__dirname, 'history.csv');
const templatesPath = path.join(__dirname, 'public', 'templates');

ensureCsvFile();
const submissions = loadCsvSubmissions();

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

app.post('/upload', (req, res) => {
  const textContent = (req.body.text || '').trim();
  const senderUsername = (req.body.senderUsername || '').trim();
  const usernameForRender = senderUsername || getUsernameFromRequest(req);

  if (!textContent) {
    const contentTemplate = loadTemplate('chat.html');
    const content = contentTemplate
      .replace('{{chatItems}}', buildChatItems())
      .replace('{{formNotice}}', '<div class="notice">Text cannot be empty.</div>');
    return res.status(400).send(renderPage('Chat interface', content, usernameForRender));
  }

  const now = new Date();
  const receivedDate = now.toISOString().slice(0, 10);
  const receivedTime = now.toISOString().slice(11, 19);

  if (usernameForRender) {
    res.setHeader('Set-Cookie', `username=${encodeURIComponent(usernameForRender)}; Path=/; SameSite=Lax; Max-Age=31536000`);
  }

  const submission = { textContent, receivedTime, receivedDate, senderUsername };
  submissions.push(submission);

  try {
    appendToCsv(submission);
  } catch (error) {
    console.error('Failed to write history.csv:', error);
    return res.status(500).send(
      renderPageFromTemplate(
        'Server error',
        'server-error.html',
        getUsernameFromRequest(req)
      )
    );
  }

  res.redirect('/chat');
});

function buildChatItems(currentUsername = '') {
  const recentSubmissions = loadCsvSubmissions().slice(-8);
  const normalizedCurrent = currentUsername.trim();
  return recentSubmissions.length
    ? recentSubmissions
        .map((item) => {
          const sender = item.senderUsername ? escapeHtml(item.senderUsername) : 'Anonymous';
          const message = escapeHtml(item.textContent);
          const isOwnMessage = normalizedCurrent && sender === normalizedCurrent;
          const bubbleClass = isOwnMessage ? 'chat-message--user' : 'chat-message--other';
          return `
            <div class="chat-message ${bubbleClass}">
              <div class="chat-message__body">${message}</div>
              <div class="chat-message__meta">${sender} · ${escapeHtml(item.receivedDate)} ${escapeHtml(item.receivedTime)}</div>
            </div>`;
        })
        .join('')
    : loadTemplate('chat-empty.html');
}

app.get('/chat', (req, res) => {
  const currentUsername = getUsernameFromRequest(req);
  const usernameInput = currentUsername
    ? ''
    : `<div class="form-row">
         <label for="senderUsername">Username</label>
         <input id="senderUsername" name="senderUsername" type="text" placeholder="Your username (optional)" autocomplete="username" />
       </div>`;

  const contentTemplate = loadTemplate('chat.html');
  const content = contentTemplate
    .replace('{{chatItems}}', buildChatItems(currentUsername))
    .replace('{{formNotice}}', '')
    .replace('{{usernameInput}}', usernameInput);
  res.send(renderPage('Chat interface', content, currentUsername));
});

app.get('/submissions', (req, res) => {
  const csvSubmissions = loadCsvSubmissions();
  const rows = csvSubmissions
    .map(
      (item, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(item.senderUsername)}</td><td><pre>${escapeHtml(item.textContent)}</pre></td><td>${escapeHtml(item.receivedDate)}</td><td>${escapeHtml(item.receivedTime)}</td></tr>`
    )
    .join('');

  const contentTemplate = loadTemplate('submissions.html');
  const content = contentTemplate.replace('{{rows}}', rows || loadTemplate('no-submissions.html'));
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

app.use(express.static(path.join(__dirname, 'public')));

function renderIndexPage(username) {
  const indexFilePath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(indexFilePath, 'utf8');
  const bannerHtml = username
    ? `<div id="username-banner" class="username-banner" aria-live="polite">Signed in as ${escapeHtml(username)}</div>`
    : '<div id="username-banner" class="username-banner" aria-live="polite"></div>';

  const usernameSection = username
    ? ''
    : `<div class="form-group">
          <label for="senderUsername">Your username (optional)</label>
          <input id="senderUsername" name="senderUsername" type="text" placeholder="Enter your username" autocomplete="username" />
        </div>
        <div class="skip-container">
          <a class="button-link" href="/skip">Skip and continue as anonymous</a>
        </div>`;

  html = html.replace(
    '<div id="username-banner" class="username-banner" aria-live="polite"></div>',
    bannerHtml
  );

  return html.replace('{{usernameSection}}', usernameSection);
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

function ensureCsvFile() {
  if (!fs.existsSync(historyCsvPath)) {
    fs.writeFileSync(historyCsvPath, 'senderUsername,textContent,receivedDate,receivedTime\n', 'utf8');
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
  const currentHeader = ['senderUsername', 'textContent', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
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

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const date = createdAt ? new Date(createdAt) : null;
        const receivedDate = date ? date.toISOString().slice(0, 10) : '';
        const receivedTime = date ? date.toISOString().slice(11, 19) : '';
        return `${escapeCsv('')},${escapeCsv(text)},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
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
  const currentHeader = ['senderUsername', 'textContent', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
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
        const [senderUsername, textContent, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, receivedDate, receivedTime };
      }

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return { senderUsername, textContent, receivedDate, receivedTime };
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const [receivedDate, receivedTime] = createdAt.split('T');
        return {
          senderUsername: '',
          textContent: text,
          receivedDate: receivedDate || '',
          receivedTime: receivedTime ? receivedTime.replace(/Z$/, '') : ''
        };
      }

      const [senderUsername, textContent, receivedDate, receivedTime] = values.concat(['', '', '', '']).slice(0, 4);
      return { senderUsername, textContent, receivedDate, receivedTime };
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
  const line = `${escapeCsv(submission.senderUsername)},${escapeCsv(submission.textContent)},${escapeCsv(submission.receivedDate)},${escapeCsv(submission.receivedTime)}\n`;
  fs.appendFileSync(historyCsvPath, line, 'utf8');
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
  const filePath = path.join(templatesPath, filename);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Failed to load template ${filename}:`, error);
    return '';
  }
}

function renderPage(title, content, username = '') {
  const layout = loadTemplate('layout.html');
  const usernameDisplay = username
    ? `<a class="username-banner" href="/signout" title="Click to sign out">Signed in as ${escapeHtml(username)}</a>`
    : '';

  return layout
    .replace('{{title}}', escapeHtml(title))
    .replace('{{usernameDisplay}}', usernameDisplay)
    .replace('{{content}}', content);
}

function renderPageFromTemplate(title, templateName, username = '') {
  const content = loadTemplate(templateName);
  return renderPage(title, content, username);
}
