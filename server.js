const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
const historyCsvPath = path.join(__dirname, 'history.csv');
const templatesPath = path.join(__dirname, 'public', 'templates');
const uploadDir = path.join(__dirname, 'public', 'uploads');
const channelsPath = path.join(__dirname, 'channels.json');

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
ensureChannelsFile();
let channels = loadChannels();
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

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

function ensureChannelsFile() {
  if (!fs.existsSync(channelsPath)) {
    fs.writeFileSync(channelsPath, JSON.stringify(['general'], null, 2), 'utf8');
  }
}

function loadChannels() {
  try {
    const content = fs.readFileSync(channelsPath, 'utf8');
    const data = JSON.parse(content);
    if (Array.isArray(data) && data.length > 0) {
      return Array.from(new Set(data.map((name) => String(name).trim()).filter(Boolean)));
    }
  } catch (error) {
    console.error('Failed to load channels:', error);
  }
  return ['general'];
}

function saveChannels(items) {
  const normalized = Array.from(new Set(items.map((name) => String(name).trim()).filter(Boolean)));
  fs.writeFileSync(channelsPath, JSON.stringify(normalized, null, 2), 'utf8');
}

function normalizeChannelName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-');
}

function renderChannelControls(currentChannel) {
  const channelItems = channels
    .map((channel) => {
      const safeChannel = escapeHtml(channel);
      const selectedClass = channel === currentChannel ? 'channel-pill--active' : '';
      const deleteButton = channel !== 'general'
        ? `<form class="channel-pill__delete" method="POST" action="/channels/delete">
             <input type="hidden" name="channelName" value="${escapeHtml(channel)}" />
             <input type="hidden" name="currentChannel" value="${escapeHtml(currentChannel)}" />
             <button type="submit" aria-label="Delete channel ${safeChannel}">×</button>
           </form>`
        : '';

      return `<div class="channel-pill ${selectedClass}"><a href="/chat?channel=${encodeURIComponent(channel)}">${safeChannel}</a>${deleteButton}</div>`;
    })
    .join('');

  return `
    <div class="channel-bar">
      <div class="channel-list">${channelItems}</div>
      <form class="channel-form" method="POST" action="/channels/create">
        <label for="channelName">Create channel</label>
        <input id="channelName" name="channelName" type="text" placeholder="new-channel" autocomplete="off" />
        <button type="submit">Create</button>
      </form>
    </div>
  `;
}

app.post('/channels/create', (req, res) => {
  const requestedName = normalizeChannelName(req.body.channelName || '');
  const channelName = requestedName || 'general';

  if (!channels.includes(channelName)) {
    channels.push(channelName);
    saveChannels(channels);
  }

  res.redirect(`/chat?channel=${encodeURIComponent(channelName)}`);
});

app.post('/channels/delete', (req, res) => {
  const requestedName = (req.body.channelName || '').trim();
  const currentChannel = (req.body.currentChannel || 'general').trim();
  const channelName = requestedName;

  if (channelName && channelName !== 'general' && channels.includes(channelName)) {
    const remainingChannels = channels.filter((name) => name !== channelName);
    channels = remainingChannels.length > 0 ? remainingChannels : ['general'];
    saveChannels(channels);

    const allSubmissions = loadCsvSubmissions();
    const filteredSubmissions = allSubmissions.filter((item) => item.channel !== channelName);
    saveCsvSubmissions(filteredSubmissions);
  }

  const redirectChannel = channels.includes(currentChannel) ? currentChannel : 'general';
  res.redirect(`/chat?channel=${encodeURIComponent(redirectChannel)}`);
});

