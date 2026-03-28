const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/userModel'); // আপনার User model path অনুযায়ী পরিবর্তন করুন

// ==================== GOOGLE LOGIN ====================
router.post('/google', async (req, res) => {
  try {
    const { idToken, email, name, photoURL, uid } = req.body;
    
    console.log('🔐 Google Login Request:', { email, uid });
    
    // Check if user exists
    let user = await User.findOne({ email });
    
    if (user) {
      // User exists - update googleId if not linked
      if (!user.googleId) {
        user.googleId = uid;
        user.avatar = photoURL || user.avatar;
        user.provider = 'google';
        await user.save();
        console.log('✅ Existing user updated with Google ID');
      }
    } else {
      // Create new user
      const nameParts = name ? name.split(' ') : ['', ''];
      
      user = new User({
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        email: email,
        googleId: uid,
        avatar: photoURL || '',
        role: 'customer',
        isActive: true,
        emailVerified: true,
        provider: 'google'
      });
      
      await user.save();
      console.log('✅ New user created via Google Login:', email);
    }
    
    // Generate JWT token for your app
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role,
        name: `${user.firstName} ${user.lastName}`.trim()
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Prepare user data
    const userData = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      phone: user.phone,
      provider: 'google'
    };
    
    console.log('✅ Google login successful for:', email);
    
    res.json({
      success: true,
      message: 'Google login successful',
      token,
      user: userData
    });
    
  } catch (error) {
    console.error('❌ Google Login Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Google login failed'
    });
  }
});

// ==================== VERIFY TOKEN ====================
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    });
    
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

module.exports = router;