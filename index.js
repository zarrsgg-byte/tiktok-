/**
 * ================================
 *  Global Bootstrap & Server Init
 * ================================
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const { PORT } = require('./config');

// ================================
// Global Error Handling
// ================================
process.on('uncaughtException', (err) => {
  console.error('[FATAL ERROR] Uncaught Exception:', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    cwd: process.cwd()
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL ERROR] Unhandled Rejection:', {
    reason,
    promise,
    timestamp: new Date().toISOString()
  });
});

// ================================
// Required folders & files
// ================================
const baseDirs = [
  'data',
  'data/backups',
  'plugins',
  'utils',
  'temp'
];

const requiredFiles = [
  'data/backups/users_backup.json',
  'data/backups/other_backup.json',
  'plugins/tiktok_video.js',
  'plugins/tiktok_photo.js',
  'utils/sleep.js',
  'utils/queue.js'
];

// ================================
// Ensure folders exist
// ================================
console.log('📁 Checking folders...');
baseDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✅ Created folder: ${dir}`);
  } else {
    console.log(`✔ Folder OK: ${dir}`);
  }
});

// ================================
// Ensure files exist (fix case only)
// ================================
console.log('\n📄 Checking files...');
requiredFiles.forEach(file => {
  const fullPath = path.join(__dirname, file);
  const dir = path.dirname(fullPath);
  const filename = path.basename(fullPath);

  if (fs.existsSync(fullPath)) {
    console.log(`✔ File OK: ${file}`);
    return;
  }

  // Fix case-sensitive issues
  if (fs.existsSync(dir)) {
    const found = fs.readdirSync(dir).find(f =>
      f.toLowerCase() === filename.toLowerCase()
    );

    if (found) {
      fs.renameSync(
        path.join(dir, found),
        fullPath
      );
      console.log(`🔧 Renamed: ${found} → ${filename}`);
      return;
    }
  }

  // Create missing file
  const defaultContent = file.endsWith('.json') ? '[]' : '';
  fs.writeFileSync(fullPath, defaultContent, 'utf-8');
  console.log(`➕ Created missing file: ${file}`);
});

console.log('\n🚀 Structure verified (no files deleted).');

// ================================
// Load main bot logic
// ================================
try {
  require('./main.js');
  console.log('🤖 Bot core loaded successfully.');
} catch (err) {
  console.error('❌ Failed to load main.js:', err);
}

// ================================
// Express Server
// ================================
const app = express();

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({
    response: {
      status: true,
      message: 'Bot Successfully Activated!',
      author: 'zamasuuuuuuu'
    }
  }, null, 2));
});

// ================================
// Smart Port Listener
// ================================
function listenOnPort(port) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${server.address().port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} in use. Switching to random port...`);
      listenOnPort(0); // OS chooses free port
    } else {
      console.error('❌ Server error:', err);
    }
  });
}

const START_PORT = process.env.PORT || PORT || 5000;
listenOnPort(START_PORT);