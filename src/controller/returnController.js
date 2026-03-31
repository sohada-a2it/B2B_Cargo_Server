// backend/controllers/returnController.js

const Shipment = require('../models/shipmentModel');
const User = require('../models/userModel');
const sendEmail = require('../utils/emailService');

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate return cost based on shipment value and reason
 */
const calculateReturnCost = (shipment, reason) => {
  // Get total shipment value
  const totalValue = shipment.packages?.reduce((sum, pkg) => {
    return sum + ((pkg.value?.amount || 0) * (pkg.quantity || 1));
  }, 0) || 0;

  // Base return cost
  let returnCost = 0;
  let costBreakdown = {};

  switch (reason) {
    case 'damaged_product':
      // For damaged product, customer pays 0% (company bears cost)
      returnCost = 0;
      costBreakdown = {
        shippingCost: 0,
        handlingFee: 0,
        restockingFee: 0,
        total: 0,
        note: 'Damaged product - no cost to customer'
      };
      break;
      
    case 'wrong_product':
      // For wrong product, customer pays 0% (company error)
      returnCost = 0;
      costBreakdown = {
        shippingCost: 0,
        handlingFee: 0,
        restockingFee: 0,
        total: 0,
        note: 'Wrong product - no cost to customer'
      };
      break;
      
    case 'missing_items':
      // Partial return - only for missing items
      returnCost = 0;
      costBreakdown = {
        shippingCost: 0,
        handlingFee: 0,
        restockingFee: 0,
        total: 0,
        note: 'Missing items - no cost to customer'
      };
      break;
      
    case 'delayed_delivery':
      // Customer returns due to delay - free return
      returnCost = 0;
      costBreakdown = {
        shippingCost: 0,
        handlingFee: 0,
        restockingFee: 0,
        total: 0,
        note: 'Delayed delivery - free return'
      };
      break;
      
    case 'customer_cancellation':
      // Customer changed mind - charges apply
      returnCost = Math.max(50, totalValue * 0.15); // Min $50 or 15% of value
      costBreakdown = {
        shippingCost: 25,
        handlingFee: 15,
        restockingFee: Math.max(10, totalValue * 0.1),
        total: returnCost,
        note: 'Customer cancellation - charges apply'
      };
      break;
      
    case 'other':
    default:
      // Other reasons - standard charges
      returnCost = Math.max(35, totalValue * 0.1); // Min $35 or 10% of value
      costBreakdown = {
        shippingCost: 20,
        handlingFee: 10,
        restockingFee: Math.max(5, totalValue * 0.05),
        total: returnCost,
        note: 'Standard return charges apply'
      };
      break;
  }

  return {
    amount: returnCost,
    currency: 'USD',
    breakdown: costBreakdown,
    isFree: returnCost === 0
  };
};

// ==================== CUSTOMER CONTROLLERS ====================

/**
 * @desc    Request Return (Customer) - Calculate and show cost
 * @route   POST /api/v1/shipments/:id/return-request
 * @access  Private (Customer only)
 */
