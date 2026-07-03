const express = require('express');
const http = require('http');
const https = require('https');
const app = express();
const port = 5000;

app.get('/', (req, res) => res.send('AFK Bot is running!'));

function selfPing() {
  const url = process.env.REPLIT_DEV_DOMAIN
    ? 'https://' + process.env.REPLIT_DEV_DOMAIN + '/'
    : 'http://localhost:' + port + '/';

  const client = url.startsWith('https') ? https : http;

  client.get(url, (res) => {
    console.log('Self-ping OK:', res.statusCode);
  }).on('error', (e) => {
    console.log('Self-ping hata:', e.message);
  });
}

function keep_alive() {
  app.listen(port, '0.0.0.0', () => {
    console.log(`AFK bot web server listening on port ${port}`);
    // Her 4 dakikada bir kendini pingler — Replit uyumaz
    setInterval(selfPing, 90 * 1000);
  });
}

module.exports = { keep_alive };
