const NewShipment = require('../models/newShipmentModel');


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

exports.createShipment = async (req, res) => {
    try {
        const bookingData = req.body;

        console.log('📦 Creating shipment:', bookingData);

        // ===== AUTO GENERATE =====
        const trackingNumber = bookingData.trackingNumber || await generateTrackingNumber();
        const shipmentNumber = bookingData.shipmentNumber || await generateShipmentNumber();

        // ===== TIMELINE =====
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

        // ===== CREATE =====
        const shipment = await NewShipment.create({

            shipmentNumber,
            trackingNumber,

            // OPTIONAL RELATIONS
            bookingId: null, // 🔥 force null
            customerId: bookingData.customer || null,

            // CUSTOMER INFO
            customerInfo: {
                name: bookingData.sender?.name,
                email: bookingData.sender?.email,
                phone: bookingData.sender?.phone,
                companyName: bookingData.sender?.companyName
            },

            // CLASSIFICATION
            shipmentClassification: bookingData.shipmentClassification,

            serviceType: bookingData.serviceType || 'standard',

            // DETAILS
            shipmentDetails: {
                origin: bookingData.shipmentDetails?.origin,
                destination: bookingData.shipmentDetails?.destination,
                shippingMode: bookingData.shipmentDetails?.shippingMode || 'DDU',

                packageDetails: (bookingData.shipmentDetails?.packageDetails || bookingData.packages || []).map(pkg => ({
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

            // DATES
            dates: {
                estimatedDeparture: bookingData.dates?.estimatedDeparture,
                estimatedArrival: bookingData.dates?.estimatedArrival
            },

            // PRICE
            quotedPrice: {
                amount: bookingData.quotedPrice?.amount || 0,
                currency: bookingData.quotedPrice?.currency || 'USD',
                breakdown: bookingData.quotedPrice?.breakdown || {},
                notes: bookingData.quotedPrice?.notes || '',
                quotedBy: bookingData.createdBy,
                quotedAt: new Date()
            },

            pricingStatus: bookingData.pricingStatus || 'quoted',

            // PAYMENT
            payment: {
                mode: bookingData.payment?.mode || 'bank_transfer',
                currency: bookingData.payment?.currency || 'USD',
                amount: bookingData.quotedPrice?.amount || 0
            },

            // PARTIES
            sender: bookingData.sender,
            receiver: bookingData.receiver,

            // COURIER
            courier: {
                company: bookingData.courier?.company || 'Cargo Logistics Group',
                serviceType: bookingData.serviceType
            },

            // STATUS
            status: bookingData.status || 'booking_requested',
            shipmentStatus: bookingData.shipmentStatus || 'pending',
            currentMilestone: timelineEntries[timelineEntries.length - 1]?.status,

            // TIMELINE
            timeline: timelineEntries,

            // AUDIT
            createdBy: bookingData.createdBy,
            updatedBy: bookingData.createdBy
        });

        console.log('✅ Shipment created:', shipment._id);

        return res.status(201).json({
            success: true,
            message: 'Shipment created successfully',
            data: shipment
        });

    } catch (error) {
        console.error('❌ ERROR:', error);

        // DUPLICATE ERROR
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

exports.getMyShipments = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc', search, status, startDate, endDate } = req.query;

    // Build query for customer's shipments
    let query = { customerId: req.user._id };
    
    // Add search filter
    if (search) {
      query.$or = [
        { shipmentNumber: { $regex: search, $options: 'i' } },
        { trackingNumber: { $regex: search, $options: 'i' } }
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
    
    // Count total documents
    const total = await NewShipment.countDocuments(query);
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    
    // Execute query with pagination
    const shipments = await NewShipment.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('customerId', 'firstName lastName email phone companyName');
    
    // Calculate summary
    const summary = await getShipmentSummaryForCustomer(req.user._id);
    
    res.status(200).json({
      success: true,
      data: shipments,
      summary,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      },
      message: 'Shipments fetched successfully'
    });
  } catch (error) {
    console.error('Get my shipments error:', error);
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