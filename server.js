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
    device: 'note14',
    title: title,
    message: message,
    sound: 'cashregister',
    priority: 1
  });
  const options = {
    hostname: 'api.pushover.net', port: 443, path: '/1/messages.json', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
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

// ========== BOOKING DATABASE ==========
const DB_FILE = path.join(__dirname, 'bookings.json');

function loadBookings() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) { console.error('Error loading bookings:', e.message); }
  return [];
}

function saveBookings(bookings) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(bookings, null, 2));
  } catch(e) { console.error('Error saving bookings:', e.message); }
}

function isDateOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function getBookedSites(checkin, checkout, campground) {
  const bookings = loadBookings();
  const booked = [];
  bookings.forEach(function(b) {
    if (b.campground === campground && isDateOverlap(checkin, checkout, b.checkin, b.checkout)) {
      booked.push(b.site);
    }
  });
  return booked;
}
// ========== END DATABASE ==========

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Parse URL
  const url = new URL(req.url, 'http://localhost');

  // API: Check availability
  if (req.method === 'GET' && url.pathname === '/api/availability') {
    const checkin = url.searchParams.get('checkin');
    const checkout = url.searchParams.get('checkout');
    const campground = url.searchParams.get('campground') || 'hinton';

    if (!checkin || !checkout) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bookedSites: [] }));
      return;
    }

    const booked = getBookedSites(checkin, checkout, campground);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bookedSites: booked }));
    return;
  }

  // API: Get all bookings (admin)
  if (req.method === 'GET' && url.pathname === '/api/bookings') {
    const bookings = loadBookings();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bookings: bookings }));
    return;
  }

  // API: Create Payment Intent
  if (req.method === 'POST' && url.pathname === '/create-payment-intent') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const amount = Math.round(data.amount * 100);

        // Check availability before creating payment
        const campground = data.campground || 'hinton';
        const booked = getBookedSites(data.checkin, data.checkout, campground);
        if (booked.includes(String(data.site)) || booked.includes(Number(data.site))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sorry, this site is already booked for those dates. Please choose different dates or another site.' }));
          return;
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount, currency: 'cad',
          metadata: {
            site: data.site || '', campground: campground,
            guest_name: data.name || '', guest_email: data.email || '',
            guest_phone: data.phone || '', checkin: data.checkin || '',
            checkout: data.checkout || '', plate1: data.plate1 || '',
            plate2: data.plate2 || '', plate3: data.plate3 || '',
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

  // API: Confirm booking (save to database after payment succeeds)
  if (req.method === 'POST' && url.pathname === '/api/confirm-booking') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const d = JSON.parse(body);
        const bookings = loadBookings();

        // Double-check availability
        const campground = d.campground || 'hinton';
        const booked = getBookedSites(d.checkin, d.checkout, campground);
        if (booked.includes(String(d.site)) || booked.includes(Number(d.site))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Site already booked for these dates.' }));
          return;
        }

        // Save booking
        const booking = {
          confNum: d.confNum,
          campground: campground,
          site: d.site,
          name: d.name,
          email: d.email,
          phone: d.phone,
          checkin: d.checkin,
          checkout: d.checkout,
          nights: d.nights,
          total: d.total,
          plate1: d.plate1 || '',
          plate2: d.plate2 || '',
          plate3: d.plate3 || '',
          firewood: d.firewood || 0,
          rateType: d.rateType || 'nightly',
          paymentId: d.paymentId || '',
          paymentStatus: d.paymentStatus || 'paid',
          notes: d.notes || '',
          bookedAt: new Date().toISOString()
        };

        bookings.push(booking);
        saveBookings(bookings);
        console.log('Booking saved: ' + d.confNum + ' - Site ' + d.site);

        // Send Pushover notification
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

        // Send emails
        try {
          await transporter.sendMail({
            from: '"Hinton Campgrounds" <info@hintoncampground.ca>',
            to: 'info@hintoncampground.ca',
            subject: 'New Booking: ' + d.confNum + ' - Site ' + d.site,
            html: '<h2>New Campground Booking</h2><table style="border-collapse:collapse;font-family:Arial;font-size:14px">' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Confirmation:</td><td>' + d.confNum + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Site:</td><td>' + d.site + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Guest:</td><td>' + d.name + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Email:</td><td>' + d.email + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Phone:</td><td>' + d.phone + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Check-in:</td><td>' + d.checkin + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Check-out:</td><td>' + d.checkout + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Total:</td><td>$' + d.total.toFixed(2) + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:bold">Vehicles:</td><td>' + d.plate1 + (d.plate2 ? ', '+d.plate2 : '') + '</td></tr>' +
              '</table>'
          });
        } catch(e) { console.error('Campground email failed:', e.message); }

        try {
          await transporter.sendMail({
            from: '"Hinton Campgrounds" <info@hintoncampground.ca>',
            to: d.email,
            subject: 'Booking Confirmed: ' + d.confNum + ' - Hinton Campgrounds',
            html: '<div style="font-family:Arial;max-width:600px;margin:0 auto"><h2 style="color:#104155">Booking Confirmed!</h2>' +
              '<p>Hi ' + d.name + ',</p><p>Your campsite has been booked:</p>' +
              '<table style="border-collapse:collapse;font-size:14px;width:100%;margin:16px 0">' +
              '<tr style="background:#f2f2f2"><td style="padding:10px 12px;font-weight:bold">Confirmation</td><td style="padding:10px 12px">' + d.confNum + '</td></tr>' +
              '<tr><td style="padding:10px 12px;font-weight:bold">Site</td><td style="padding:10px 12px">' + d.site + '</td></tr>' +
              '<tr style="background:#f2f2f2"><td style="padding:10px 12px;font-weight:bold">Check-in</td><td style="padding:10px 12px">' + d.checkin + ' at 2:00 PM</td></tr>' +
              '<tr><td style="padding:10px 12px;font-weight:bold">Check-out</td><td style="padding:10px 12px">' + d.checkout + ' at 11:00 AM</td></tr>' +
              '<tr style="background:#f2f2f2"><td style="padding:10px 12px;font-weight:bold">Total</td><td style="padding:10px 12px">$' + d.total.toFixed(2) + ' CAD</td></tr>' +
              '</table><p>Contact us at <strong>780-315-9196</strong> with any questions.</p>' +
              '<p style="color:#888;font-size:12px;margin-top:24px">Hinton Campgrounds &middot; hintoncampground.ca</p></div>'
          });
        } catch(e) { console.error('Guest email failed:', e.message); }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('Confirm booking error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }


  // API: Delete/cancel a booking
  if (req.method === 'POST' && url.pathname === '/api/delete-booking') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const d = JSON.parse(body);
        const bookings = loadBookings();
        const idx = bookings.findIndex(b => b.confNum === d.confNum);
        
        if (idx === -1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Booking not found' }));
          return;
        }
        
        const cancelled = bookings[idx];
        bookings.splice(idx, 1);
        saveBookings(bookings);
        
        console.log('Booking cancelled: ' + d.confNum);
        
        // Notify via Pushover
        sendPushover(
          '❌ Booking Cancelled: ' + d.confNum,
          'Site ' + cancelled.site + '\n' +
          'Guest: ' + cancelled.name + '\n' +
          'Dates: ' + cancelled.checkin + ' → ' + cancelled.checkout
        );
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('Delete error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
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
      const h = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(h);
    } catch (e2) { res.writeHead(404); res.end('Not found'); }
  }
});

server.listen(PORT, () => { console.log('Hinton Campgrounds running on port ' + PORT); });
