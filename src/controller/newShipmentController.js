const NewShipment = require('../models/newShipmentModel');
const { sendEmail, getSenderEmailTemplate, getReceiverEmailTemplate, getAdminEmailTemplate } = require('../service/manualShipmentMail');
const { generateInvoicePDF, saveInvoiceRecord } = require('../service/manualShipmentInvoice');
const { generateInvoiceFromShipment } = require('../utils/manualInvoiceGenerator');
const Booking = require('../models/bookingModel');
// ================== HELPER FUNCTIONS ==================

// Generate shipment number
const generateShipmentNumber = async () => {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');

    const count = await NewShipment.countDocuments({
        shipmentNumber: new RegExp(`^SHP-${year}${month}`)
    });

    return `SHP-${year}${month}-${(count + 1).toString().padStart(5, '0')}`;
};


// Generate tracking number (safe + unique)
const generateTrackingNumber = async () => {
    const prefix = 'CLG';
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numbers = '23456789';

    let trackingNumber;
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
        trackingNumber = prefix;

        // 2 letters
        for (let i = 0; i < 2; i++) {
            trackingNumber += letters[Math.floor(Math.random() * letters.length)];
        }

        // 4 numbers
        for (let i = 0; i < 4; i++) {
            trackingNumber += numbers[Math.floor(Math.random() * numbers.length)];
        }

        // 2 letters
        for (let i = 0; i < 2; i++) {
            trackingNumber += letters[Math.floor(Math.random() * letters.length)];
        }

        const existing = await NewShipment.findOne({ trackingNumber });
        exists = !!existing;
        attempts++;
    }

    return trackingNumber || `CLG${Date.now().toString().slice(-8)}`;
};



// ================== CREATE SHIPMENT ================== 

