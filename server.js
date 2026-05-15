const http = require('http');
const fs = require('fs');
const path = require('path');

// Stripe setup - uses environment variable
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: Create Payment Intent
  if (req.method === 'POST' && req.url === '/create-payment-intent') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const amount = Math.round(data.amount * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'cad',
          metadata: {
            site: data.site || '',
            guest_name: data.name || '',
            guest_email: data.email || '',
            guest_phone: data.phone || '',
            checkin: data.checkin || '',
            checkout: data.checkout || '',
            plate1: data.plate1 || '',
            plate2: data.plate2 || '',
            plate3: data.plate3 || '',
            firewood: String(data.firewood || 0),
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clientSecret: paymentIntent.client_secret }));
      } catch (err) {
        console.error('Stripe error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files from public/
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    // Serve index.html for any unmatched route (SPA fallback)
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e2) {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(PORT, () => {
  console.log('Hinton Campgrounds running on port ' + PORT);
});
