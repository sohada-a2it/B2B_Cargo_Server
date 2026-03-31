// app.js - WITH GOOGLE AUTH SUPPORT
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const route = require('./src/routes/api');
const quoteRoutes = require('./src/service/quoteTamplate');
const contactRoutes = require('./src/service/contactTamplate');
const authRoutes = require('./src/routes/authRoutes'); // NEW: Google auth routes
const app = express();

// ===================== MIDDLEWARE =====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration for frontend
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization','Cache-Control',  // ← ADD THIS
        'Pragma' ]
}));

// Logging middleware
app.use((req, res, next) => {
  console.log(`\n📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Auth header:', req.headers.authorization ? 'Present ✓' : 'Missing ✗');
  console.log('Body keys:', Object.keys(req.body).length > 0 ? Object.keys(req.body) : 'Empty');
  next();
});

// ===================== MONGOOSE CONNECT =====================
let mongoose;
try {
  mongoose = require('mongoose');
  console.log('Mongoose version:', mongoose.version);

  const url = process.env.DATABASE_URL || `mongodb+srv://a2itsohada_db_user:a2it-hrm@cluster0.18g6dhm.mongodb.net/B2B_Logistic?retryWrites=true&w=majority`;

  mongoose.connect(url)
    .then(async () => {
      console.log("✅ B2B_Logistic DB Connected");
      console.log(`📊 Database: ${mongoose.connection.name}`);
      console.log(`🌍 Host: ${mongoose.connection.host}`);
    })
    .catch(err => {
      console.log("⚠️ MongoDB Connection Warning:", err.message);
      console.log("⚠️ API will work but database operations will fail");
    });

} catch (error) {
  console.log("⚠️ Mongoose not available, running in test mode");
}

// ===================== ROUTES =====================
app.use("/api/v1/auth", authRoutes);    // NEW: Google auth routes
app.use('/api/v1', quoteRoutes);
app.use("/api/v1", contactRoutes);
app.use("/api/v1", route);

// ===================== HEALTH CHECK =====================
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: 'running',
    database: mongoose && mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ===================== 404 HANDLER =====================
app.use("*", (req, res) => {
  res.status(404).json({ 
    success: false,
    message: `Route ${req.originalUrl} not found` 
  });
});

// ===================== ERROR HANDLER =====================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

module.exports = app;