// createShipment ফাংশনটি আপডেট করুন
exports.createShipment = async (req, res) => {
    try {
        const bookingData = req.body;
        console.log('📦 Creating shipment:', bookingData);

        // Generate tracking and shipment numbers
        const trackingNumber = bookingData.trackingNumber || await generateTrackingNumber();
        const shipmentNumber = bookingData.shipmentNumber || await generateShipmentNumber();

        // Calculate total packages and weight
        const packageDetails = (bookingData.shipmentDetails?.packageDetails || bookingData.packages || []);
        const totalPackages = packageDetails.reduce((sum, pkg) => sum + (pkg.quantity || 1), 0);
        const totalWeight = packageDetails.reduce((sum, pkg) => sum + (pkg.weight || 0), 0);

        // Timeline entries
        const timelineEntries = (bookingData.timeline || []).map(entry => ({
            status: entry.status,
            description: entry.description || '',
            location: entry.location || '',
            updatedBy: entry.updatedBy || bookingData.createdBy,
            timestamp: entry.timestamp || new Date(),
            metadata: entry.metadata || {}
        }));

        if (timelineEntries.length === 0) {
            timelineEntries.push({
                status: bookingData.status || 'booking_requested',
                description: 'Shipment created',
                location: bookingData.shipmentDetails?.origin || '',
                updatedBy: bookingData.createdBy,
                timestamp: new Date()
            });
        }

        // Create shipment
        const shipment = await NewShipment.create({
            shipmentNumber,
            trackingNumber,
            bookingId: null,
            customerId: bookingData.customer || null,
            customerInfo: {
                name: bookingData.sender?.name,
                email: bookingData.sender?.email,
                phone: bookingData.sender?.phone,
                companyName: bookingData.sender?.companyName
            },
            shipmentClassification: bookingData.shipmentClassification,
            serviceType: bookingData.serviceType || 'standard',
            shipmentDetails: {
                origin: bookingData.shipmentDetails?.origin,
                destination: bookingData.shipmentDetails?.destination,
                shippingMode: bookingData.shipmentDetails?.shippingMode || 'DDU',
                totalPackages: totalPackages,
                totalWeight: totalWeight,
                packageDetails: packageDetails.map(pkg => ({
                    description: pkg.description,
                    packagingType: pkg.packagingType || 'carton',
                    quantity: pkg.quantity || 1,
                    weight: pkg.weight || 0,
                    volume: pkg.volume || 0,
                    dimensions: pkg.dimensions || {},
                    productCategory: pkg.productCategory || 'Others',
                    hsCode: pkg.hsCode || '',
                    value: pkg.value || { amount: 0, currency: 'USD' },
                    hazardous: pkg.hazardous || false,
                    temperatureControlled: pkg.temperatureControlled || { required: false }
                })),
                specialInstructions: bookingData.shipmentDetails?.specialInstructions || '',
                referenceNumber: bookingData.shipmentDetails?.referenceNumber || ''
            },
            dates: {
                estimatedDeparture: bookingData.dates?.estimatedDeparture,
                estimatedArrival: bookingData.dates?.estimatedArrival
            },
            quotedPrice: {
                amount: bookingData.quotedPrice?.amount || 0,
                currency: bookingData.quotedPrice?.currency || 'USD',
                breakdown: bookingData.quotedPrice?.breakdown || {},
                notes: bookingData.quotedPrice?.notes || '',
                quotedBy: bookingData.createdBy,
                quotedAt: new Date()
            },
            pricingStatus: bookingData.pricingStatus || 'quoted',
            payment: {
                mode: bookingData.payment?.mode || 'bank_transfer',
                currency: bookingData.payment?.currency || 'USD',
                amount: bookingData.quotedPrice?.amount || 0,
                status: 'pending'
            },
            sender: bookingData.sender,
            receiver: bookingData.receiver,
            courier: {
                company: bookingData.courier?.company || 'Cargo Logistics Group',
                serviceType: bookingData.serviceType
            },
            status: bookingData.status || 'booking_requested',
            shipmentStatus: bookingData.shipmentStatus || 'pending',
            currentMilestone: timelineEntries[timelineEntries.length - 1]?.status,
            timeline: timelineEntries,
            createdBy: bookingData.createdBy,
            updatedBy: bookingData.createdBy
        });

        console.log('✅ Shipment created:', shipment._id);

        // ========== 🔥 GENERATE INVOICE FOR SHIPMENT ==========
        let invoice = null;
        try {
            invoice = await generateInvoiceFromShipment(shipment);
            if (invoice) {
                console.log(`✅ Invoice created: ${invoice.invoiceNumber}`);
                
                // Update shipment with invoice reference (optional)
                await NewShipment.findByIdAndUpdate(shipment._id, {
                    $set: { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber }
                });
            } else {
                console.log('⚠️ Invoice generation failed but shipment was created');
            }
        } catch (invoiceError) {
            console.error('❌ Invoice generation error:', invoiceError);
            // Don't fail the shipment creation if invoice fails
        }

        // Send emails in background
        setImmediate(() => {
            sendEmailsInBackground(shipment, invoice).catch(err => {
                console.error('❌ Background email error:', err);
            });
        });

        // Return response with invoice data
        return res.status(201).json({
            success: true,
            message: 'Shipment created successfully with invoice',
            data: {
                shipment,
                invoice: invoice || null
            }
        });

    } catch (error) {
        console.error('❌ ERROR:', error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Duplicate tracking or shipment number',
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to create shipment',
            error: error.message
        });
    }
};

// ==================== GET SHIPMENT WITH INVOICE ====================
exports.getShipmentWithInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        
        const shipment = await NewShipment.findById(id);
        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        const invoice = await Invoice.findOne({ shipmentId: shipment._id });

        return res.status(200).json({
            success: true,
            data: {
                shipment,
                invoice: invoice || null
            }
        });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch shipment',
            error: error.message
        });
    }
};

// ==================== REGENERATE INVOICE ====================
exports.regenerateInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        
        const shipment = await NewShipment.findById(id);
        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        // Delete old invoice if exists
        await Invoice.deleteOne({ shipmentId: shipment._id });

        // Generate new invoice
        const invoice = await generateInvoiceFromShipment(shipment);

        // Update shipment with new invoice reference
        await NewShipment.findByIdAndUpdate(shipment._id, {
            $set: { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber }
        });

        return res.status(200).json({
            success: true,
            message: 'Invoice regenerated successfully',
            data: invoice
        });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to regenerate invoice',
            error: error.message
        });
    }
};