exports.requestReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, description, items, images } = req.body;

    const shipment = await Shipment.findOne({
      _id: id,
      customerId: req.user._id
    }).populate('customerId', 'firstName lastName email phone');

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found or access denied'
      });
    }

    // Check if shipment is eligible for return
    const eligibleStatuses = ['delivered', 'completed'];
    if (!eligibleStatuses.includes(shipment.status)) {
      return res.status(400).json({
        success: false,
        message: `Shipment cannot be returned. Current status: ${shipment.status}`
      });
    }

    // Check if return already requested
    if (shipment.returnRequest && 
        shipment.returnRequest.status !== 'none' && 
        shipment.returnRequest.status !== 'rejected_by_admin' &&
        shipment.returnRequest.status !== 'rejected_by_customer') {
      return res.status(400).json({
        success: false,
        message: `Return already ${shipment.returnRequest.status}`
      });
    }

    // Check delivery date (within 14 days)
    const deliveryDate = shipment.dates?.delivered || shipment.courier?.actualDeliveryDate;
    if (deliveryDate) {
      const daysSinceDelivery = Math.floor((Date.now() - new Date(deliveryDate)) / (1000 * 60 * 60 * 24));
      if (daysSinceDelivery > 14) {
        return res.status(400).json({
          success: false,
          message: `Return period expired. You can only request return within 14 days of delivery.`
        });
      }
    }

    // Calculate return cost
    const returnCost = calculateReturnCost(shipment, reason);

    // Create return request
    shipment.returnRequest = {
      requestedBy: req.user._id,
      requestedAt: new Date(),
      status: 'pending',
      reason: reason,
      description: description,
      items: items || [],
      images: images || [],
      returnCost: returnCost.amount,
      returnCostCurrency: returnCost.currency,
      returnCostBreakdown: returnCost.breakdown,
      isFreeReturn: returnCost.isFree
    };

    await shipment.save();

    // Notify admins
    const admins = await User.find({ role: 'admin', isActive: true });
    const adminEmails = admins.map(a => a.email);
    
    if (adminEmails.length > 0) {
      await sendEmail({
        to: adminEmails,
        subject: `🔄 New Return Request - ${shipment.trackingNumber}`,
        html: `
          <h2>New Return Request</h2>
          <p><strong>Shipment:</strong> ${shipment.shipmentNumber}</p>
          <p><strong>Tracking:</strong> ${shipment.trackingNumber}</p>
          <p><strong>Customer:</strong> ${shipment.customerId?.firstName} ${shipment.customerId?.lastName}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Return Cost:</strong> ${returnCost.isFree ? 'FREE' : `$${returnCost.amount}`}</p>
          <p><strong>Description:</strong> ${description}</p>
          <a href="${process.env.FRONTEND_URL}/admin/return-requests">Review Return Request</a>
        `
      }).catch(err => console.log('Admin notification error:', err.message));
    }

    res.status(200).json({
      success: true,
      message: 'Return request submitted successfully',
      data: {
        returnRequest: shipment.returnRequest,
        returnCost: returnCost,
        trackingNumber: shipment.trackingNumber
      }
    });

  } catch (error) {
    console.error('Request return error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get Return Request Status (Customer) - সাথে Cost দেখাবে
 * @route   GET /api/v1/shipments/:id/return-status
 * @access  Private (Customer only)
 */
exports.getReturnRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const shipment = await Shipment.findOne({
      _id: id,
      customerId: req.user._id
    }).select('trackingNumber shipmentNumber status returnRequest');

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        trackingNumber: shipment.trackingNumber,
        shipmentNumber: shipment.shipmentNumber,
        shipmentStatus: shipment.status,
        returnRequest: shipment.returnRequest || { status: 'none' },
        returnCost: shipment.returnRequest?.returnCost || 0,
        isFreeReturn: shipment.returnRequest?.isFreeReturn || false
      }
    });

  } catch (error) {
    console.error('Get return status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Customer Confirms Return with Cost - Complete হয়ে যাবে
 * @route   PUT /api/v1/shipments/:id/return-confirm
 * @access  Private (Customer only)
 */
exports.customerConfirmReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, acceptCost } = req.body;

    const shipment = await Shipment.findOne({
      _id: id,
      customerId: req.user._id
    }).populate('customerId', 'firstName lastName email');

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }

    // Check if return request is in approved status
    if (!shipment.returnRequest || shipment.returnRequest.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm return. Current status: ${shipment.returnRequest?.status || 'none'}`
      });
    }

    // Check if customer accepts the return cost
    if (!acceptCost && shipment.returnRequest.returnCost > 0) {
      return res.status(400).json({
        success: false,
        message: `You must accept the return cost of $${shipment.returnRequest.returnCost} to proceed with return.`
      });
    }

    // ========== Complete Return - Status পরিবর্তন ==========
    shipment.returnRequest.status = 'completed';
    shipment.returnRequest.customerConfirmedAt = new Date();
    shipment.returnRequest.customerNotes = notes;
    shipment.returnRequest.completedAt = new Date();
    shipment.returnRequest.completedBy = req.user._id;
    shipment.returnRequest.costAccepted = acceptCost || false;

    // Update shipment status
    shipment.status = 'returned';

    await shipment.save();

    // Notify admins
    const admins = await User.find({ role: 'admin', isActive: true });
    const adminEmails = admins.map(a => a.email);
    
    await sendEmail({
      to: adminEmails,
      subject: `✅ Return Completed by Customer - ${shipment.trackingNumber}`,
      html: `
        <h2>Return Completed by Customer</h2>
        <p><strong>Shipment:</strong> ${shipment.shipmentNumber}</p>
        <p><strong>Tracking:</strong> ${shipment.trackingNumber}</p>
        <p><strong>Customer:</strong> ${shipment.customerId?.firstName} ${shipment.customerId?.lastName}</p>
        <p><strong>Return Cost:</strong> $${shipment.returnRequest.returnCost}</p>
        <p><strong>Customer Notes:</strong> ${notes || 'No notes provided'}</p>
        <p><strong>Status:</strong> Return Completed</p>
      `
    }).catch(err => console.log('Admin notification error:', err.message));

    res.status(200).json({
      success: true,
      message: shipment.returnRequest.returnCost > 0 
        ? `Return confirmed with cost $${shipment.returnRequest.returnCost}. Return completed successfully!`
        : 'Return confirmed and completed successfully!',
      data: shipment.returnRequest
    });

  } catch (error) {
    console.error('Customer confirm return error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Customer Rejects Return (After Admin Approval)
 * @route   PUT /api/v1/shipments/:id/return-reject-customer
 * @access  Private (Customer only)
 */
exports.customerRejectReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const shipment = await Shipment.findOne({
      _id: id,
      customerId: req.user._id
    });

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }

    if (!shipment.returnRequest || shipment.returnRequest.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel. Current status: ${shipment.returnRequest?.status || 'none'}`
      });
    }

    shipment.returnRequest.status = 'rejected_by_customer';
    shipment.returnRequest.customerRejectionReason = reason;
    shipment.returnRequest.customerRejectedAt = new Date();

    await shipment.save();

    res.status(200).json({
      success: true,
      message: 'Return cancelled',
      data: shipment.returnRequest
    });

  } catch (error) {
    console.error('Customer reject return error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==================== ADMIN CONTROLLERS ====================

/**
 * @desc    Get All Return Requests (Admin)
 * @route   GET /api/v1/admin/return-requests
 * @access  Private (Admin only)
 */
exports.getAllReturnRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = { 'returnRequest.status': { $ne: 'none' } };
    if (status && status !== 'all') {
      query['returnRequest.status'] = status;
    }

    const shipments = await Shipment.find(query)
      .populate('customerId', 'firstName lastName email phone companyName')
      .populate('returnRequest.requestedBy', 'firstName lastName email')
      .populate('returnRequest.approvedBy', 'firstName lastName email')
      .sort({ 'returnRequest.requestedAt': -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Shipment.countDocuments(query);

    const formattedData = shipments.map(shipment => ({
      _id: shipment._id,
      shipmentId: shipment._id,
      shipmentNumber: shipment.shipmentNumber,
      trackingNumber: shipment.trackingNumber,
      customerName: shipment.customerId?.companyName || 
                    `${shipment.customerId?.firstName || ''} ${shipment.customerId?.lastName || ''}`.trim(),
      status: shipment.returnRequest?.status,
      reason: shipment.returnRequest?.reason,
      description: shipment.returnRequest?.description,
      returnCost: shipment.returnRequest?.returnCost || 0,
      isFreeReturn: shipment.returnRequest?.isFreeReturn || false,
      requestedAt: shipment.returnRequest?.requestedAt,
      approvedAt: shipment.returnRequest?.approvedAt,
      rejectionReason: shipment.returnRequest?.rejectionReason,
      returnTrackingNumber: shipment.returnRequest?.returnTrackingNumber,
      customerConfirmedAt: shipment.returnRequest?.customerConfirmedAt,
      completedAt: shipment.returnRequest?.completedAt
    }));

    // Summary statistics
    const summary = await Shipment.aggregate([
      { $match: { 'returnRequest.status': { $ne: 'none' } } },
      { $group: {
        _id: '$returnRequest.status',
        count: { $sum: 1 },
        totalCost: { $sum: '$returnRequest.returnCost' }
      }}
    ]);

    res.status(200).json({
      success: true,
      data: formattedData,
      summary,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get return requests error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Admin Approve Return Request (Cost দেখাবে)
 * @route   PUT /api/v1/admin/return-requests/:id/approve
 * @access  Private (Admin only)
 */
// controllers/shipmentController.js - approveReturnRequest ফাংশন আপডেট করুন

exports.approveReturnRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { returnTrackingNumber, notes, adjustCost } = req.body;

        const shipment = await Shipment.findById(id)
            .populate('customerId', 'email firstName lastName');

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        if (!shipment.returnRequest || shipment.returnRequest.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'No pending return request found'
            });
        }

        // ✅ Admin cost adjustment option
        if (adjustCost && adjustCost.amount !== undefined) {
            shipment.returnRequest.returnCost = adjustCost.amount;
            shipment.returnRequest.returnCostCurrency = adjustCost.currency || 'USD';
            shipment.returnRequest.returnCostAdjustedBy = req.user._id;
            shipment.returnRequest.returnCostAdjustedAt = new Date();
            shipment.returnRequest.returnCostAdjustmentReason = adjustCost.reason;
        }

        // Update return request
        shipment.returnRequest.status = 'approved';  // ✅ 'approved' use করুন, 'customer_confirmed' পরে হবে
        shipment.returnRequest.approvedBy = req.user._id;
        shipment.returnRequest.approvedAt = new Date();
        shipment.returnRequest.returnTrackingNumber = returnTrackingNumber;
        shipment.returnRequest.returnNotes = notes;

        // Add milestone - 'return_approved' use করুন
        shipment.milestones = shipment.milestones || [];
        shipment.milestones.push({
            status: 'return_approved',  // ✅ এটা shipmentStatuses এ থাকতে হবে
            location: 'System',
            description: `Return request approved. Return tracking: ${returnTrackingNumber || 'To be provided'}. ${notes || ''}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });

        await shipment.save();

        res.status(200).json({
            success: true,
            message: `Return request approved. Customer needs to confirm with cost $${shipment.returnRequest.returnCost}.`,
            data: {
                returnRequest: shipment.returnRequest,
                returnCost: shipment.returnRequest.returnCost,
                isFreeReturn: shipment.returnRequest.isFreeReturn
            }
        });

    } catch (error) {
        console.error('Approve return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== CUSTOMER CONFIRM RETURN (New function) ==========
exports.customerConfirmReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, acceptCost } = req.body;

        const shipment = await Shipment.findOne({
            _id: id,
            customerId: req.user._id
        }).populate('customerId', 'firstName lastName email');

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        // Check if return request is in approved status
        if (!shipment.returnRequest || shipment.returnRequest.status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: `Cannot confirm return. Current status: ${shipment.returnRequest?.status || 'none'}`
            });
        }

        // Check if customer accepts the return cost
        if (!acceptCost && shipment.returnRequest.returnCost > 0) {
            return res.status(400).json({
                success: false,
                message: `You must accept the return cost of $${shipment.returnRequest.returnCost} to proceed with return.`
            });
        }

        // ✅ Complete Return - সরাসরি completed করে দিন
        shipment.returnRequest.status = 'completed';
        shipment.returnRequest.customerConfirmedAt = new Date();
        shipment.returnRequest.customerNotes = notes;
        shipment.returnRequest.completedAt = new Date();
        shipment.returnRequest.completedBy = req.user._id;
        shipment.returnRequest.costAccepted = acceptCost || false;

        // Update shipment status
        shipment.status = 'returned';

        // Add milestone - 'return_completed' use করুন
        shipment.milestones.push({
            status: 'return_completed',  // ✅ এটা shipmentStatuses এ থাকতে হবে
            location: 'Customer Location',
            description: `Return confirmed and completed by customer. Cost accepted: ${acceptCost ? 'Yes' : 'No'}. ${notes || ''}`,
            updatedBy: req.user._id,
            timestamp: new Date()
        });

        await shipment.save();

        res.status(200).json({
            success: true,
            message: shipment.returnRequest.returnCost > 0 
                ? `Return confirmed with cost $${shipment.returnRequest.returnCost}. Return completed successfully!`
                : 'Return confirmed and completed successfully!',
            data: shipment.returnRequest
        });

    } catch (error) {
        console.error('Customer confirm return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== CUSTOMER REJECT RETURN (New function) ==========
exports.customerRejectReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const shipment = await Shipment.findOne({
            _id: id,
            customerId: req.user._id
        });

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        if (!shipment.returnRequest || shipment.returnRequest.status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel. Current status: ${shipment.returnRequest?.status || 'none'}`
            });
        }

        shipment.returnRequest.status = 'rejected_by_customer';
        shipment.returnRequest.customerRejectionReason = reason;
        shipment.returnRequest.customerRejectedAt = new Date();

        await shipment.save();

        res.status(200).json({
            success: true,
            message: 'Return cancelled',
            data: shipment.returnRequest
        });

    } catch (error) {
        console.error('Customer reject return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Admin Reject Return Request
 * @route   PUT /api/v1/admin/return-requests/:id/reject
 * @access  Private (Admin only)
 */
exports.rejectReturnRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || rejectionReason.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const shipment = await Shipment.findById(id)
      .populate('customerId', 'firstName lastName email');

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: 'Shipment not found'
      });
    }

    if (!shipment.returnRequest || shipment.returnRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject. Current status: ${shipment.returnRequest?.status || 'none'}`
      });
    }

    shipment.returnRequest.status = 'rejected_by_admin';
    shipment.returnRequest.rejectionReason = rejectionReason;
    shipment.returnRequest.approvedBy = req.user._id;
    shipment.returnRequest.approvedAt = new Date();

    await shipment.save();

    await sendEmail({
      to: shipment.customerId.email,
      subject: `❌ Return Request Rejected - ${shipment.trackingNumber}`,
      html: `
        <h2>Return Request Rejected</h2>
        <p>Dear ${shipment.customerId.firstName || 'Customer'},</p>
        <p>Your return request for shipment <strong>${shipment.shipmentNumber}</strong> has been rejected.</p>
        <p><strong>Reason:</strong> ${rejectionReason}</p>
        <p>If you have any questions, please contact our support team.</p>
      `
    }).catch(err => console.log('Email error:', err.message));

    res.status(200).json({
      success: true,
      message: 'Return request rejected',
      data: shipment.returnRequest
    });

  } catch (error) {
    console.error('Reject return error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get Return Request Statistics (Admin)
 * @route   GET /api/v1/admin/return-requests/stats
 * @access  Private (Admin only)
 */
exports.getReturnStats = async (req, res) => {
  try {
    const stats = await Shipment.aggregate([
      { $match: { 'returnRequest.status': { $ne: 'none' } } },
      { $group: {
        _id: '$returnRequest.status',
        count: { $sum: 1 },
        totalCost: { $sum: '$returnRequest.returnCost' }
      }}
    ]);

    const total = stats.reduce((sum, item) => sum + item.count, 0);
    const totalCost = stats.reduce((sum, item) => sum + (item.totalCost || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        total,
        totalReturnCost: totalCost,
        pending: stats.find(s => s._id === 'pending')?.count || 0,
        approved: stats.find(s => s._id === 'approved')?.count || 0,
        rejected_by_admin: stats.find(s => s._id === 'rejected_by_admin')?.count || 0,
        rejected_by_customer: stats.find(s => s._id === 'rejected_by_customer')?.count || 0,
        completed: stats.find(s => s._id === 'completed')?.count || 0
      }
    });

  } catch (error) {
    console.error('Get return stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};