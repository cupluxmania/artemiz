require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db'); // initializes db + schema

const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const boothRoutes = require('./routes/booths');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');
const exportRoutes = require('./routes/export');
const paymentRoutes = require('./routes/payments');
const inventoryRoutes = require('./routes/inventory');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/booths', boothRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/inventory', inventoryRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Hospital Expo System running at http://localhost:${PORT}`);
});