// এই ফাংশনটি createShipment এর বাইরে যোগ করুন (একদম নিচে)
async function sendEmailsInBackground(shipment) {
    console.log('📧 Starting background emails for:', shipment._id);
    
    try {
        // 1. Sender কে ইমেইল
        if (shipment.sender?.email) {
            await sendEmail(
                shipment.sender.email,
                `Shipment Created - ${shipment.shipmentNumber}`,
                getSenderEmailTemplate(shipment)
            );
            console.log(`✅ Email to sender: ${shipment.sender.email}`);
        }

        // 2. Receiver কে ইমেইল
        if (shipment.receiver?.email) {
            await sendEmail(
                shipment.receiver.email,
                `Your Parcel is On The Way - ${shipment.shipmentNumber}`,
                getReceiverEmailTemplate(shipment)
            );
            console.log(`✅ Email to receiver: ${shipment.receiver.email}`);
        }

        // 3. Admin কে ইমেইল
        const adminEmails = (process.env.ADMIN_EMAILS || 'admin@cargologistics.com').split(',');
        for (const adminEmail of adminEmails) {
            if (adminEmail.trim()) {
                await sendEmail(
                    adminEmail.trim(),
                    `New Shipment Created - ${shipment.shipmentNumber}`,
                    getAdminEmailTemplate(shipment)
                );
                console.log(`✅ Email to admin: ${adminEmail}`);
            }
        }

        // 4. Invoice generate এবং পাঠান
        if (shipment.quotedPrice?.amount > 0 && shipment.sender?.email) {
            const invoice = await generateInvoicePDF(shipment);
            await sendEmail(
                shipment.sender.email,
                `Invoice - ${shipment.shipmentNumber}`,
                `<h2>Invoice Generated</h2><p>Amount: ${shipment.quotedPrice?.currency || 'USD'} ${shipment.quotedPrice?.amount || 0}</p>`,
                [{ filename: invoice.filename, path: invoice.path }]
            );
            console.log(`✅ Invoice sent to: ${shipment.sender.email}`);
            
            // Save invoice info
            await NewShipment.findByIdAndUpdate(shipment._id, {
                $set: {
                    'invoice.generated': true,
                    'invoice.number': invoice.invoiceNumber,
                    'invoice.path': invoice.path,
                    'invoice.generatedAt': new Date()
                }
            });
        }
        
        console.log('✅ All emails processed for:', shipment._id);
    } catch (error) {
        console.error('❌ Background email failed:', error);
    }
}
// GET ALL SHIPMENTS - বুকিং কন্ট্রোলারের মতো করে
exports.getAllNewShipments = async (req, res) => {
  try {
    console.log('📥 getAllShipments called with query:', req.query);
    
    const { page = 1, limit = 20, status, mode, search } = req.query;
    
    // Build filter - বুকিংয়ের মতো
    let filter = {};
    if (status) filter.status = status;
    if (mode) filter['shipmentDetails.shipmentType'] = mode;
    
    if (search) {
      filter.$or = [
        { shipmentNumber: new RegExp(search, 'i') },
        { trackingNumber: new RegExp(search, 'i') }
      ];
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    
    // Get shipments with population - বুকিংয়ের মতো
    const shipments = await NewShipment.find(filter)
      .populate('customerId', 'firstName lastName email companyName phone') 
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);
    
    // Get total count
    const total = await NewShipment.countDocuments(filter);
    
    // Calculate summary stats - বুকিংয়ের মতো
    const summary = {
      total: shipments.length,
      active: shipments.filter(s => !['delivered', 'cancelled'].includes(s.status)).length,
      delivered: shipments.filter(s => s.status === 'delivered').length,
      cancelled: shipments.filter(s => s.status === 'cancelled').length,
      pending: shipments.filter(s => s.status === 'pending').length,
      inTransit: shipments.filter(s => s.status === 'in_transit').length
    };
    
    // Response format - বুকিংয়ের মতো
    res.status(200).json({
      success: true,
      data: shipments,
      summary: summary,
      pagination: {
        total,
        page: parseInt(page),
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      },
      message: 'Shipments fetched successfully'
    });
    
  } catch (error) {
    console.error('❌ Error in getAllShipments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 
 
exports.updateShipmentTrackingNumber = async (req, res) => {
    try {
        const { id } = req.params;
        const { trackingNumber } = req.body;

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                message: 'Tracking number is required'
            });
        }

        console.log('📦 Updating tracking number for shipment:', id);
        console.log('🔢 New tracking number:', trackingNumber);

        // 1️⃣ Shipment আপডেট করুন
        const shipment = await NewShipment.findByIdAndUpdate(
            id,
            { 
                trackingNumber: trackingNumber,
                updatedBy: req.user?._id 
            },
            { new: true }
        );

        if (!shipment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Shipment not found' 
            });
        }

        console.log('✅ Shipment updated:', shipment.shipmentNumber);

        // 2️⃣ 🔴 Booking-ও আপডেট করুন (এটাই missing ছিল)
        let bookingUpdated = false;
        
        // উপায় 1: shipment.bookingId দিয়ে
        if (shipment.bookingId) {
            const booking = await Booking.findByIdAndUpdate(
                shipment.bookingId,
                { 
                    trackingNumber: trackingNumber,
                    'shipmentDetails.trackingNumber': trackingNumber 
                },
                { new: true }
            );
            if (booking) {
                bookingUpdated = true;
                console.log('✅ Booking updated via bookingId:', booking.bookingNumber);
            }
        }
        
        // উপায় 2: bookingNumber দিয়ে (যদি উপায় 1 কাজ না করে)
        if (!bookingUpdated && shipment.bookingNumber) {
            const booking = await Booking.findOneAndUpdate(
                { bookingNumber: shipment.bookingNumber },
                { 
                    trackingNumber: trackingNumber,
                    'shipmentDetails.trackingNumber': trackingNumber 
                },
                { new: true }
            );
            if (booking) {
                bookingUpdated = true;
                console.log('✅ Booking updated via bookingNumber:', booking.bookingNumber);
            }
        }
        
        // উপায় 3: shipmentNumber দিয়ে (যদি উপায় 1-2 কাজ না করে)
        if (!bookingUpdated && shipment.shipmentNumber) {
            const booking = await Booking.findOneAndUpdate(
                { 'shipmentDetails.shipmentNumber': shipment.shipmentNumber },
                { 
                    trackingNumber: trackingNumber,
                    'shipmentDetails.trackingNumber': trackingNumber 
                },
                { new: true }
            );
            if (booking) {
                bookingUpdated = true;
                console.log('✅ Booking updated via shipmentNumber:', booking.bookingNumber);
            }
        }

        if (!bookingUpdated) {
            console.log('⚠️ Warning: No booking found to update tracking number');
        }

        res.status(200).json({
            success: true,
            message: '✅ Tracking number updated successfully in both Shipment and Booking',
            data: {
                shipment: shipment,
                bookingUpdated: bookingUpdated
            }
        });

    } catch (error) {
        console.error('❌ Update tracking error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};
// controllers/newShipmentController.js - getMyShipments ফাংশন

exports.getMyShipments = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc', search, status, startDate, endDate } = req.query;

    console.log('🔍 getMyShipments called with query:', req.query);
    console.log('🔍 User ID:', req.user?._id);
    console.log('🔍 User email:', req.user?.email);

    // Build query - search by multiple conditions
    let query = {
      $or: [
        { customerId: req.user._id },
        { 'sender.email': req.user.email },
        { 'receiver.email': req.user.email },
        { 'customerInfo.email': req.user.email }
      ]
    };

    // Add search filter
    if (search) {
      query.$and = [
        {
          $or: [
            { shipmentNumber: { $regex: search, $options: 'i' } },
            { trackingNumber: { $regex: search, $options: 'i' } }
          ]
        }
      ];
    }

    // Add status filter
    if (status && status !== 'all') {
      query.shipmentStatus = status;
    }

    // Add date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    console.log('🔍 MongoDB Query:', JSON.stringify(query, null, 2));
    
    // Count total documents
    const total = await NewShipment.countDocuments(query);
    console.log('📊 Total count:', total);
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    
    // Execute query with pagination
    const shipments = await NewShipment.find(query)
      .sort(sort)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate('customerId', 'firstName lastName email phone companyName');
    
    console.log(`✅ Found ${shipments.length} shipments for user: ${req.user.email}`);
    
    // Calculate summary
    const summary = await getShipmentSummaryForCustomer(req.user._id);
    
    // Return response
    res.status(200).json({
      success: true,
      data: shipments,
      summary: summary,
      pagination: {
        total: total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      message: 'Shipments fetched successfully'
    });
    
  } catch (error) {
    console.error('❌ Get my shipments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shipments',
      error: error.message
    });
  }
};

