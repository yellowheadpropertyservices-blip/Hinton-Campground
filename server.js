const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

// Email setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.privateemail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'info@hintoncampground.ca',
    pass: process.env.SMTP_PASS || ''
  }
});

// Pushover setup
const PUSHOVER_USER = process.env.PUSHOVER_USER || 'uengh7vcj44ziszrfhrcpbk196e5q1';
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN || 'a6bxtj1agx7a644mdga5uei9hne7i4';

function sendPushover(title, message) {
  const postData = JSON.stringify({
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    title: title,
    message: message,
    sound: 'cashregister',
    priority: 1
  });

  const options = {
    hostname: 'api.pushover.net',
    port: 443,
    path: '/1/messages.json',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('Pushover sent:', data));
  });
  req.on('error', (e) => console.error('Pushover error:', e.message));
  req.write(postData);
  req.end();
}

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
          amount,
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

  // API: Send booking notification
  if (req.method === 'POST' && req.url === '/send-booking-notification') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const d = JSON.parse(body);

        // PUSHOVER - instant phone notification
        sendPushover(
          '💰 New Booking: ' + d.confNum,
          'Site ' + d.site + '\n' +
          'Guest: ' + d.name + '\n' +
          'Phone: ' + d.phone + '\n' +
          'Dates: ' + d.checkin + ' → ' + d.checkout + ' (' + d.nights + ' nights)\n' +
          'Total: $' + d.total.toFixed(2) + ' CAD' +
          (d.firewood > 0 ? '\nFirewood: ' + d.firewood + ' bag(s)' : '') +
          (d.plate1 ? '\nVehicle: ' + d.plate1 : '')
        );

        // EMAIL to campground
        const campgroundEmail = {
          from: '"Hinton Campgrounds" <info@hintoncampground.ca>',
          to: 'info@hintoncampground.ca',
          subject: 'New Booking: ' + d.confNum + ' - Site ' + d.site,
          html: '<h2>New Campground Booking</h2>' +
            '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Confirmation:</td><td style="padding:6px 12px">' + d.confNum + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Site:</td><td style="padding:6px 12px">' + d.site + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Guest:</td><td style="padding:6px 12px">' + d.name + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Email:</td><td style="padding:6px 12px">' + d.email + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Phone:</td><td style="padding:6px 12px">' + d.phone + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Check-in:</td><td style="padding:6px 12px">' + d.checkin + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Check-out:</td><td style="padding:6px 12px">' + d.checkout + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Nights:</td><td style="padding:6px 12px">' + d.nights + '</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Total:</td><td style="padding:6px 12px">$' + d.total.toFixed(2) + ' CAD</td></tr>' +
            '<tr><td style="padding:6px 12px;font-weight:bold">Vehicles:</td><td style="padding:6px 12px">' + d.plate1 + (d.plate2 ? ', ' + d.plate2 : '') + (d.plate3 ? ', ' + d.plate3 : '') + '</td></tr>' +
            (d.firewood > 0 ? '<tr><td style="padding:6px 12px;font-weight:bold">Firewood:</td><td style="padding:6px 12px">' + d.firewood + ' bag(s)</td></tr>' : '') +
            '</table>'
        };

        // EMAIL to guest
        const guestEmail = {
          from: '"Hinton Campgrounds" <info@hintoncampground.ca>',
          to: d.email,
          subject: 'Booking Confirmed: ' + d.confNum + ' - Hinton Campgrounds',
          html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
            '<h2 style="color:#104155">Booking Confirmed!</h2>' +
            '<p>Hi ' + d.name + ',</p>' +
            '<p>Your campsite has been booked. Here are your details:</p>' +
            '<table style="border-collapse:collapse;font-size:14px;width:100%;margin:16px 0">' +
            '<tr style="background:#f2f2f2"><td style="padding:10px 12px;font-weight:bold">Confirmation #</td><td style="padding:10px 12px">' + d.confNum + '</td></tr>' +
            '<tr><td style="padding:10px 12px;font-weight:bold">Site</td><td style="padding:10px 12px">' + d.site + '</td></tr>' +
            '<tr style="background:#f2f2f2"><td style="padding:10px 12px;font-weight:bold">Check-in</td><td style="padding:10px 12px">' + d.checkin + ' at 2:00 PM</td></tr>' +
            '<tr><td style="padding:10px 12px;font-weight:bold">Check-out</td><td style="padding:10px 12px">' + d.checkout + ' at 11:00 AM</td></tr>' +
            '<tr style="background:#f2f2f2"><td style="padding:10px 12px;font-weight:bold">Total Paid</td><td style="padding:10px 12px">$' + d.total.toFixed(2) + ' CAD</td></tr>' +
            '</table>' +
            '<p>Please save your confirmation number for check-in.</p>' +
            '<p>If you need to make changes, contact us at <strong>780-315-9196</strong> or reply to this email.</p>' +
            '<p style="margin-top:24px;color:#888;font-size:12px">Hinton Campgrounds<br>Hinton, Alberta<br>hintoncampground.ca</p>' +
            '</div>'
        };

        // Send emails (don't block on failure)
        try {
          await transporter.sendMail(campgroundEmail);
          console.log('Campground email sent for ' + d.confNum);
        } catch(e) { console.error('Campground email failed:', e.message); }

        try {
          await transporter.sendMail(guestEmail);
          console.log('Guest email sent to ' + d.email);
        } catch(e) { console.error('Guest email failed:', e.message); }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('Notification error:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
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