app.post('/upload', upload.single('media'), (req, res) => {
  const textContent = (req.body.text || '').trim();
  const senderUsername = (req.body.senderUsername || '').trim();
  const requestedChannel = (req.body.channel || '').trim();
  const currentChannel = channels.includes(requestedChannel) ? requestedChannel : 'general';
  const usernameFromCookie = getUsernameFromRequest(req);
  const usernameForRender = senderUsername || usernameFromCookie;
  const storedSenderUsername = senderUsername || usernameForRender;
  const file = req.file;
  const hasText = textContent.length > 0;
  const hasMedia = Boolean(file);

  if (!hasText && !hasMedia) {
    const contentTemplate = loadTemplate('chat.html');
    const content = contentTemplate
      .replace('{{chatItems}}', buildChatItems(usernameForRender, currentChannel))
      .replace('{{formNotice}}', '<div class="notice">Please add text or attach a photo/video.</div>')
      .replace('{{channelControls}}', renderChannelControls(currentChannel))
      .replace('{{currentChannel}}', escapeHtml(currentChannel));
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
    channel: currentChannel,
    receivedDate,
    receivedTime
  };

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

  res.redirect(`/chat?channel=${encodeURIComponent(currentChannel)}`);
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

function buildChatItems(currentUsername = '', currentChannel = 'general') {
  const allSubmissions = loadCsvSubmissions().filter((item) => {
    return String(item.channel || 'general') === currentChannel;
  });
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
              <div class="chat-message__meta">${sender} · ${escapeHtml(item.receivedDate)} ${escapeHtml(item.receivedTime)}</div>
              ${deleteButton}
            </div>`;
        })
        .join('')
    : loadTemplate('chat-empty.html');
}

app.get('/chat', (req, res) => {
  const currentUsername = getUsernameFromRequest(req);
  const requestedChannel = (req.query.channel || '').trim();
  const currentChannel = channels.includes(requestedChannel) ? requestedChannel : 'general';
  const usernameInput = currentUsername
    ? ''
    : `<div class="form-row">
         <label for="senderUsername">Username</label>
         <input id="senderUsername" name="senderUsername" type="text" placeholder="Your username (optional)" autocomplete="username" />
       </div>`;

  const contentTemplate = loadTemplate('chat.html');
  const content = contentTemplate
    .replace('{{chatItems}}', buildChatItems(currentUsername, currentChannel))
    .replace('{{formNotice}}', '')
    .replace('{{usernameInput}}', usernameInput)
    .replace('{{channelControls}}', renderChannelControls(currentChannel))
    .replace('{{currentChannel}}', escapeHtml(currentChannel));
  res.send(renderPage('Chat interface', content, currentUsername));
});

app.get('/submissions', (req, res) => {
  const csvSubmissions = loadCsvSubmissions();
  const rows = csvSubmissions
    .map((item, index) => {
      const mediaCell = item.mediaPath
        ? `<a href="${escapeHtml(item.mediaPath)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.mediaType || 'file')}</a>`
        : '';
      return `<tr><td>${index + 1}</td><td>${escapeHtml(item.senderUsername)}</td><td><pre>${escapeHtml(item.textContent)}</pre></td><td>${mediaCell}</td><td>${escapeHtml(item.channel || 'general')}</td><td>${escapeHtml(item.receivedDate)}</td><td>${escapeHtml(item.receivedTime)}</td></tr>`;
    })
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

app.use((err, req, res, next) => {
  if (!err) {
    return next();
  }

  const currentUsername = getUsernameFromRequest(req);
  const usernameInput = currentUsername
    ? ''
    : `<div class="form-row">
         <label for="senderUsername">Username</label>
         <input id="senderUsername" name="senderUsername" type="text" placeholder="Your username (optional)" autocomplete="username" />
       </div>`;

  const currentChannel = 'general';
  const contentTemplate = loadTemplate('chat.html');
  const content = contentTemplate
    .replace('{{chatItems}}', buildChatItems(currentUsername, currentChannel))
    .replace('{{formNotice}}', `<div class="notice">${escapeHtml(err.message)}</div>`)
    .replace('{{usernameInput}}', usernameInput)
    .replace('{{channelControls}}', renderChannelControls(currentChannel))
    .replace('{{currentChannel}}', escapeHtml(currentChannel));

  res.status(400).send(renderPage('Upload error', content, currentUsername));
});

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

const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

function ensureCsvFile() {
  if (!fs.existsSync(historyCsvPath)) {
    fs.writeFileSync(historyCsvPath, 'senderUsername,textContent,mediaPath,mediaType,channel,receivedDate,receivedTime\n', 'utf8');
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
  const currentHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'channel', 'receivedDate', 'receivedTime'];
  const previousHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
  const isPreviousFormat = arraysEqual(header, previousHeader);
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
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv('')},${escapeCsv('')},${escapeCsv('general')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = values;
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(mediaPath)},${escapeCsv(mediaType)},${escapeCsv('general')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const date = createdAt ? new Date(createdAt) : null;
        const receivedDate = date ? date.toISOString().slice(0, 10) : '';
        const receivedTime = date ? date.toISOString().slice(11, 19) : '';
        return `${escapeCsv('')},${escapeCsv(text)},${escapeCsv('')},${escapeCsv('')},${escapeCsv('general')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
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
  const currentHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'channel', 'receivedDate', 'receivedTime'];
  const previousHeader = ['senderUsername', 'textContent', 'mediaPath', 'mediaType', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
  const isPreviousFormat = arraysEqual(header, previousHeader);
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
        const [senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime };
      }

      if (isPreviousFormat) {
        const [senderUsername, textContent, mediaPath, mediaType, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, mediaPath, mediaType, channel: 'general', receivedDate, receivedTime };
      }

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return { senderUsername, textContent, mediaPath: '', mediaType: '', channel: 'general', receivedDate, receivedTime };
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const [receivedDate, receivedTime] = createdAt.split('T');
        return {
          senderUsername: '',
          textContent: text,
          mediaPath: '',
          mediaType: '',
          channel: 'general',
          receivedDate: receivedDate || '',
          receivedTime: receivedTime ? receivedTime.replace(/Z$/, '') : ''
        };
      }

      const [senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime] = values.concat(['', '', '', '', '', '', '']).slice(0, 7);
      return { senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime };
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
  const line = `${escapeCsv(submission.senderUsername)},${escapeCsv(submission.textContent)},${escapeCsv(submission.mediaPath || '')},${escapeCsv(submission.mediaType || '')},${escapeCsv(submission.channel || 'general')},${escapeCsv(submission.receivedDate)},${escapeCsv(submission.receivedTime)}\n`;
  fs.appendFileSync(historyCsvPath, line, 'utf8');
}

function saveCsvSubmissions(items) {
  const header = 'senderUsername,textContent,mediaPath,mediaType,channel,receivedDate,receivedTime\n';
  const body = items
    .map(({ senderUsername, textContent, mediaPath, mediaType, channel, receivedDate, receivedTime }) =>
      `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(mediaPath || '')},${escapeCsv(mediaType || '')},${escapeCsv(channel || 'general')},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`
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