// @desc    Get single shipment by ID for customer
// @route   GET /api/v1/shipments/my-shipments/:id
// @access  Private/Customer
exports.getMyShipmentById = async (req, res) => {
  try {
    const shipment = await NewShipment.findOne({
      _id: req.params.id,
      customerId: req.user._id
    }).populate('customerId', 'firstName lastName email phone companyName');
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: shipment,
      message: 'Shipment fetched successfully'
    });
  } catch (error) {
    console.error('Get my shipment by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shipment',
      error: error.message
    });
  }
};

// @desc    Get shipment tracking info for customer
// @route   GET /api/v1/shipments/my-shipments/:id/tracking
// @access  Private/Customer
exports.getMyShipmentTracking = async (req, res) => {
  try {
    const shipment = await NewShipment.findOne({
      _id: req.params.id,
      customerId: req.user._id
    });
    
    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }
    
    const trackingInfo = {
      trackingNumber: shipment.trackingNumber,
      status: shipment.shipmentStatus,
      currentLocation: shipment.currentLocation,
      estimatedDelivery: shipment.dates?.estimatedArrival,
      timeline: shipment.timeline || [],
      progress: getShipmentProgress(shipment.shipmentStatus)
    };
    
    res.status(200).json({
      success: true,
      data: trackingInfo,
      message: 'Tracking info fetched successfully'
    });
  } catch (error) {
    console.error('Get tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tracking info',
      error: error.message
    });
  }
};

