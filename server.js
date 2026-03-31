const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const historyCsvPath = path.join(__dirname, 'history.csv');

ensureCsvFile();
const submissions = loadCsvSubmissions();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', (req, res) => {
  const textContent = (req.body.text || '').trim();
  if (!textContent) {
    return res.status(400).send('<p>Text cannot be empty.</p><p><a href="/">Go back</a></p>');
  }

  const now = new Date();
  const receivedDate = now.toISOString().slice(0, 10);
  const receivedTime = now.toISOString().slice(11, 19);
  const senderUsername = (req.body.senderUsername || '').trim();

  const submission = { textContent, receivedTime, receivedDate, senderUsername };
  submissions.push(submission);

  try {
    appendToCsv(submission);
  } catch (error) {
    console.error('Failed to write history.csv:', error);
    return res.status(500).send('<p>Server error writing history.</p><p><a href="/">Go back</a></p>');
  }

  res.send(
    '<p>Thank you! Your text was received.</p>' +
      '<p><a href="/">Upload more text</a></p>' +
      '<p><a href="/submissions">View submissions</a></p>'
  );
});

app.get('/submissions', (req, res) => {
  const csvSubmissions = loadCsvSubmissions();
  const rows = csvSubmissions
    .map(
      (item, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(item.senderUsername)}</td><td><pre>${escapeHtml(item.textContent)}</pre></td><td>${escapeHtml(item.receivedDate)}</td><td>${escapeHtml(item.receivedTime)}</td></tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Submissions</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
      a { color: #0066cc; }
    </style>
  </head>
  <body>
    <h1>Received submissions</h1>
    <p><a href="/">Back to upload page</a></p>
    <table>
      <thead>
        <tr><th>#</th><th>Sender Username</th><th>Text</th><th>Date</th><th>Time</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5">No submissions yet.</td></tr>'}
      </tbody>
    </table>
  </body>
</html>`);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
