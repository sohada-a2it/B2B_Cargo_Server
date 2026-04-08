// backend/controllers/returnController.js

const Shipment = require('../models/shipmentModel');
const NewShipment = require('../models/newShipmentModel');
const User = require('../models/userModel');
const sendEmail = require('../utils/returnEmail');

// ==================== HELPER FUNCTIONS ====================

/**
 * Get shipment from either model (উভয় মডেলের জন্য)
 */
const findShipment = async (id, userId = null, checkOwnership = false) => {
    // First try to find in NewShipment
    let shipment = await NewShipment.findById(id);
    let model = 'NewShipment';
    
    if (!shipment) {
        // If not found, try old Shipment model
        shipment = await Shipment.findById(id);
        model = 'Shipment';
    }
    
    if (!shipment) return null;
    
    // Check ownership if required
    if (checkOwnership && userId) {
        const isOwner = 
            shipment.customerId?.toString() === userId.toString() ||
            shipment.sender?.email === userId ||
            shipment.customerInfo?.email === userId;
        
        if (!isOwner) return null;
    }
    
    return { shipment, model };
};

/**
 * Calculate return cost based on shipment value and reason (উভয় মডেলের জন্য)
 */
const calculateReturnCost = (shipment, reason) => {
    // Get total shipment value - handle both model structures
    let totalValue = 0;
    
    // Old model (Shipment)
    if (shipment.packages && Array.isArray(shipment.packages)) {
        totalValue = shipment.packages.reduce((sum, pkg) => {
            return sum + ((pkg.value?.amount || 0) * (pkg.quantity || 1));
        }, 0);
    }
    // New model (NewShipment)
    else if (shipment.shipmentDetails?.packageDetails && Array.isArray(shipment.shipmentDetails.packageDetails)) {
        totalValue = shipment.shipmentDetails.packageDetails.reduce((sum, pkg) => {
            return sum + ((pkg.value?.amount || 0) * (pkg.quantity || 1));
        }, 0);
    }

    let returnCost = 0;
    let costBreakdown = {};

    switch (reason) {
        case 'damaged_product':
        case 'wrong_product':
        case 'missing_items':
        case 'delayed_delivery':
            returnCost = 0;
            costBreakdown = {
                shippingCost: 0,
                handlingFee: 0,
                restockingFee: 0,
                total: 0,
                note: 'Free return - no cost to customer'
            };
            break;
            
        case 'customer_cancellation':
            returnCost = Math.max(50, totalValue * 0.15);
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
            returnCost = Math.max(35, totalValue * 0.1);
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

/**
 * Get shipment status (উভয় মডেলের জন্য)
 */
const getShipmentStatus = (shipment) => {
    return shipment.status || shipment.shipmentStatus;
};

/**
 * Update shipment status (উভয় মডেলের জন্য)
 */
const updateShipmentStatus = (shipment, status) => {
    if (shipment.status) {
        shipment.status = status;
    }
    if (shipment.shipmentStatus) {
        shipment.shipmentStatus = status;
    }
};

/**
 * Add timeline/milestone entry (উভয় মডেলের জন্য)
 */
const addTimelineEntry = (shipment, status, description, location, userId) => {
    const entry = {
        status,
        description,
        location: location || 'System',
        updatedBy: userId,
        timestamp: new Date()
    };
    
    if (shipment.timeline && Array.isArray(shipment.timeline)) {
        shipment.timeline.push(entry);
    } else if (shipment.milestones && Array.isArray(shipment.milestones)) {
        shipment.milestones.push(entry);
    } else {
        // Create timeline if doesn't exist
        shipment.timeline = [entry];
    }
};

// ==================== CUSTOMER CONTROLLERS ====================

/**
 * @desc    Request Return (Customer) - উভয় মডেলের জন্য
 * @route   POST /api/v1/shipments/:id/return-request
 * @access  Private (Customer only)
 */
exports.requestReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, description, items, images } = req.body;

        // Find shipment in either model with ownership check
        const result = await findShipment(id, req.user._id, true);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found or access denied'
            });
        }

        const { shipment, model } = result;
        const currentStatus = getShipmentStatus(shipment);

        // Check if shipment is eligible for return
        const eligibleStatuses = ['delivered', 'completed'];
        if (!eligibleStatuses.includes(currentStatus)) {
            return res.status(400).json({
                success: false,
                message: `Shipment cannot be returned. Current status: ${currentStatus}`
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
        const deliveryDate = shipment.dates?.actualDelivery || 
                            shipment.dates?.delivered || 
                            shipment.courier?.actualDeliveryDate;
        
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

        // Add to timeline
        addTimelineEntry(shipment, 'return_requested', `Return requested: ${reason}`, null, req.user._id);

        await shipment.save();

        // Get customer info for email
        const customerName = shipment.customerId?.firstName || 
                            shipment.sender?.name || 
                            shipment.customerInfo?.name || 
                            'Customer';

        // Notify admins
        const admins = await User.find({ role: { $in: ['admin', 'super_admin'] }, isActive: true });
        const adminEmails = admins.map(a => a.email);
        
        if (adminEmails.length > 0) {
            await sendEmail({
                to: adminEmails,
                subject: `🔄 New Return Request - ${shipment.trackingNumber}`,
                html: `
                    <h2>New Return Request</h2>
                    <p><strong>Shipment:</strong> ${shipment.shipmentNumber}</p>
                    <p><strong>Tracking:</strong> ${shipment.trackingNumber}</p>
                    <p><strong>Model:</strong> ${model}</p>
                    <p><strong>Customer:</strong> ${customerName}</p>
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
                trackingNumber: shipment.trackingNumber,
                model: model
            }
        });

    } catch (error) {
        console.error('Request return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Get Return Request Status (Customer) - উভয় মডেলের জন্য
 * @route   GET /api/v1/shipments/:id/return-status
 * @access  Private (Customer only)
 */
exports.getReturnRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await findShipment(id, req.user._id, true);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        const { shipment, model } = result;

        res.status(200).json({
            success: true,
            data: {
                trackingNumber: shipment.trackingNumber,
                shipmentNumber: shipment.shipmentNumber,
                shipmentStatus: getShipmentStatus(shipment),
                returnRequest: shipment.returnRequest || { status: 'none' },
                returnCost: shipment.returnRequest?.returnCost || 0,
                isFreeReturn: shipment.returnRequest?.isFreeReturn || false,
                model: model
            }
        });

    } catch (error) {
        console.error('Get return status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Customer Confirms Return - উভয় মডেলের জন্য
 * @route   PUT /api/v1/shipments/:id/return-confirm
 * @access  Private (Customer only)
 */
exports.customerConfirmReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, acceptCost } = req.body;

        const result = await findShipment(id, req.user._id, true);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        const { shipment } = result;

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

        // Complete Return
        shipment.returnRequest.status = 'completed';
        shipment.returnRequest.customerConfirmedAt = new Date();
        shipment.returnRequest.customerNotes = notes;
        shipment.returnRequest.completedAt = new Date();
        shipment.returnRequest.completedBy = req.user._id;
        shipment.returnRequest.costAccepted = acceptCost || false;

        // Update shipment status to returned
        updateShipmentStatus(shipment, 'returned');

        // Add to timeline
        addTimelineEntry(shipment, 'return_completed', 
            `Return confirmed and completed by customer. Cost accepted: ${acceptCost ? 'Yes' : 'No'}. ${notes || ''}`,
            'Customer Location', req.user._id);

        await shipment.save();

        // Get customer name for email
        const customerName = shipment.customerId?.firstName || 
                            shipment.sender?.name || 
                            shipment.customerInfo?.name || 
                            'Customer';

        // Notify admins
        const admins = await User.find({ role: { $in: ['admin', 'super_admin'] }, isActive: true });
        const adminEmails = admins.map(a => a.email);
        
        await sendEmail({
            to: adminEmails,
            subject: `✅ Return Completed by Customer - ${shipment.trackingNumber}`,
            html: `
                <h2>Return Completed by Customer</h2>
                <p><strong>Shipment:</strong> ${shipment.shipmentNumber}</p>
                <p><strong>Tracking:</strong> ${shipment.trackingNumber}</p>
                <p><strong>Customer:</strong> ${customerName}</p>
                <p><strong>Return Cost:</strong> ${shipment.returnRequest.returnCost > 0 ? `$${shipment.returnRequest.returnCost}` : 'FREE'}</p>
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
 * @desc    Customer Rejects Return - উভয় মডেলের জন্য
 * @route   PUT /api/v1/shipments/:id/return-reject-customer
 * @access  Private (Customer only)
 */
exports.customerRejectReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const result = await findShipment(id, req.user._id, true);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Shipment not found'
            });
        }

        const { shipment } = result;

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
 * @desc    Get All Return Requests (Admin) - উভয় মডেল থেকে
 * @route   GET /api/v1/admin/return-requests
 * @access  Private (Admin only)
 */
exports.getAllReturnRequests = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        // Build query
        let query = { 'returnRequest.status': { $ne: 'none' } };
        if (status && status !== 'all') {
            query['returnRequest.status'] = status;
        }

        // Get from both models
        const [newShipments, oldShipments] = await Promise.all([
            NewShipment.find(query)
                .populate('customerId', 'firstName lastName email phone companyName')
                .populate('returnRequest.requestedBy', 'firstName lastName email')
                .populate('returnRequest.approvedBy', 'firstName lastName email')
                .sort({ 'returnRequest.requestedAt': -1 })
                .lean(),
            Shipment.find(query)
                .populate('customerId', 'firstName lastName email phone companyName')
                .populate('returnRequest.requestedBy', 'firstName lastName email')
                .populate('returnRequest.approvedBy', 'firstName lastName email')
                .sort({ 'returnRequest.requestedAt': -1 })
                .lean()
        ]);

        // Combine and format
        const allReturns = [
            ...newShipments.map(s => ({ ...s, _modelType: 'NewShipment' })),
            ...oldShipments.map(s => ({ ...s, _modelType: 'Shipment' }))
        ];

        // Sort by requestedAt
        allReturns.sort((a, b) => new Date(b.returnRequest?.requestedAt) - new Date(a.returnRequest?.requestedAt));

        // Pagination
        const total = allReturns.length;
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const paginatedData = allReturns.slice(startIndex, startIndex + parseInt(limit));

        const formattedData = paginatedData.map(shipment => ({
            _id: shipment._id,
            modelType: shipment._modelType,
            shipmentId: shipment._id,
            shipmentNumber: shipment.shipmentNumber,
            trackingNumber: shipment.trackingNumber,
            customerName: shipment.customerId?.companyName || 
                          `${shipment.customerId?.firstName || ''} ${shipment.customerId?.lastName || ''}`.trim() ||
                          shipment.sender?.name ||
                          shipment.customerInfo?.name ||
                          'N/A',
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

        // Summary statistics from both models
        const [newSummary, oldSummary] = await Promise.all([
            NewShipment.aggregate([
                { $match: { 'returnRequest.status': { $ne: 'none' } } },
                { $group: {
                    _id: '$returnRequest.status',
                    count: { $sum: 1 },
                    totalCost: { $sum: '$returnRequest.returnCost' }
                }}
            ]),
            Shipment.aggregate([
                { $match: { 'returnRequest.status': { $ne: 'none' } } },
                { $group: {
                    _id: '$returnRequest.status',
                    count: { $sum: 1 },
                    totalCost: { $sum: '$returnRequest.returnCost' }
                }}
            ])
        ]);

        // Combine summaries
        const summaryMap = new Map();
        [...newSummary, ...oldSummary].forEach(item => {
            if (summaryMap.has(item._id)) {
                const existing = summaryMap.get(item._id);
                existing.count += item.count;
                existing.totalCost += item.totalCost;
            } else {
                summaryMap.set(item._id, { ...item });
            }
        });

        const summary = Array.from(summaryMap.values());

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
 * @desc    Admin Approve Return Request - উভয় মডেলের জন্য
 * @route   PUT /api/v1/admin/return-requests/:id/approve
 * @access  Private (Admin only)
 */
exports.approveReturnRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { returnTrackingNumber, notes, adjustCost } = req.body;

        // Find in either model
        let shipment = await NewShipment.findById(id).populate('customerId', 'email firstName lastName sender customerInfo');
        let model = 'NewShipment';
        
        if (!shipment) {
            shipment = await Shipment.findById(id).populate('customerId', 'email firstName lastName');
            model = 'Shipment';
        }
        
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

        // Admin cost adjustment option
        if (adjustCost && adjustCost.amount !== undefined) {
            shipment.returnRequest.returnCost = adjustCost.amount;
            shipment.returnRequest.returnCostCurrency = adjustCost.currency || 'USD';
            shipment.returnRequest.returnCostAdjustedBy = req.user._id;
            shipment.returnRequest.returnCostAdjustedAt = new Date();
            shipment.returnRequest.returnCostAdjustmentReason = adjustCost.reason;
        }

        // Update return request
        shipment.returnRequest.status = 'approved';
        shipment.returnRequest.approvedBy = req.user._id;
        shipment.returnRequest.approvedAt = new Date();
        shipment.returnRequest.returnTrackingNumber = returnTrackingNumber;
        shipment.returnRequest.returnNotes = notes;

        // Add timeline entry
        addTimelineEntry(shipment, 'return_approved', 
            `Return request approved. Return tracking: ${returnTrackingNumber || 'To be provided'}. ${notes || ''}`,
            'System', req.user._id);

        await shipment.save();

        // Get customer email
        const customerEmail = shipment.customerId?.email || 
                             shipment.sender?.email || 
                             shipment.customerInfo?.email;
        
        const customerName = shipment.customerId?.firstName || 
                            shipment.sender?.name || 
                            shipment.customerInfo?.name || 
                            'Customer';

        // Notify customer
        if (customerEmail) {
            await sendEmail({
                to: customerEmail,
                subject: `✅ Return Request Approved - ${shipment.trackingNumber}`,
                html: `
                    <h2>Return Request Approved</h2>
                    <p>Dear ${customerName},</p>
                    <p>Your return request for shipment <strong>${shipment.shipmentNumber}</strong> has been approved.</p>
                    <p><strong>Return Cost:</strong> ${shipment.returnRequest.isFreeReturn ? 'FREE' : `$${shipment.returnRequest.returnCost}`}</p>
                    ${returnTrackingNumber ? `<p><strong>Return Tracking Number:</strong> ${returnTrackingNumber}</p>` : ''}
                    ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
                    <p>Please login to your account to confirm the return with the associated cost.</p>
                    <a href="${process.env.FRONTEND_URL}/my-shipments">Confirm Return</a>
                `
            }).catch(err => console.log('Email error:', err.message));
        }

        res.status(200).json({
            success: true,
            message: `Return request approved. Customer needs to confirm with cost $${shipment.returnRequest.returnCost}.`,
            data: {
                returnRequest: shipment.returnRequest,
                returnCost: shipment.returnRequest.returnCost,
                isFreeReturn: shipment.returnRequest.isFreeReturn,
                modelType: model
            }
        });

    } catch (error) {
        console.error('Approve return error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Admin Reject Return Request - উভয় মডেলের জন্য
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

        // Find in either model
        let shipment = await NewShipment.findById(id).populate('customerId', 'email firstName lastName sender customerInfo');
        
        if (!shipment) {
            shipment = await Shipment.findById(id).populate('customerId', 'email firstName lastName');
        }
        
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

        // Get customer email
        const customerEmail = shipment.customerId?.email || 
                             shipment.sender?.email || 
                             shipment.customerInfo?.email;
        
        const customerName = shipment.customerId?.firstName || 
                            shipment.sender?.name || 
                            shipment.customerInfo?.name || 
                            'Customer';

        if (customerEmail) {
            await sendEmail({
                to: customerEmail,
                subject: `❌ Return Request Rejected - ${shipment.trackingNumber}`,
                html: `
                    <h2>Return Request Rejected</h2>
                    <p>Dear ${customerName},</p>
                    <p>Your return request for shipment <strong>${shipment.shipmentNumber}</strong> has been rejected.</p>
                    <p><strong>Reason:</strong> ${rejectionReason}</p>
                    <p>If you have any questions, please contact our support team.</p>
                `
            }).catch(err => console.log('Email error:', err.message));
        }

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
 * @desc    Get Return Request Statistics (Admin) - উভয় মডেল থেকে
 * @route   GET /api/v1/admin/return-requests/stats
 * @access  Private (Admin only)
 */
exports.getReturnStats = async (req, res) => {
    try {
        // Get stats from both models
        const [newStats, oldStats] = await Promise.all([
            NewShipment.aggregate([
                { $match: { 'returnRequest.status': { $ne: 'none' } } },
                { $group: {
                    _id: '$returnRequest.status',
                    count: { $sum: 1 },
                    totalCost: { $sum: '$returnRequest.returnCost' }
                }}
            ]),
            Shipment.aggregate([
                { $match: { 'returnRequest.status': { $ne: 'none' } } },
                { $group: {
                    _id: '$returnRequest.status',
                    count: { $sum: 1 },
                    totalCost: { $sum: '$returnRequest.returnCost' }
                }}
            ])
        ]);

        // Combine stats
        const statsMap = new Map();
        
        [...newStats, ...oldStats].forEach(item => {
            if (statsMap.has(item._id)) {
                const existing = statsMap.get(item._id);
                existing.count += item.count;
                existing.totalCost += item.totalCost;
            } else {
                statsMap.set(item._id, { ...item });
            }
        });

        const stats = Array.from(statsMap.values());
        
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