// @desc    Get shipment summary for customer
// @route   GET /api/v1/shipments/my-shipments/summary
// @access  Private/Customer
exports.getMyShipmentSummary = async (req, res) => {
  try {
    const summary = await getShipmentSummaryForCustomer(req.user._id);
    
    res.status(200).json({
      success: true,
      data: summary,
      message: 'Summary fetched successfully'
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch summary',
      error: error.message
    });
  }
};

// Helper function to get shipment summary for a customer
async function getShipmentSummaryForCustomer(customerId) {
  const stats = await NewShipment.aggregate([
    { $match: { customerId: customerId } },
    {
      $group: {
        _id: '$shipmentStatus',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const summary = {
    total: 0,
    active: 0,
    delivered: 0,
    cancelled: 0,
    pending: 0,
    inTransit: 0,
    processing: 0
  };
  
  stats.forEach(stat => {
    summary.total += stat.count;
    
    switch (stat._id) {
      case 'delivered':
      case 'completed':
        summary.delivered += stat.count;
        break;
      case 'cancelled':
      case 'returned':
        summary.cancelled += stat.count;
        break;
      case 'pending':
      case 'booking_requested':
        summary.pending += stat.count;
        break;
      case 'in_transit':
      case 'departed_port_of_origin':
      case 'arrived_at_destination_port':
        summary.inTransit += stat.count;
        break;
      default:
        summary.active += stat.count;
        summary.processing += stat.count;
    }
  });
  
  summary.active = summary.total - (summary.delivered + summary.cancelled);
  
  return summary;
}

function getShipmentProgress(status) {
  const progressMap = {
    'booking_requested': 5,
    'pending': 10,
    'received_at_warehouse': 20,
    'picked_up_from_warehouse': 30,
    'departed_port_of_origin': 50,
    'in_transit': 60,
    'arrived_at_destination_port': 70,
    'customs_clearance': 80,
    'out_for_delivery': 90,
    'delivered': 100,
    'completed': 100,
    'cancelled': 0
  };
  return progressMap[status] || 0;
} 

// Define status sequence
const STATUS_SEQUENCE = [
  'booking_requested',
  'pending',
  'received_at_warehouse',
  'picked_up_from_warehouse',
  'departed_port_of_origin',
  'in_transit',
  'arrived_at_destination_port',
  'under_customs_cleared',
  'customs_clearance',
  'out_for_delivery',
  'delivered'
];

// Helper function to validate status transition
const isValidStatusTransition = (currentStatus, newStatus) => {
  const currentIndex = STATUS_SEQUENCE.indexOf(currentStatus);
  const newIndex = STATUS_SEQUENCE.indexOf(newStatus);
  
  if (currentIndex === -1) {
    return newStatus === 'cancelled';
  }
  
  if (newIndex > currentIndex) {
    return true;
  }
  
  if (newStatus === 'cancelled' && currentStatus !== 'delivered') {
    return true;
  }
  
  return false;
};

// Update shipment status
// In newShipmentController.js

exports.updateShipmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, resumeTo, updateDateTime } = req.body;
    const userId = req.user?._id || req.user?.id || 'system';

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Define status sequence
    const STATUS_SEQUENCE = [
      'booking_requested',
      'pending',
      'received_at_warehouse',
      'picked_up_from_warehouse',
      'departed_port_of_origin',
      'in_transit',
      'arrived_at_destination_port',
      'under_customs_cleared',
      'customs_clearance',
      'out_for_delivery',
      'delivered'
    ];

    // Validation function - UPDATED to allow on_hold
    const isValidStatusTransition = (currentStatus, newStatus) => {
      // Allow on_hold from any status except delivered
      if (newStatus === 'on_hold' && currentStatus !== 'delivered') {
        return true;
      }
      
      // Allow cancelled from any status except delivered
      if (newStatus === 'cancelled' && currentStatus !== 'delivered') {
        return true;
      }
      
      // Allow resume from on_hold
      if (currentStatus === 'on_hold' && newStatus !== 'cancelled') {
        return true;
      }
      
      const currentIndex = STATUS_SEQUENCE.indexOf(currentStatus);
      const newIndex = STATUS_SEQUENCE.indexOf(newStatus);
      
      // Normal forward progression
      if (currentIndex !== -1 && newIndex > currentIndex) {
        return true;
      }
      
      return false;
    };

    // Function to get allowed next statuses - UPDATED
    const getAllowedNextStatuses = (currentStatus) => {
      const currentIndex = STATUS_SEQUENCE.indexOf(currentStatus);
      
      if (currentStatus === 'delivered') {
        return [];
      }
      
      const nextStatuses = [];
      
      // Add on_hold for any non-delivered status
      if (currentStatus !== 'delivered' && currentStatus !== 'on_hold') {
        nextStatuses.push('on_hold');
      }
      
      // Add cancelled for any non-delivered status
      if (currentStatus !== 'delivered') {
        nextStatuses.push('cancelled');
      }
      
      // Add forward progression statuses
      if (currentIndex !== -1) {
        const forwardStatuses = STATUS_SEQUENCE.slice(currentIndex + 1);
        nextStatuses.push(...forwardStatuses);
      }
      
      return nextStatuses;
    };

    // Find the shipment
    const existingShipment = await NewShipment.findById(id);
    
    if (!existingShipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }

    const currentStatus = existingShipment.shipmentStatus || existingShipment.status;

    // Check if status is already the same
    if (currentStatus === status) {
      return res.status(400).json({
        success: false,
        message: `Shipment is already in ${status} status`
      });
    }

    // Handle on_hold special case
    let finalStatus = status;
    let lastActiveStatus = existingShipment.lastActiveStatus;

    if (currentStatus === 'on_hold' && status !== 'cancelled') {
      // Resuming from on_hold
      finalStatus = resumeTo || status;
      lastActiveStatus = null;
    } else if (status === 'on_hold') {
      // Going into on_hold
      lastActiveStatus = currentStatus;
    }

    // Validate status transition
    const isValid = isValidStatusTransition(currentStatus, finalStatus);
    
    if (!isValid) {
      const allowedStatuses = getAllowedNextStatuses(currentStatus);
      
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${currentStatus} to ${finalStatus}. You can only move forward in sequence, put on hold, or cancel.`,
        currentStatus,
        requestedStatus: finalStatus,
        allowedNextStatuses: allowedStatuses
      });
    }

    // Get current timestamp
    const now = updateDateTime ? new Date(updateDateTime) : new Date();

    // Prepare update data
    const updateData = {
      shipmentStatus: finalStatus,
      status: finalStatus,
      lastStatusUpdate: now,
      lastUpdatedBy: userId
    };

    // Handle lastActiveStatus for on_hold
    if (status === 'on_hold') {
      updateData.lastActiveStatus = currentStatus;
    } else if (currentStatus === 'on_hold' && finalStatus !== 'cancelled') {
      updateData.lastActiveStatus = null;
    }

    // Create timeline entry
    const timelineEntry = {
      status: finalStatus,
      description: notes || `Status updated from ${currentStatus} to ${finalStatus}`,
      timestamp: now,
      updatedBy: userId
    };

    // Update the shipment
    const updatedShipment = await NewShipment.findByIdAndUpdate(
      id,
      {
        $set: updateData,
        $push: { timeline: timelineEntry }
      },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      data: updatedShipment,
      message: `Shipment status updated from ${currentStatus} to ${finalStatus} successfully`
    });

  } catch (error) {
    console.error('Error updating shipment status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update shipment status'
    });
  }
};