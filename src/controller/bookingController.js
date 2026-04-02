// controllers/bookingController.js

const Booking = require('../models/bookingModel');
const Shipment = require('../models/shipmentModel');
const Invoice = require('../models/invoiceModel');
const User = require('../models/userModel');
const { sendEmail } = require('../utils/emailService');
const { generateTrackingNumber } = require('../utils/trackingGenerator');
const mongoose = require('mongoose');
const { generateInvoicePDFBuffer } = require('../service/pdfGenerator'); 
// ========== HELPER FUNCTIONS ==========
// ==================== মিসিং হেল্পার ফাংশনগুলো ====================
// এই ফাংশনগুলো আপনার ফাইলের একদম উপরে, অন্যান্য হেল্পার ফাংশনের পরে যোগ করুন

// লোকেশন ডিটারমাইন ফাংশন
// const getLocationForStatus = (status, originalLocation, shipment) => {
//     // In Transit এর জন্য
//     if (status.includes('transit') || status === 'in_transit' || status === 'in_transit_sea_freight') {
//         if (shipment.consolidationId?.vesselName) {
//             return `In Transit - ${shipment.consolidationId.vesselName}`;
//         }
//         if (shipment.shipmentDetails?.destination) {
//             return `In Transit to ${shipment.shipmentDetails.destination}`;
//         }
//         return 'In Transit to Destination';
//     }
    
//     // Dispatched এর জন্য
//     if (status.includes('dispatch')) {
//         return 'Departed from Origin';
//     }
    
//     // Departed এর জন্য
//     if (status.includes('depart')) {
//         return 'Departed from Port';
//     }
    
//     // Arrived এর জন্য
//     if (status.includes('arrive')) {
//         return shipment.shipmentDetails?.destination || 'Arrived at Destination';
//     }
    
//     // Customs এর জন্য
//     if (status.includes('customs')) {
//         return 'Customs Clearance';
//     }
    
//     // Out for Delivery এর জন্য
//     if (status.includes('out_for_delivery')) {
//         return 'Out for Delivery';
//     }
    
//     // Delivered এর জন্য
//     if (status.includes('delivered')) {
//         return 'Delivered';
//     }
    
//     // China Warehouse হলে পরিবর্তন করুন
//     if (originalLocation === 'China Warehouse' || originalLocation === 'Warehouse') {
//         if (status.includes('receive')) {
//             return 'Origin Warehouse';
//         }
//         if (status.includes('consolidat')) {
//             return 'Consolidation Center';
//         }
//         if (status.includes('load')) {
//             return 'Loading Dock';
//         }
//         return 'Origin Facility';
//     }
    
//     return originalLocation || 'Location Unknown';
// };

// কনসলিডেশন লোকেশন ফাংশন
// const getConsolidationLocation = (event, shipment) => {
//     const status = event.status?.toLowerCase() || '';
    
//     if (status.includes('transit')) {
//         return shipment.consolidationId?.vesselName ? 
//             `In Transit - ${shipment.consolidationId.vesselName}` : 
//             'In Transit to Destination';
//     }
    
//     if (status.includes('depart') || status.includes('dispatch')) {
//         return 'Departed from Port';
//     }
    
//     if (status.includes('arrive')) {
//         return shipment.consolidationId?.destinationPort || 'Destination Port';
//     }
    
//     if (event.location === 'China Warehouse' || event.location === 'Warehouse') {
//         if (status.includes('consolidat')) {
//             return 'Consolidation Hub';
//         }
//         return 'Origin Facility';
//     }
    
//     return event.location || 'Facility';
// };

// ফরম্যাট ডেট ফাংশন (যদি না থাকে)
// const formatDate = (date) => {
//     if (!date) return 'N/A';
//     return new Date(date).toLocaleString('en-US', {
//         year: 'numeric',
//         month: 'short',
//         day: 'numeric',
//         hour: '2-digit',
//         minute: '2-digit'
//     });
// };
// Generate shipment number
async function generateShipmentNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    const count = await Shipment.countDocuments({
        shipmentNumber: new RegExp(`^SHP-${year}${month}`)
    });
    
    return `SHP-${year}${month}-${(count + 1).toString().padStart(5, '0')}`;
}

// Calculate customer total spent
const calculateCustomerTotalSpent = async (customerId) => {
    try {
        const result = await Booking.aggregate([
            { 
                $match: { 
                    customer: customerId,
                    status: 'delivered',
                    invoiceId: { $ne: null }
                } 
            },
            {
                $lookup: {
                    from: 'invoices',
                    localField: 'invoiceId',
                    foreignField: '_id',
                    as: 'invoice'
                }
            },
            { $unwind: '$invoice' },
            {
                $group: {
                    _id: null,
                    totalSpent: { $sum: '$invoice.totalAmount' }
                }
            }
        ]);

        return result.length > 0 ? result[0].totalSpent : 0;
    } catch (error) {
        console.error('Calculate total spent error:', error);
        return 0;
    }
};

// Calculate progress percentage
// const calculateProgress = (status) => {
//     const statusOrder = [
//         'booking_requested',
//         'price_quoted',
//         'booking_confirmed',
//         'pending',
//         'picked_up_from_warehouse',
//         'departed_port_of_origin',
//         'in_transit_sea_freight',
//         'arrived_at_destination_port',
//         'customs_cleared',
//         'out_for_delivery',
//         'delivered'
//     ];

//     const index = statusOrder.indexOf(status);
//     if (index === -1) return 0;
//     return Math.round((index / (statusOrder.length - 1)) * 100);
// };

// ========== 1. CREATE BOOKING (Customer) ==========
// controllers/bookingController.js - Fixed version

exports.createBooking = async (req, res) => {
    try {
        console.log('📥 Received booking data:', JSON.stringify(req.body, null, 2));

        const {
            customer,
            shipmentClassification,
            serviceType,
            shipmentDetails,
            dates,
            payment,
            sender,
            receiver,
            courier,
            status,
            pricingStatus,
            timeline
        } = req.body;

        // Validate required fields
        if (!shipmentDetails?.origin) {
            return res.status(400).json({
                success: false,
                error: 'Origin is required'
            });
        }
        
        if (!shipmentDetails?.destination) {
            return res.status(400).json({
                success: false,
                error: 'Destination is required'
            });
        }

        // Calculate totals from package details
        let totalPackages = 0;
        let totalWeight = 0;
        let totalVolume = 0;

        if (shipmentDetails?.packageDetails && shipmentDetails.packageDetails.length > 0) {
            totalPackages = shipmentDetails.packageDetails.length;
            totalWeight = shipmentDetails.packageDetails.reduce(
                (sum, item) => sum + (item.weight * item.quantity), 0
            );
            totalVolume = shipmentDetails.packageDetails.reduce(
                (sum, item) => sum + (item.volume * item.quantity), 0
            );
        }

        const bookingData = {
            customer: customer || req.user?._id,
            createdBy: req.user?._id || customer,
            
            shipmentClassification: shipmentClassification || {
                mainType: 'air_freight',
                subType: 'air_freight'
            },
            
            serviceType: serviceType || 'standard',
            
            shipmentDetails: {
                origin: shipmentDetails?.origin,
                destination: shipmentDetails?.destination,
                shippingMode: shipmentDetails?.shippingMode || 'DDU',
                packageDetails: shipmentDetails?.packageDetails || [],
                totalPackages,
                totalWeight,
                totalVolume,
                specialInstructions: shipmentDetails?.specialInstructions || '',
                referenceNumber: shipmentDetails?.referenceNumber || ''
            },
            
            dates: {
                requested: new Date(),
                estimatedDeparture: dates?.estimatedDeparture,
                estimatedArrival: dates?.estimatedArrival
            },
            
            payment: {
                mode: payment?.mode || 'bank_transfer',
                currency: payment?.currency || 'USD'
            },
            
            sender: sender || {},
            receiver: receiver || {},
            
            courier: courier || {
                company: 'Cargo Logistics Group',
                serviceType: serviceType || 'standard'
            },
            
            status: status || 'booking_requested',
            pricingStatus: pricingStatus || 'pending',
            shipmentStatus: 'pending',
            
            timeline: timeline || [{
                status: 'booking_requested',
                description: 'Booking request submitted',
                updatedBy: req.user?._id || customer,
                timestamp: new Date()
            }]
        };

        console.log('📦 Saving booking data:', JSON.stringify(bookingData, null, 2));

        const booking = new Booking(bookingData);
        await booking.save();
        
        // Populate customer info
        await booking.populate('customer', 'firstName lastName email companyName phone');

       // Send email to ALL Admins AND SMTP Email
const admins = await User.find({ role: 'admin', isActive: true });
const adminEmails = admins.map(admin => admin.email);

// Combine admin emails with SMTP email
let allRecipients = [...adminEmails];

// Add the SMTP email (support@cargologisticscompany.com)
if (process.env.SMTP_USER) {
    allRecipients.push(process.env.SMTP_USER);
}

// Remove duplicates (in case support email is also in admin list)
allRecipients = [...new Set(allRecipients)];

if (allRecipients.length > 0) {
    await sendEmail({
        to: allRecipients,  // Now contains both admin emails AND SMTP email
        subject: '🚨 New Booking Request Received',
        template: 'new-booking-notification',
        data: {
            bookingNumber: booking.bookingNumber,
            customerName: booking.sender?.name || 'Customer',
            origin: booking.shipmentDetails?.origin || 'N/A',
            destination: booking.shipmentDetails?.destination || 'N/A',
            totalPackages: booking.shipmentDetails?.totalPackages || 0,
            totalWeight: booking.shipmentDetails?.totalWeight || 0, 
            requestedDate: new Date().toLocaleString()
        }
    }).catch(err => console.error('Email error:', err));
    
    console.log('✅ Email sent to:', allRecipients);
}

        // Send confirmation to Customer
        if (booking.sender?.email) {
            await sendEmail({
                to: booking.sender.email,
                subject: '✅ Booking Request Received - Cargo Logistics',
                template: 'booking-received',
                data: {
                    bookingNumber: booking.bookingNumber,
                    customerName: booking.sender?.name,
                    origin: booking.sender?.address?.country,
                    destination: booking.receiver?.address?.country, 
                    supportEmail: process.env.SUPPORT_EMAIL
                }
            }).catch(err => console.error('Email error:', err));
        }

        res.status(201).json({
            success: true,
            message: 'Booking request submitted successfully',
            data: {
                bookingNumber: booking.bookingNumber,
                trackingNumber: booking.trackingNumber,
                status: booking.status,
                _id: booking._id
            }
        });

    } catch (error) {
        console.error('❌ Create booking error:', error);
        console.error('Error details:', error.message);
        
        // Check for validation errors
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 2. GET ALL BOOKINGS (Admin) ==========
exports.getAllBookings = async (req, res) => {
    try {
        const { status, page = 1, limit = 20, sort = '-createdAt', search } = req.query;
        
        let query = {};
        
        // Status filter
        if (status) query.status = status;
        
        // If customer, only show their bookings
        if (req.user.role === 'customer') {
            query.customer = req.user._id;
        }
        
        // SEARCH functionality - ADD THIS
        if (search && search.trim() !== '') {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { bookingNumber: searchRegex },
                { trackingNumber: searchRegex },
                { 'sender.name': searchRegex },
                { 'sender.companyName': searchRegex },
                { 'sender.email': searchRegex },
                { 'sender.phone': searchRegex },
                { 'receiver.name': searchRegex },
                { 'receiver.companyName': searchRegex },
                { 'receiver.email': searchRegex },
                { 'receiver.phone': searchRegex },
                { 'specialInstructions': searchRegex }
            ];
            
            // Also search by customer name (if populated)
            // Note: This requires a separate approach or population first
        }
        
        console.log('Search query:', search); // Debug log
        console.log('MongoDB query:', JSON.stringify(query)); // Debug log
        
        const bookings = await Booking.find(query)
            .populate('customer', 'firstName lastName companyName email phone')
            .populate('quotedPrice.quotedBy', 'firstName lastName')
            .populate('shipmentId', 'trackingNumber status')
            .populate('invoiceId', 'invoiceNumber totalAmount paymentStatus')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));
            
        const total = await Booking.countDocuments(query);
        
        res.status(200).json({
            success: true,
            data: bookings,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get all bookings error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 3. GET SINGLE BOOKING ==========
exports.getBookingById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const booking = await Booking.findById(id)
            .populate('customer', 'firstName lastName companyName email phone address')
            .populate('quotedPrice.quotedBy', 'firstName lastName email')
            .populate('shipmentId')
            .populate('invoiceId')
            .populate('timeline.updatedBy', 'firstName lastName role');
            
        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }
        
        // Check permission (customer can only see their own)
        if (req.user.role === 'customer' && booking.customer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }
        
        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error) {
        console.error('Get booking by id error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 4. UPDATE PRICE QUOTE (Admin) ==========
// ========== 4. UPDATE PRICE QUOTE (Admin) ==========
exports.updatePriceQuote = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, currency, breakdown, validUntil, notes } = req.body;

        const booking = await Booking.findById(id)
            .populate('customer', 'email firstName lastName companyName');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        // Check if booking can be updated
        if (booking.status === 'booking_confirmed' || booking.status === 'cancelled' || booking.status === 'rejected') {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot update price quote for booking with status: ${booking.status}` 
            });
        }

        // Check if this is an update or first quote
        const isUpdate = booking.quotedPrice && booking.quotedPrice.amount;
        
        // Save previous quote history safely
        let previousQuotes = [];
        if (isUpdate && booking.quotedPrice) {
            previousQuotes = [
                ...(booking.quotedPrice.previousQuotes || []),
                {
                    amount: booking.quotedPrice.amount,
                    currency: booking.quotedPrice.currency,
                    quotedAt: booking.quotedPrice.quotedAt,
                    quotedBy: booking.quotedPrice.quotedBy,
                    notes: booking.quotedPrice.notes
                }
            ];
        }

        // Store previous amount safely for timeline message
        const previousAmount = isUpdate && booking.quotedPrice && booking.quotedPrice.amount 
            ? booking.quotedPrice.amount 
            : null;

        // Update price quote
        booking.quotedPrice = {
            amount,
            currency,
            breakdown: breakdown || {
                baseRate: 0,
                weightCharge: 0,
                fuelSurcharge: 0,
                residentialSurcharge: 0,
                insurance: 0,
                tax: 0,
                otherCharges: 0
            },
            quotedBy: req.user._id,
            quotedAt: new Date(),
            validUntil: validUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            notes,
            previousQuotes: previousQuotes
        };
        
        booking.pricingStatus = 'quoted';
        
        // Update booking status only if it's first quote
        if (booking.status === 'booking_requested') {
            booking.status = 'price_quoted';
        }
        
        // Create timeline entry with safe metadata
        const timelineMessage = isUpdate 
            ? `Price quote updated: ${currency} ${amount}${previousAmount ? ` (Previous: ${currency} ${previousAmount})` : ''}`
            : `Price quoted: ${currency} ${amount}`;
        
        booking.addTimelineEntry(
            'price_quoted',
            timelineMessage,
            req.user._id,
            { 
                amount, 
                currency, 
                isUpdate: isUpdate,
                previousAmount: previousAmount,
                quotedAt: new Date()
            }
        );

        await booking.save();

        // Send email notification
        if (booking.customer?.email) {
            await sendEmail({
                to: booking.customer.email,
                subject: `💰 ${isUpdate ? 'Updated' : 'New'} Price Quote for Your Booking`,
                template: 'price-quote-ready',
                data: {
                    bookingNumber: booking.bookingNumber,
                    customerName: booking.customer.firstName || 'Customer',
                    quotedAmount: amount,
                    currency: currency,
                    validUntil: booking.quotedPrice.validUntil,
                    breakdown: breakdown,
                    isUpdate: isUpdate,
                    previousAmount: previousAmount
                }
            }).catch(err => console.error('Email error:', err));
        }

        res.status(200).json({
            success: true,
            message: isUpdate ? 
                'Price quote updated successfully' : 
                'Price quote sent to customer',
            data: booking
        });

    } catch (error) {
        console.error('Update price quote error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 5. ACCEPT QUOTE (Customer) ==========
// controllers/bookingController.js - সম্পূর্ণ আপডেটেড Shipment Creation অংশ

exports.acceptQuote = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        console.log('🚀 ===== ACCEPT QUOTE STARTED =====');
        console.log('1. Booking ID:', id);
        
        const booking = await Booking.findById(id)
            .populate('customer', 'email firstName lastName companyName phone');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        console.log('2. Booking found:', booking.bookingNumber);
        console.log('3. Customer email:', booking.customer?.email);

        // Security check
        if (booking.customer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: 'You can only accept your own bookings' 
            });
        }

        if (booking.pricingStatus !== 'quoted') {
            return res.status(400).json({ 
                success: false, 
                message: 'No active price quote found' 
            });
        }

        // Check if quote is still valid
        if (!booking.isQuoteValid()) {
            booking.pricingStatus = 'expired';
            await booking.save();
            return res.status(400).json({ 
                success: false, 
                message: 'Price quote has expired' 
            });
        }

        // Update booking
        booking.customerResponse = {
            status: 'accepted',
            respondedAt: new Date(),
            notes: notes,
            ipAddress: req.ip
        };
        
        booking.pricingStatus = 'accepted';
        booking.status = 'booking_confirmed';
        booking.dates.confirmed = new Date();
        
        // Generate tracking number
        let trackingNumber;
        try {
            trackingNumber = await generateTrackingNumber();
            console.log('4. Tracking number generated:', trackingNumber);
        } catch (tnError) {
            console.error('Tracking number error:', tnError);
            trackingNumber = `TRK${Date.now()}${Math.floor(Math.random() * 1000)}`;
        }
        
        booking.trackingNumber = trackingNumber;
        
        booking.addTimelineEntry(
            'booking_confirmed',
            `Customer accepted quote. Booking confirmed. Tracking: ${trackingNumber}`,
            req.user._id
        );

        await booking.save();
        console.log('5. Booking saved successfully');

        // ===== STEP 1: CREATE SHIPMENT (COMPLETE DATA) =====
        console.log('6. Creating shipment with complete booking data...');
        
        let shipment = null;
        try {
            const shipmentNumber = await generateShipmentNumber();
            
            console.log('📋 Booking Data Summary:', {
                bookingNumber: booking.bookingNumber,
                shipmentClassification: booking.shipmentClassification,
                shipmentDetails: {
                    origin: booking.shipmentDetails?.origin,
                    destination: booking.shipmentDetails?.destination,
                    shippingMode: booking.shipmentDetails?.shippingMode,
                    totalPackages: booking.shipmentDetails?.totalPackages,
                    totalWeight: booking.shipmentDetails?.totalWeight,
                    totalVolume: booking.shipmentDetails?.totalVolume
                },
                packageCount: booking.shipmentDetails?.packageDetails?.length || 0
            });

            const packages = (booking.shipmentDetails?.packageDetails || []).map(item => ({
                description: item.description || '',
                packagingType: item.packagingType || 'carton',
                quantity: item.quantity || 1,
                weight: item.weight || 0,
                volume: item.volume || 0,
                dimensions: {
                    length: item.dimensions?.length || 0,
                    width: item.dimensions?.width || 0,
                    height: item.dimensions?.height || 0,
                    unit: item.dimensions?.unit || 'cm'
                },
                productCategory: item.productCategory || 'Others',
                hsCode: item.hsCode || '',
                value: {
                    amount: item.value?.amount || 0,
                    currency: item.value?.currency || 'USD'
                },
                hazardous: item.hazardous || false,
                temperatureControlled: {
                    required: item.temperatureControlled?.required || false,
                    minTemp: item.temperatureControlled?.minTemp || null,
                    maxTemp: item.temperatureControlled?.maxTemp || null
                },
                condition: 'Good'
            }));

            console.log(`   ✅ Prepared ${packages.length} packages with complete data`);

            const shipmentData = {
                shipmentNumber: shipmentNumber,
                trackingNumber: trackingNumber,
                bookingId: booking._id,
                customerId: booking.customer._id,
                createdBy: req.user._id,
                
                shipmentClassification: {
                    mainType: booking.shipmentClassification?.mainType || 'air_freight',
                    subType: booking.shipmentClassification?.subType || 'air_freight'
                },
                
                shipmentDetails: {
                    origin: booking.shipmentDetails?.origin || '',
                    destination: booking.shipmentDetails?.destination || '',
                    shippingMode: booking.shipmentDetails?.shippingMode || 'DDU',
                    totalPackages: booking.shipmentDetails?.totalPackages || packages.length,
                    totalWeight: booking.shipmentDetails?.totalWeight || 0,
                    totalVolume: booking.shipmentDetails?.totalVolume || 0
                },
                
                packages: packages,
                
                sender: {
                    name: booking.sender?.name || '',
                    companyName: booking.sender?.companyName || '',
                    email: booking.sender?.email || '',
                    phone: booking.sender?.phone || '',
                    address: {
                        addressLine1: booking.sender?.address?.addressLine1 || '',
                        addressLine2: booking.sender?.address?.addressLine2 || '',
                        city: booking.sender?.address?.city || '',
                        state: booking.sender?.address?.state || '',
                        country: booking.sender?.address?.country || '',
                        postalCode: booking.sender?.address?.postalCode || ''
                    }
                },
                
                receiver: {
                    name: booking.receiver?.name || '',
                    companyName: booking.receiver?.companyName || '',
                    email: booking.receiver?.email || '',
                    phone: booking.receiver?.phone || '',
                    address: {
                        addressLine1: booking.receiver?.address?.addressLine1 || '',
                        addressLine2: booking.receiver?.address?.addressLine2 || '',
                        city: booking.receiver?.address?.city || '',
                        state: booking.receiver?.address?.state || '',
                        country: booking.receiver?.address?.country || '',
                        postalCode: booking.receiver?.address?.postalCode || ''
                    },
                    isResidential: booking.receiver?.isResidential || false
                },
                
                courier: {
                    company: booking.courier?.company || 'Cargo Logistics Group',
                    serviceType: booking.courier?.serviceType || booking.serviceType || 'standard'
                },
                
                dates: {
                    estimatedDeparture: booking.dates?.estimatedDeparture || null,
                    estimatedArrival: booking.dates?.estimatedArrival || null
                },
                
                status: 'pending',
                
                transport: {
                    estimatedDeparture: booking.dates?.estimatedDeparture,
                    estimatedArrival: booking.dates?.estimatedArrival
                },
                
                milestones: [{
                    status: 'pending',
                    location: booking.sender?.address?.country || 'Warehouse',
                    description: 'Shipment created from confirmed booking',
                    updatedBy: req.user._id,
                    timestamp: new Date()
                }],
                
                bookingNumber: booking.bookingNumber,
                serviceType: booking.serviceType
            };

            console.log('   Creating shipment with complete data...');
            
            shipment = await Shipment.create(shipmentData);
            
            console.log('   ✅ Shipment created successfully:', {
                id: shipment._id,
                number: shipment.shipmentNumber,
                tracking: shipment.trackingNumber,
                packages: shipment.packages?.length,
                totalWeight: shipment.shipmentDetails?.totalWeight
            });
            
            booking.shipmentId = shipment._id;
            await booking.save();
            
            console.log('   ✅ Booking updated with shipment ID');

            try {
                const warehouseStaff = await User.find({ 
                    role: 'warehouse', 
                    isActive: true 
                });
                
                if (warehouseStaff.length > 0) {
                    await sendEmail({
                        to: warehouseStaff.map(w => w.email),
                        subject: '📦 New Shipment Ready for Warehouse Processing',
                        template: 'new-shipment-notification',
                        data: {
                            trackingNumber: trackingNumber,
                            customerName: booking.sender?.name || 'Customer',
                            origin: booking.shipmentDetails?.origin || 'N/A',
                            destination: booking.shipmentDetails?.destination || 'N/A',
                            packages: packages.length,
                            totalWeight: booking.shipmentDetails?.totalWeight || 0,
                            totalVolume: booking.shipmentDetails?.totalVolume || 0,
                            shipmentType: booking.shipmentClassification?.mainType || 'N/A',
                            bookingNumber: booking.bookingNumber,
                            expectedDate: new Date(booking.dates?.estimatedArrival || Date.now()).toLocaleDateString(),
                        }
                    }).catch(err => console.log('   ⚠️ Warehouse email error:', err.message));
                }
            } catch (staffError) {
                console.log('   ⚠️ Error notifying warehouse staff:', staffError.message);
            }

        } catch (shipmentError) {
            console.error('❌ Shipment creation error:', shipmentError);
            
            if (shipmentError.name === 'ValidationError') {
                console.error('   Validation errors:');
                Object.keys(shipmentError.errors).forEach(key => {
                    console.error(`   - ${key}: ${shipmentError.errors[key].message}`);
                    console.error(`     Value:`, shipmentError.errors[key].value);
                });
            }
            
            if (shipmentError.code === 11000) {
                console.error('   Duplicate key error:', shipmentError.keyValue);
            }
        }

        // ===== STEP 2: CREATE INVOICE AND GENERATE PDF =====
// ===== STEP 2: CREATE INVOICE AND GENERATE PDF =====
console.log('7. Creating invoice and generating PDF...');

let invoice = null;
let pdfBuffer = null;

try {
    const breakdown = booking.quotedPrice?.breakdown || {};
    
    const charges = [];
    
    const chargeMappings = [
        { field: 'baseRate', description: 'Base shipping rate', type: 'Freight Cost' },
        { field: 'weightCharge', description: 'Weight-based charge', type: 'Weight Charge' },
        { field: 'fuelSurcharge', description: 'Fuel surcharge', type: 'Fuel Surcharge' },
        { field: 'residentialSurcharge', description: 'Residential delivery surcharge', type: 'Residential Surcharge' },
        { field: 'insurance', description: 'Cargo insurance', type: 'Insurance' },
        { field: 'tax', description: 'Tax/VAT', type: 'Tax' },
        { field: 'otherCharges', description: 'Other miscellaneous charges', type: 'Other' }
    ];

    chargeMappings.forEach(mapping => {
        if (breakdown[mapping.field] && breakdown[mapping.field] > 0) {
            charges.push({
                description: mapping.description,
                type: mapping.type,
                amount: breakdown[mapping.field],
                currency: booking.quotedPrice?.currency || 'USD'
            });
        }
    });

    if (charges.length === 0 && booking.quotedPrice?.amount) {
        charges.push({
            description: 'Total shipping cost including all services',
            type: 'Freight Cost',
            amount: booking.quotedPrice.amount,
            currency: booking.quotedPrice.currency || 'USD'
        });
    }

    const subtotal = charges.reduce((sum, charge) => sum + charge.amount, 0);

    const invoiceData = {
        bookingId: booking._id,
        shipmentId: shipment?._id,
        customerId: booking.customer._id,
        
        customerInfo: {
            companyName: booking.sender?.companyName || '',
            contactPerson: booking.sender?.name || '',
            email: booking.sender?.email,
            phone: booking.sender?.phone || '',
            address: booking.sender?.address?.addressLine1 || ''
        },
        
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        
        charges: charges,
        subtotal: subtotal,
        totalAmount: subtotal,
        
        currency: booking.quotedPrice?.currency || 'USD',
        paymentStatus: 'pending',
        status: 'draft',
        paymentTerms: 'Due within 30 days',
        
        createdBy: req.user._id
    };

    // 🔥 গুরুত্বপূর্ণ: invoiceNumber সেট করছি না - model auto-generate করবে
    invoice = await Invoice.create(invoiceData);
    
    booking.invoiceId = invoice._id;
    await booking.save();
    
    console.log('   ✅ Invoice created:', {
        id: invoice._id,
        number: invoice.invoiceNumber,
        amount: invoice.totalAmount
    });

    // ===== GENERATE PDF =====
    console.log('   📄 Generating PDF invoice...');
    try {
        
        
        const companyInfo = {
            name: 'Cargo Logistics Group',
            address: '123 Business Avenue, Commercial Area',
            city: 'Dhaka, Bangladesh 1212',
            phone: '+880 1234-567890',
            email: 'info@cargologistics.com',
            website: 'www.cargologistics.com'
        };
        
        pdfBuffer = await generateInvoicePDFBuffer(invoice, companyInfo);
        console.log('   ✅ PDF generated successfully, size:', pdfBuffer.length, 'bytes');
        
        invoice.pdfGeneratedAt = new Date();
        invoice.pdfSize = pdfBuffer.length;
        await invoice.save();
        
    } catch (pdfError) {
        console.error('   ❌ PDF generation failed:', pdfError.message);
    }

} catch (invoiceError) {
    console.error('❌ Invoice creation error:', invoiceError.message);
}

        // ===== STEP 3: Send Emails with PDF Attachment =====
        // ===== STEP 3: Send Emails with PDF Attachment =====
console.log('8. Sending confirmation emails with PDF...');
console.log('   📧 PDF Buffer status:', pdfBuffer ? `${pdfBuffer.length} bytes` : 'NOT GENERATED');

// Customer Email with PDF Attachment
if (booking.sender?.email) {
    const emailData = {
        to: booking.sender.email,
        subject: '🎉 Booking Confirmed! - Cargo Logistics',
        template: 'booking-confirmed-customer',
        data: {
            customerName: booking.sender?.name || 'Customer',
            bookingNumber: booking.bookingNumber,
            trackingNumber: trackingNumber,
            quotedAmount: booking.quotedPrice?.amount || 0,
            currency: booking.quotedPrice?.currency || 'USD',
            invoiceNumber: invoice?.invoiceNumber || 'N/A',
            origin: booking.shipmentDetails?.origin || 'N/A',
            destination: booking.shipmentDetails?.destination || 'N/A',
            estimatedDelivery: booking.dates?.estimatedArrival ? 
                new Date(booking.dates.estimatedArrival).toLocaleDateString() : 
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()
        }
    };
    
    // ✅ PDF attachment যোগ করুন (যদি buffer থাকে)
    if (pdfBuffer && invoice && invoice.invoiceNumber) {
        emailData.attachments = [{
            filename: `invoice-${invoice.invoiceNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
            encoding: 'utf-8'
        }];
        console.log('   📎 PDF attachment added to customer email:', `invoice-${invoice.invoiceNumber}.pdf`);
    } else {
        console.log('   ⚠️ No PDF attachment - pdfBuffer:', !!pdfBuffer, 'invoice:', !!invoice);
    }
    
    try {
        await sendEmail(emailData);
        console.log('✅ Customer email sent to:', booking.sender.email);
    } catch (emailError) {
        console.error('❌ Customer email error:', emailError.message);
    }
}

        // Receiver Email
        if (booking.receiver?.email) {
            try {
                await sendEmail({
                    to: booking.receiver.email,
                    subject: '📦 Your Shipment is Confirmed - Cargo Logistics',
                    template: 'receiver-shipment-confirmed',
                    data: {
                        receiverName: booking.receiver.name || 'Valued Customer',
                        receiverCompany: booking.receiver.companyName || '',
                        senderName: booking.sender?.name || 'Our Customer',
                        senderCompany: booking.sender?.companyName || '',
                        senderCountry: booking.sender?.address?.country || 'Unknown',
                        bookingNumber: booking.bookingNumber,
                        trackingNumber: trackingNumber,
                        origin: booking.shipmentDetails?.origin || 'Origin',
                        destination: booking.shipmentDetails?.destination || 'Destination',
                        totalPackages: booking.shipmentDetails?.totalPackages || 0,
                        totalWeight: booking.shipmentDetails?.totalWeight || 0,
                        estimatedDelivery: booking.dates?.estimatedArrival ? 
                            new Date(booking.dates.estimatedArrival).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            }) : 
                            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            })
                    }
                });
                console.log('✅ Receiver email sent successfully to:', booking.receiver.email);
            } catch (emailError) {
                console.error('❌ Failed to send receiver email:', emailError.message);
            }
        }

        // Admin Emails with PDF Attachment
        const admins = await User.find({ role: 'admin', isActive: true });
        let allRecipients = admins.map(a => a.email);
        
        if (process.env.SMTP_USER) {
            allRecipients.push(process.env.SMTP_USER);
        }
        
        allRecipients = [...new Set(allRecipients)];

        if (allRecipients.length > 0) {
            const adminEmailData = {
                to: allRecipients,
                subject: '✅ Booking Confirmed - Action Required',
                template: 'booking-confirmed-admin',
                data: {
                    bookingNumber: booking.bookingNumber,
                    customerName: booking.sender?.name || 'Customer',
                    trackingNumber: trackingNumber,
                    origin: booking.shipmentDetails?.origin || 'N/A',
                    destination: booking.shipmentDetails?.destination || 'N/A',
                    invoiceNumber: invoice?.invoiceNumber || 'N/A',
                    totalAmount: invoice?.totalAmount || 0,
                    currency: invoice?.currency || 'USD'
                }
            };
            
            if (pdfBuffer && invoice) {
                adminEmailData.attachments = [{
                    filename: `invoice-${invoice.invoiceNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }];
                console.log('   📎 PDF attachment added to admin email');
            }
            
            await sendEmail(adminEmailData).catch(err => console.log('Admin email error:', err.message));
            console.log('✅ Admin email sent to:', allRecipients);
        }

        console.log('9. ✅ Accept quote completed successfully');
        
        res.status(200).json({
            success: true,
            message: 'Booking confirmed successfully. Shipment and invoice created. PDF invoice sent via email.',
            data: {
                booking: {
                    _id: booking._id,
                    bookingNumber: booking.bookingNumber,
                    status: booking.status,
                    trackingNumber: booking.trackingNumber,
                    shipmentId: booking.shipmentId,
                    invoiceId: booking.invoiceId
                },
                shipment: shipment ? {
                    _id: shipment._id,
                    shipmentNumber: shipment.shipmentNumber,
                    trackingNumber: shipment.trackingNumber,
                    status: shipment.status
                } : null,
                invoice: invoice ? {
                    _id: invoice._id,
                    invoiceNumber: invoice.invoiceNumber,
                    totalAmount: invoice.totalAmount,
                    currency: invoice.currency,
                    pdfGenerated: !!pdfBuffer
                } : null
            }
        });

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 6. REJECT QUOTE (Customer) ==========
exports.rejectQuote = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const booking = await Booking.findById(id)
            .populate('customer', 'email firstName lastName companyName');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        if (booking.customer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }

        if (booking.pricingStatus !== 'quoted') {
            return res.status(400).json({ 
                success: false, 
                message: 'No active price quote found' 
            });
        }

        booking.customerResponse = {
            status: 'rejected',
            respondedAt: new Date(),
            notes: reason,
            ipAddress: req.ip
        };
        
        booking.pricingStatus = 'rejected';
        booking.status = 'rejected';
        
        booking.addTimelineEntry(
            'rejected',
            `Customer rejected quote. Reason: ${reason || 'Not specified'}`,
            req.user._id
        );

        await booking.save();

        // Get all active admin users
const admins = await User.find({ role: 'admin', isActive: true });

// Prepare recipients - combine admin emails with SMTP email
let allRecipients = admins.map(admin => admin.email);

// Add SMTP email (support@cargologisticscompany.com)
if (process.env.SMTP_USER) {
    allRecipients.push(process.env.SMTP_USER);
}

// Remove duplicates
allRecipients = [...new Set(allRecipients)];

if (allRecipients.length > 0) {
    await sendEmail({
        to: allRecipients,  // অ্যাডমিন + SMTP ইমেইল
        subject: '❌ Quote Rejected by Customer',
        template: 'quote-rejected',
        data: {
            bookingNumber: booking.bookingNumber,
            customerName: booking.sender?.name || 'Customer',
            reason: reason || 'No reason provided',
            // dashboardUrl: `${process.env.FRONTEND_URL}/admin/bookings/${booking._id}`
        }
    }).catch(err => console.log('Quote rejection email error:', err.message));
    
    console.log('✅ Quote rejection email sent to:', allRecipients);
}

        if (booking.sender?.email) {
            await sendEmail({
                to: booking.sender.email,
                subject: 'Quote Rejection Confirmed',
                template: 'booking-rejected-customer',
                data: {
                    bookingNumber: booking.bookingNumber,
                    customerName: booking.sender?.name,
                    reason: reason || 'No reason provided',
                    // dashboardUrl: `${process.env.FRONTEND_URL}/customer/dashboard`,
                    supportEmail: process.env.SUPPORT_EMAIL
                }
            });
        }

        res.status(200).json({
            success: true,
            message: 'Quote rejected successfully',
            data: {
                bookingNumber: booking.bookingNumber,
                status: booking.status
            }
        });

    } catch (error) {
        console.error('Reject quote error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 7. CANCEL BOOKING ==========
exports.cancelBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const booking = await Booking.findById(id)
            .populate('customer', 'email firstName lastName companyName');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        if (req.user.role === 'customer' && booking.customer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }

        if (booking.status === 'booking_confirmed') {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot cancel confirmed booking. Please contact support.' 
            });
        }

        booking.status = 'cancelled';
        booking.dates.cancelled = new Date();
        booking.cancellationReason = reason;
        
        booking.addTimelineEntry(
            'cancelled',
            `Booking cancelled. Reason: ${reason || 'Not specified'}`,
            req.user._id
        );

        await booking.save();

        if (req.user.role === 'customer') {
            const admins = await User.find({ role: 'admin', isActive: true });
            
            if (admins.length > 0) {
                await sendEmail({
                    to: admins.map(a => a.email),
                    subject: '🚫 Booking Cancelled by Customer',
                    template: 'booking-cancelled',
                    data: {
                        bookingNumber: booking.bookingNumber,
                        customerName: booking.sender?.name || 'Customer',
                        reason: reason || 'No reason provided',
                        // dashboardUrl: `${process.env.FRONTEND_URL}/admin/bookings/${booking._id}`
                    }
                });
            }

            if (booking.sender?.email) {
                await sendEmail({
                    to: booking.sender.email,
                    subject: 'Your Booking Has Been Cancelled',
                    template: 'booking-cancelled-customer',
                    data: {
                        bookingNumber: booking.bookingNumber,
                        customerName: booking.sender?.name,
                        reason: reason || 'No reason provided',
                        // dashboardUrl: `${process.env.FRONTEND_URL}/customer/dashboard`,
                        supportEmail: process.env.SUPPORT_EMAIL
                    }
                });
            }
        }

        res.status(200).json({
            success: true,
            message: 'Booking cancelled successfully',
            data: {
                bookingNumber: booking.bookingNumber,
                status: booking.status
            }
        });

    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== 8. GET MY BOOKINGS (Customer) ==========
exports.getMyBookings = async (req, res) => {
    try {
        const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query;

        let query = { customer: req.user._id };
        if (status) query.status = status;

        const total = await Booking.countDocuments(query);

        const bookings = await Booking.find(query)
            .populate('quotedPrice.quotedBy', 'firstName lastName')
            .populate('shipmentId', 'trackingNumber status')
            .populate('invoiceId', 'invoiceNumber totalAmount paymentStatus')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const summary = {
            total: total,
            activeBookings: await Booking.countDocuments({ 
                customer: req.user._id,
                status: { $in: ['booking_requested', 'price_quoted', 'booking_confirmed'] }
            }),
            completedBookings: await Booking.countDocuments({ 
                customer: req.user._id,
                status: 'delivered' 
            }),
            pendingQuotes: await Booking.countDocuments({ 
                customer: req.user._id,
                pricingStatus: 'quoted',
                customerResponse: { $ne: 'accepted' }
            }),
            totalSpent: await calculateCustomerTotalSpent(req.user._id)
        };

        res.status(200).json({
            success: true,
            summary,
            data: bookings,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get my bookings error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 9. GET MY BOOKING BY ID (Customer) ==========
exports.getMyBookingById = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await Booking.findOne({
            _id: id,
            customer: req.user._id
        })
        .populate('quotedPrice.quotedBy', 'firstName lastName')
        .populate('shipmentId')
        .populate('invoiceId')
        .populate('timeline.updatedBy', 'firstName lastName role');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        const daysSinceBooking = Math.floor(
            (Date.now() - new Date(booking.createdAt)) / (1000 * 60 * 60 * 24)
        );

        const isQuoteValid = booking.isQuoteValid ? booking.isQuoteValid() : false;

        res.status(200).json({
            success: true,
            data: {
                booking,
                additionalInfo: {
                    daysSinceBooking,
                    isQuoteValid,
                    canAccept: booking.pricingStatus === 'quoted' && isQuoteValid,
                    canCancel: ['booking_requested', 'price_quoted'].includes(booking.status)
                }
            }
        });

    } catch (error) {
        console.error('Get my booking by id error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 10. GET MY BOOKING TIMELINE ==========
exports.getMyBookingTimeline = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await Booking.findOne({
            _id: id,
            customer: req.user._id
        })
        .select('bookingNumber status timeline createdAt updatedAt');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        const timeline = booking.timeline.map(entry => ({
            status: entry.status,
            description: entry.description,
            date: entry.timestamp,
            formattedDate: new Date(entry.timestamp).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short'
            })
        }));

        res.status(200).json({
            success: true,
            data: {
                bookingNumber: booking.bookingNumber,
                currentStatus: booking.status,
                timeline: timeline.sort((a, b) => b.date - a.date)
            }
        });

    } catch (error) {
        console.error('Get booking timeline error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 11. GET MY BOOKING INVOICE ==========
exports.getMyBookingInvoice = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await Booking.findOne({
            _id: id,
            customer: req.user._id
        }).populate({
            path: 'invoiceId',
            select: 'invoiceNumber totalAmount currency paymentStatus dueDate createdAt charges'
        });

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        if (!booking.invoiceId) {
            return res.status(404).json({ 
                success: false, 
                message: 'No invoice found for this booking' 
            });
        }

        res.status(200).json({
            success: true,
            data: booking.invoiceId
        });

    } catch (error) {
        console.error('Get booking invoice error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 12. GET BOOKING QUOTE DETAILS ==========
exports.getMyBookingQuote = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await Booking.findOne({
            _id: id,
            customer: req.user._id
        })
        .populate('quotedPrice.quotedBy', 'firstName lastName email')
        .select('bookingNumber quotedPrice pricingStatus customerResponse');

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        if (!booking.quotedPrice || booking.pricingStatus === 'pending') {
            return res.status(404).json({ 
                success: false, 
                message: 'Quote not yet available for this booking' 
            });
        }

        const isValid = booking.isQuoteValid ? booking.isQuoteValid() : 
            (booking.quotedPrice.validUntil && new Date() <= booking.quotedPrice.validUntil);

        res.status(200).json({
            success: true,
            data: {
                bookingNumber: booking.bookingNumber,
                pricingStatus: booking.pricingStatus,
                quotedPrice: booking.quotedPrice,
                customerResponse: booking.customerResponse,
                isValid,
                timeRemaining: isValid ? 
                    Math.floor((booking.quotedPrice.validUntil - Date.now()) / (1000 * 60 * 60 * 24)) : 0
            }
        });

    } catch (error) {
        console.error('Get booking quote error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 13. GET MY BOOKINGS SUMMARY (Dashboard) ==========
exports.getMyBookingsSummary = async (req, res) => {
    try {
        const userId = req.user._id;

        const recentBookings = await Booking.find({ customer: userId })
            .sort('-createdAt')
            .limit(5)
            .select('bookingNumber status createdAt shipmentDetails.totalPackages sender receiver');

        const statusCounts = await Booking.aggregate([
            { $match: { customer: userId } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        const pendingQuote = await Booking.findOne({
            customer: userId,
            pricingStatus: 'quoted',
            customerResponse: { $ne: 'accepted' }
        })
        .sort('-quotedPrice.quotedAt')
        .select('bookingNumber quotedPrice');

        const activeShipment = await Booking.findOne({
            customer: userId,
            status: 'booking_confirmed',
            shipmentId: { $ne: null }
        })
        .populate('shipmentId', 'trackingNumber status currentLocation')
        .sort('-confirmedAt');

        const statusSummary = {
            total: 0,
            requested: 0,
            quoted: 0,
            confirmed: 0,
            delivered: 0,
            cancelled: 0
        };

        statusCounts.forEach(item => {
            statusSummary.total += item.count;
            if (item._id === 'booking_requested') statusSummary.requested = item.count;
            if (item._id === 'price_quoted') statusSummary.quoted = item.count;
            if (item._id === 'booking_confirmed') statusSummary.confirmed = item.count;
            if (item._id === 'delivered') statusSummary.delivered = item.count;
            if (item._id === 'cancelled') statusSummary.cancelled = item.count;
        });

        res.status(200).json({
            success: true,
            data: {
                summary: statusSummary,
                recentBookings,
                pendingQuote: pendingQuote || null,
                activeShipment: activeShipment || null
            }
        });

    } catch (error) {
        console.error('Get bookings summary error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};
// ========== 1. GET ALL INVOICES (Admin Only) ==========
exports.getAllInvoices = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            status, 
            paymentStatus,
            customerId,
            startDate,
            endDate,
            sort = '-createdAt' 
        } = req.query;

        // Build filter query
        let filter = {};
        
        if (status) filter.status = status;
        if (paymentStatus) filter.paymentStatus = paymentStatus;
        if (customerId) filter.customerId = customerId;
        
        // Date range filter
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        // Get total count
        const total = await Invoice.countDocuments(filter);

        // Get invoices with pagination
        const invoices = await Invoice.find(filter)
            .populate('customerId', 'firstName lastName companyName email phone')
            .populate('bookingId', 'bookingNumber')
            .populate('createdBy', 'firstName lastName')
            .populate('updatedBy', 'firstName lastName')
            .sort(sort)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        // Calculate summary
        const summary = await Invoice.aggregate([
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$totalAmount' },
                    paidAmount: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$totalAmount', 0]
                        }
                    },
                    pendingAmount: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'pending'] }, '$totalAmount', 0]
                        }
                    },
                    overdueAmount: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'overdue'] }, '$totalAmount', 0]
                        }
                    },
                    count: { $sum: 1 },
                    paidCount: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0]
                        }
                    },
                    pendingCount: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0]
                        }
                    },
                    overdueCount: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'overdue'] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: invoices,
            summary: summary[0] || {
                totalAmount: 0,
                paidAmount: 0,
                pendingAmount: 0,
                overdueAmount: 0,
                count: 0,
                paidCount: 0,
                pendingCount: 0,
                overdueCount: 0
            },
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get all invoices error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 2. GET INVOICE BY ID ==========
exports.getInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;

        const invoice = await Invoice.findById(id)
            .populate('customerId', 'firstName lastName companyName email phone address')
            .populate('bookingId')
            .populate('shipmentId')
            .populate('createdBy', 'firstName lastName email')
            .populate('updatedBy', 'firstName lastName email');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Check permission (customer can only see their own)
        if (req.user.role === 'customer' && invoice.customerId._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own invoices.'
            });
        }

        res.status(200).json({
            success: true,
            data: invoice
        });

    } catch (error) {
        console.error('Get invoice by id error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 3. GET INVOICES BY CUSTOMER ==========
// ========== 3. GET INVOICES BY CUSTOMER ==========
// controllers/invoiceController.js
exports.getInvoicesByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status } = req.query;
    
    let query = {};
    
    // Check if customerId is a valid MongoDB ObjectId
    const isValidObjectId = mongoose.Types.ObjectId.isValid(customerId);
    
    if (isValidObjectId) {
      query.customerId = customerId;
    } else {
      query.$or = [
        { customerCode: customerId },
        { customerNumber: customerId },
        { 'customerInfo.customerId': customerId },
        { customerId: customerId }
      ];
    }
    
    if (status) {
      query.status = status;
    }
    
    console.log('📊 Fetching ALL invoices for customer:', customerId);
    
    // No limit - get all invoices
    const invoices = await Invoice.find(query)
      .populate('customerId', 'name email companyName')
      .populate('bookingId')
      .populate('shipmentId')
      .sort({ createdAt: -1 });
    
    const total = invoices.length;
    
    console.log(`✅ Found ${total} invoices for customer ${customerId}`);
    
    res.status(200).json({
      success: true,
      data: invoices,
      summary: {
        totalInvoices: total,
        totalAmount: invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0)
      },
      pagination: {
        total,
        hasMore: false
      }
    });
    
  } catch (error) {
    console.error('Get invoices by customer error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ========== 4. UPDATE INVOICE ==========
exports.updateInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Check if invoice exists
        const invoice = await Invoice.findById(id);
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Remove fields that shouldn't be updated directly
        delete updateData._id;
        delete updateData.invoiceNumber;
        delete updateData.createdAt;
        delete updateData.createdBy;

        // Recalculate totals if charges updated
        if (updateData.charges) {
            const { subtotal, taxAmount, totalAmount } = calculateTotals(
                updateData.charges,
                updateData.taxRate || invoice.taxRate,
                updateData.discountAmount || invoice.discountAmount
            );
            updateData.subtotal = subtotal;
            updateData.taxAmount = taxAmount;
            updateData.totalAmount = totalAmount;
        }

        updateData.updatedBy = req.user._id;
        updateData.updatedAt = new Date();

        const updatedInvoice = await Invoice.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate('customerId', 'firstName lastName companyName email');

        res.status(200).json({
            success: true,
            message: 'Invoice updated successfully',
            data: updatedInvoice
        });

    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 5. DELETE INVOICE ==========
exports.deleteInvoice = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if invoice exists
        const invoice = await Invoice.findById(id);
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Check if invoice can be deleted (only draft or cancelled)
        if (!['draft', 'cancelled'].includes(invoice.status)) {
            return res.status(400).json({
                success: false,
                message: 'Only draft or cancelled invoices can be deleted'
            });
        }

        // Remove reference from booking
        await Booking.findByIdAndUpdate(invoice.bookingId, {
            $unset: { invoiceId: 1 }
        });

        // Delete invoice
        await Invoice.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: 'Invoice deleted successfully'
        });

    } catch (error) {
        console.error('Delete invoice error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 6. MARK INVOICE AS PAID ==========
exports.markAsPaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentMethod, paymentReference, notes } = req.body;

        const invoice = await Invoice.findById(id);
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        if (invoice.paymentStatus === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Invoice is already marked as paid'
            });
        }

        invoice.markAsPaid(paymentMethod, paymentReference, req.user._id);
        
        if (notes) {
            invoice.notes = notes;
        }

        await invoice.save();

        // Send email notification to customer
        try {
            const customer = await User.findById(invoice.customerId);
            if (customer?.email) {
                await sendEmail({
                    to: customer.email,
                    subject: '✅ Payment Received - Invoice ' + invoice.invoiceNumber,
                    template: 'payment-received',
                    data: {
                        customerName: customer.firstName || 'Customer',
                        invoiceNumber: invoice.invoiceNumber,
                        amount: invoice.totalAmount,
                        currency: invoice.currency,
                        paymentDate: new Date().toLocaleDateString(),
                        // invoiceUrl: `${process.env.FRONTEND_URL}/customer/invoices/${invoice._id}`
                    }
                });
            }
        } catch (emailError) {
            console.error('Payment email error:', emailError);
        }

        res.status(200).json({
            success: true,
            message: 'Invoice marked as paid',
            data: invoice
        });

    } catch (error) {
        console.error('Mark as paid error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 7. SEND INVOICE EMAIL ==========
exports.sendInvoiceEmail = async (req, res) => {
    try {
        const { id } = req.params;
        const { email, message } = req.body;

        const invoice = await Invoice.findById(id)
            .populate('customerId', 'firstName lastName email companyName');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        const recipientEmail = email || invoice.customerId?.email;
        
        if (!recipientEmail) {
            return res.status(400).json({
                success: false,
                message: 'No email address provided or found'
            });
        }

        // Send email
        await sendEmail({
            to: recipientEmail,
            subject: `🧾 Invoice ${invoice.invoiceNumber} from Cargo Logistics`,
            template: 'invoice-email',
            data: {
                customerName: invoice.customerId?.firstName || 'Customer',
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.totalAmount,
                currency: invoice.currency,
                dueDate: invoice.dueDate,
                // invoiceUrl: `${process.env.FRONTEND_URL}/invoices/${invoice._id}`,
                pdfUrl: invoice.pdfUrl,
                message: message || 'Please find your invoice attached.',
                companyName: 'Cargo Logistics'
            }
        });

        // Update invoice
        invoice.emailSent = true;
        invoice.emailSentAt = new Date();
        invoice.emailedTo = invoice.emailedTo || [];
        invoice.emailedTo.push(recipientEmail);
        invoice.status = 'sent';
        await invoice.save();

        res.status(200).json({
            success: true,
            message: 'Invoice email sent successfully'
        });

    } catch (error) {
        console.error('Send invoice email error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 8. GET INVOICE STATS (Admin Dashboard) ==========
exports.getInvoiceStats = async (req, res) => {
    try {
        const stats = await Invoice.aggregate([
            {
                $facet: {
                    // Status breakdown
                    statusBreakdown: [
                        {
                            $group: {
                                _id: '$paymentStatus',
                                count: { $sum: 1 },
                                total: { $sum: '$totalAmount' }
                            }
                        }
                    ],
                    
                    // Monthly revenue
                    monthlyRevenue: [
                        {
                            $match: {
                                paymentStatus: 'paid',
                                paymentDate: { $exists: true }
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    year: { $year: '$paymentDate' },
                                    month: { $month: '$paymentDate' }
                                },
                                total: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { '_id.year': -1, '_id.month': -1 } },
                        { $limit: 12 }
                    ],
                    
                    // Overdue invoices
                    overdueInvoices: [
                        {
                            $match: {
                                paymentStatus: 'pending',
                                dueDate: { $lt: new Date() }
                            }
                        },
                        {
                            $count: 'count'
                        }
                    ],
                    
                    // Total statistics
                    totals: [
                        {
                            $group: {
                                _id: null,
                                totalInvoices: { $sum: 1 },
                                totalAmount: { $sum: '$totalAmount' },
                                paidAmount: {
                                    $sum: {
                                        $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$totalAmount', 0]
                                    }
                                },
                                pendingAmount: {
                                    $sum: {
                                        $cond: [{ $eq: ['$paymentStatus', 'pending'] }, '$totalAmount', 0]
                                    }
                                },
                                overdueAmount: {
                                    $sum: {
                                        $cond: [{ $eq: ['$paymentStatus', 'overdue'] }, '$totalAmount', 0]
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: {
                statusBreakdown: stats[0].statusBreakdown,
                monthlyRevenue: stats[0].monthlyRevenue,
                overdueCount: stats[0].overdueInvoices[0]?.count || 0,
                totals: stats[0].totals[0] || {
                    totalInvoices: 0,
                    totalAmount: 0,
                    paidAmount: 0,
                    pendingAmount: 0,
                    overdueAmount: 0
                }
            }
        });

    } catch (error) {
        console.error('Get invoice stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 9. GENERATE INVOICE PDF ==========
exports.generateInvoicePDF = async (req, res) => {
    try {
        const { id } = req.params;

        const invoice = await Invoice.findById(id)
            .populate('customerId', 'firstName lastName companyName email phone address')
            .populate('bookingId', 'bookingNumber sender receiver shipmentDetails');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        // Generate PDF URL (implement with PDF library)
        const pdfUrl = await generateInvoicePDF(invoice);

        // Update invoice with PDF URL
        invoice.pdfUrl = pdfUrl;
        await invoice.save();

        res.status(200).json({
            success: true,
            data: { pdfUrl }
        });

    } catch (error) {
        console.error('Generate PDF error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 10. BULK UPDATE INVOICES ==========
exports.bulkUpdateInvoices = async (req, res) => {
    try {
        const { invoiceIds, updateData } = req.body;

        if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide invoice IDs array'
            });
        }

        // Remove fields that shouldn't be bulk updated
        delete updateData._id;
        delete updateData.invoiceNumber;
        delete updateData.createdAt;
        delete updateData.createdBy;

        updateData.updatedBy = req.user._id;
        updateData.updatedAt = new Date();

        const result = await Invoice.updateMany(
            { _id: { $in: invoiceIds } },
            { $set: updateData },
            { runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: `Updated ${result.modifiedCount} invoices successfully`,
            data: result
        });

    } catch (error) {
        console.error('Bulk update error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 11. GET RECENT INVOICES ==========
exports.getRecentInvoices = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const invoices = await Invoice.find()
            .populate('customerId', 'firstName lastName companyName')
            .populate('bookingId', 'bookingNumber')
            .sort('-createdAt')
            .limit(parseInt(limit));

        res.status(200).json({
            success: true,
            data: invoices
        });

    } catch (error) {
        console.error('Get recent invoices error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 12. GET INVOICE BY BOOKING ID ==========
exports.getInvoiceByBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const invoice = await Invoice.findOne({ bookingId })
            .populate('customerId', 'firstName lastName companyName email')
            .populate('bookingId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'No invoice found for this booking'
            });
        }

        res.status(200).json({
            success: true,
            data: invoice
        });

    } catch (error) {
        console.error('Get invoice by booking error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 13. GET INVOICE BY SHIPMENT ID ==========
exports.getInvoiceByShipment = async (req, res) => {
    try {
        const { shipmentId } = req.params;

        const invoice = await Invoice.findOne({ shipmentId })
            .populate('customerId', 'firstName lastName companyName email')
            .populate('bookingId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'No invoice found for this shipment'
            });
        }

        res.status(200).json({
            success: true,
            data: invoice
        });

    } catch (error) {
        console.error('Get invoice by shipment error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// Helper function to calculate totals
const calculateTotals = (charges, taxRate, discountAmount) => {
    const subtotal = charges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const totalAmount = subtotal + taxAmount - (discountAmount || 0);
    
    return { subtotal, taxAmount, totalAmount };
};
// ========== 14. TRACK BY NUMBER (Public) ==========
exports.trackByNumber = async (req, res) => {
    try {
        const { trackingNumber } = req.params;

        console.log('🔍 Tracking search:', trackingNumber);

        // Shipment খুঁজুন
        let shipment = await Shipment.findOne({ trackingNumber })
            .populate({
                path: 'bookingId',
                select: 'bookingNumber sender receiver dates shipmentDetails packageDetails'
            })
            .populate('customerId', 'companyName firstName lastName')
            .populate({
                path: 'consolidationId',
                select: 'consolidationNumber containerNumber vesselName voyageNumber originWarehouse destinationPort timeline packageDetails'
            })
            .lean();

        let packages = []; // Initialize packages array

        // Shipment না পেলে Booking এ খুঁজুন
        if (!shipment) {
            const booking = await Booking.findOne({ trackingNumber })
                .populate('customer', 'companyName firstName lastName')
                .populate('shipmentId')
                .lean();

            if (booking) {
                // Extract packages from booking
                if (booking.packageDetails && booking.packageDetails.length > 0) {
                    packages = booking.packageDetails;
                } else if (booking.shipmentDetails?.packageDetails) {
                    packages = booking.shipmentDetails.packageDetails;
                }
                
                shipment = {
                    ...booking,
                    type: 'booking',
                    trackingNumber: booking.trackingNumber,
                    packages: packages,
                    milestones: booking.timeline || []
                };
            }
        } else {
            // Extract packages from shipment
            if (shipment.packageDetails && shipment.packageDetails.length > 0) {
                packages = shipment.packageDetails;
            } else if (shipment.bookingId?.packageDetails && shipment.bookingId.packageDetails.length > 0) {
                packages = shipment.bookingId.packageDetails;
            } else if (shipment.shipmentDetails?.packageDetails && shipment.shipmentDetails.packageDetails.length > 0) {
                packages = shipment.shipmentDetails.packageDetails;
            } else if (shipment.consolidationId?.packageDetails && shipment.consolidationId.packageDetails.length > 0) {
                packages = shipment.consolidationId.packageDetails;
            }
            
            // If still no packages, create a default package from shipment info
            if (packages.length === 0 && shipment.shipmentDetails) {
                packages = [{
                    packageNumber: shipment.shipmentNumber || shipment.trackingNumber,
                    description: shipment.shipmentDetails.goodsDescription || 'General Cargo',
                    quantity: shipment.shipmentDetails.totalPackages || 1,
                    weight: shipment.shipmentDetails.totalWeight || 0,
                    volume: shipment.shipmentDetails.totalVolume || 0,
                    dimensions: shipment.shipmentDetails.dimensions,
                    type: shipment.shipmentDetails.packageType || 'Carton'
                }];
            }
        }

        if (!shipment) {
            return res.status(404).json({
                success: false,
                message: 'Tracking number not found'
            });
        }

        // ===== টাইমলাইন তৈরি করুন - China Warehouse বাদ দিয়ে =====
        let timeline = [];

        // 1. শিপমেন্ট মাইলস্টোন
        if (shipment.milestones && shipment.milestones.length > 0) {
            const shipmentEvents = shipment.milestones.map(m => ({
                status: m.status,
                location: getLocationForStatus(m.status, m.location, shipment),
                description: m.description || getStatusDescription(m.status),
                date: m.timestamp,
                formattedDate: formatDate(m.timestamp),
                source: 'shipment'
            }));
            timeline = [...timeline, ...shipmentEvents];
        }

        // 2. কনসলিডেশন ইভেন্ট (যদি থাকে)
        if (shipment.consolidationId && shipment.consolidationId.timeline) {
            const consolidationEvents = shipment.consolidationId.timeline.map(event => ({
                status: event.status,
                location: getConsolidationLocation(event, shipment),
                description: event.description || `Consolidation: ${event.status}`,
                date: event.timestamp,
                formattedDate: formatDate(event.timestamp),
                source: 'consolidation'
            }));
            timeline = [...timeline, ...consolidationEvents];
        }

        // 3. ট্র্যাকিং আপডেট
        if (shipment.trackingUpdates && shipment.trackingUpdates.length > 0) {
            const trackingEvents = shipment.trackingUpdates.map(t => ({
                status: t.status,
                location: getLocationForStatus(t.status, t.location, shipment),
                description: t.description || 'Tracking update',
                date: t.timestamp,
                formattedDate: formatDate(t.timestamp),
                source: 'tracking'
            }));
            timeline = [...timeline, ...trackingEvents];
        }

        // 4. টাইমলাইন সাজান (তারিখ অনুযায়ী)
        timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 5. ডুপ্লিকেট রিমুভ
        const uniqueTimeline = [];
        const seen = new Set();
        
        timeline.forEach(event => {
            const key = `${event.status}-${new Date(event.date).toDateString()}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueTimeline.push(event);
            }
        });

        // 6. বর্তমান লোকেশন নির্ধারণ (সবচেয়ে সাম্প্রতিক ইভেন্ট থেকে)
        let currentLocation = 'Location Unknown';
        
        if (uniqueTimeline.length > 0) {
            const latestEvent = uniqueTimeline[0];
            
            // In Transit চেক
            if (latestEvent.status.includes('transit')) {
                if (shipment.consolidationId?.vesselName) {
                    currentLocation = `In Transit - ${shipment.consolidationId.vesselName}`;
                } else {
                    currentLocation = `In Transit to ${shipment.shipmentDetails?.destination || 'Destination'}`;
                }
            } 
            // Arrived চেক
            else if (latestEvent.status.includes('arrive')) {
                currentLocation = shipment.shipmentDetails?.destination || 'Destination Port';
            }
            // Customs চেক
            else if (latestEvent.status.includes('customs')) {
                currentLocation = 'Customs Clearance';
            }
            // Out for Delivery চেক
            else if (latestEvent.status.includes('out_for_delivery')) {
                currentLocation = shipment.shipmentDetails?.destination || 'Out for Delivery';
            }
            // Delivered চেক
            else if (latestEvent.status.includes('delivered')) {
                currentLocation = 'Delivered';
            }
            // অন্য কোনো লোকেশন
            else {
                currentLocation = latestEvent.location;
            }
        }

        // China Warehouse ফিল্টার - যদি এখনও থেকে যায়
        if (currentLocation === 'China Warehouse' || currentLocation === 'Warehouse') {
            if (shipment.status.includes('transit')) {
                currentLocation = 'In Transit to Destination';
            } else if (shipment.status.includes('delivered')) {
                currentLocation = 'Delivered';
            } else {
                currentLocation = 'Origin Facility';
            }
        }

        // Calculate total weight and volume from packages
        let totalWeight = 0;
        let totalVolume = 0;
        
        packages.forEach(pkg => {
            totalWeight += (pkg.weight || 0);
            totalVolume += (pkg.volume || 0);
        });

        // ===== ফাইনাল রেসপন্স =====
        const trackingInfo = {
            trackingNumber: shipment.trackingNumber,
            bookingNumber: shipment.bookingId?.bookingNumber || shipment.bookingNumber,
            shipmentNumber: shipment.shipmentNumber,
            
            status: shipment.status,
            statusDisplay: formatStatus(shipment.status),
            progress: calculateProgress(shipment.status),
            
            // গুরুত্বপূর্ণ: এখানে China Warehouse আসবে না
            currentLocation: currentLocation,
            
            origin: shipment.shipmentDetails?.origin || shipment.origin || 'China',
            destination: shipment.shipmentDetails?.destination || shipment.destination || 'USA',
            
            estimatedDeparture: shipment.dates?.estimatedDeparture || shipment.estimatedDeparture,
            estimatedDepartureFormatted: formatDate(shipment.dates?.estimatedDeparture || shipment.estimatedDeparture),
            
            estimatedArrival: shipment.dates?.estimatedArrival || shipment.estimatedArrival,
            estimatedArrivalFormatted: formatDate(shipment.dates?.estimatedArrival || shipment.estimatedArrival),
            
            actualDelivery: shipment.dates?.delivered || shipment.actualDelivery,
            actualDeliveryFormatted: formatDate(shipment.dates?.delivered || shipment.actualDelivery),
            
            lastUpdate: uniqueTimeline[0]?.date || shipment.updatedAt,
            lastUpdateFormatted: formatDate(uniqueTimeline[0]?.date || shipment.updatedAt),
            
            // PACKAGE DETAILS - ADDED HERE
            packages: packages,
            
            // Package summary
            totalPackages: packages.length,
            totalWeight: totalWeight,
            totalVolume: totalVolume,
            
            // কনসলিডেশন তথ্য
            consolidation: shipment.consolidationId ? {
                number: shipment.consolidationId.consolidationNumber,
                containerNumber: shipment.consolidationId.containerNumber,
                vesselName: shipment.consolidationId.vesselName,
                voyageNumber: shipment.consolidationId.voyageNumber,
                originWarehouse: shipment.consolidationId.originWarehouse,
                destinationPort: shipment.consolidationId.destinationPort,
                packages: packages // Also include packages in consolidation if needed
            } : null,
            
            // Shipment details with package info
            shipmentDetails: {
                totalPackages: packages.length,
                totalWeight: totalWeight,
                totalVolume: totalVolume,
                shippingMode: shipment.shippingMode || shipment.shipmentDetails?.shippingMode || 'DDU',
                serviceType: shipment.serviceType || shipment.shipmentDetails?.serviceType || 'standard',
                origin: shipment.shipmentDetails?.origin || shipment.origin || 'China',
                destination: shipment.shipmentDetails?.destination || shipment.destination || 'USA',
                notes: shipment.notes || shipment.shipmentDetails?.notes,
                packages: packages // Include packages here too for compatibility
            },
            
            // টাইমলাইন (China Warehouse ছাড়া)
            timeline: uniqueTimeline.slice(0, 30),
            
            // সেন্ডার/রিসিভার
            sender: shipment.sender || shipment.bookingId?.sender || {
                name: shipment.customerId?.companyName || shipment.customerId?.firstName + ' ' + shipment.customerId?.lastName,
                email: shipment.customerId?.email,
                phone: shipment.customerId?.phone
            },
            receiver: shipment.receiver || shipment.bookingId?.receiver
        };

        // ডিবাগ লগ
        console.log('✅ Tracking Info:', {
            tracking: trackingInfo.trackingNumber,
            status: trackingInfo.status,
            location: trackingInfo.currentLocation,
            packagesCount: trackingInfo.packages.length,
            timelineCount: trackingInfo.timeline.length
        });

        console.log('📦 Package details:', JSON.stringify(packages, null, 2));

        res.status(200).json({
            success: true,
            data: trackingInfo
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// Helper function to calculate progress
// const calculateProgress = (status) => {
//     if (!status) return 0;
    
//     const progressMap = {
//         'pending': 10,
//         'picked_up': 20,
//         'received_at_warehouse': 25,
//         'pending_consolidation': 28,
//         'consolidating': 29,
//         'consolidated': 30,
//         'ready_for_dispatch': 35,
//         'loaded_in_container': 38,
//         'dispatched': 40,
//         'departed': 45,
//         'in_transit': 50,
//         'arrived': 70,
//         'customs_cleared': 80,
//         'out_for_delivery': 90,
//         'delivered': 100,
//         'completed': 100
//     };
    
//     return progressMap[status] || 50;
// };

// Helper function to format status
// const formatStatus = (status) => {
//     if (!status) return 'Unknown';
    
//     const statusMap = {
//         'pending': 'Pending',
//         'picked_up': 'Picked Up',
//         'received_at_warehouse': 'Received at Warehouse',
//         'pending_consolidation': 'Pending Consolidation',
//         'consolidating': 'Consolidating',
//         'consolidated': 'Consolidated',
//         'ready_for_dispatch': 'Ready for Dispatch',
//         'loaded_in_container': 'Loaded in Container',
//         'dispatched': 'Dispatched',
//         'departed': 'Departed',
//         'in_transit': 'In Transit',
//         'arrived': 'Arrived',
//         'customs_cleared': 'Customs Cleared',
//         'out_for_delivery': 'Out for Delivery',
//         'delivered': 'Delivered',
//         'completed': 'Completed'
//     };
    
//     return statusMap[status] || status.split('_').map(word => 
//         word.charAt(0).toUpperCase() + word.slice(1)
//     ).join(' ');
// };

// Helper function to format date
const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return null;
    }
};

// Helper function to get location for status
function getLocationForStatus(status, location, shipment) {
    // ❌ ভুল লোকেশন ফিল্টার করুন
    if (location === 'Proident dignissimo' || location === 'Consolidation Facility') {
        return getDefaultLocationForStatus(status, shipment);
    }
    
    if (location && location !== 'Unknown' && location !== 'China Warehouse') {
        return location;
    }
    
    return getDefaultLocationForStatus(status, shipment);
}
function getDefaultLocationForStatus(status, shipment) {
    const statusLower = status?.toLowerCase() || '';
    const destination = shipment?.shipmentDetails?.destination || shipment?.destination || 'USA';
    const origin = shipment?.shipmentDetails?.origin || shipment?.origin || 'China';
    
    // Pending
    if (statusLower === 'pending') {
        return origin;
    }
    
    // Received at warehouse
    if (statusLower === 'received_at_warehouse') {
        return shipment?.shipmentDetails?.origin || origin;
    }
    
    // In Queue / Consolidated
    if (statusLower === 'consolidated' || statusLower === 'pending_consolidation') {
        return shipment?.consolidationId?.originWarehouse || origin;
    }
    
    // Ready for Dispatch
    if (statusLower === 'ready_for_dispatch') {
        return shipment?.consolidationId?.originWarehouse || origin;
    }
    
    // Loaded / Dispatched / In Transit
    if (statusLower === 'loaded_in_container' || statusLower === 'dispatched' || 
        statusLower === 'in_transit' || statusLower.includes('transit')) {
        return 'In Transit';
    }
    
    // Arrived
    if (statusLower === 'arrived_at_destination_port' || statusLower === 'arrived') {
        return destination;
    }
    
    // Customs
    if (statusLower === 'customs_cleared' || statusLower.includes('customs')) {
        return destination;
    }
    
    // Out for Delivery
    if (statusLower === 'out_for_delivery') {
        return destination;
    }
    
    // Delivered / Completed
    if (statusLower === 'delivered' || statusLower === 'completed') {
        return destination;
    }
    
    return 'Processing';
}
// Helper function to get consolidation location
function getConsolidationLocation(event, shipment) {
    let location = event.location;
    
    // ❌ ভুল লোকেশন ফিল্টার করুন
    if (location === 'Proident dignissimo' || location === 'Consolidation Facility') {
        location = null;
    }
    
    if (location && location !== 'Unknown') {
        return location;
    }
    
    const status = event.status?.toLowerCase() || '';
    const destination = shipment?.shipmentDetails?.destination || shipment?.destination || 'USA';
    const origin = shipment?.consolidationId?.originWarehouse || shipment?.shipmentDetails?.origin || 'China';
    
    if (status === 'consolidated' || status === 'pending_consolidation') {
        return origin;
    }
    
    if (status === 'ready_for_dispatch') {
        return origin;
    }
    
    if (status === 'loaded_in_container' || status === 'dispatched') {
        return origin;
    }
    
    if (status === 'in_transit' || status.includes('transit')) {
        return 'In Transit';
    }
    
    if (status === 'arrived' || status === 'arrived_at_destination_port') {
        return destination;
    }
    
    if (status === 'customs_cleared') {
        return destination;
    }
    
    if (status === 'out_for_delivery') {
        return destination;
    }
    
    if (status === 'delivered' || status === 'completed') {
        return destination;
    }
    
    return origin;
}

// Helper function to get status description
// const getStatusDescription = (status) => {
//     const descriptions = {
//         'pending': 'Shipment information received',
//         'picked_up': 'Shipment picked up from shipper',
//         'received_at_warehouse': 'Shipment received at warehouse',
//         'pending_consolidation': 'Awaiting consolidation',
//         'consolidating': 'Shipment is being consolidated',
//         'consolidated': 'Shipment consolidated with other cargo',
//         'ready_for_dispatch': 'Ready for dispatch',
//         'loaded_in_container': 'Loaded in container',
//         'dispatched': 'Shipment dispatched',
//         'departed': 'Shipment departed from origin',
//         'in_transit': 'Shipment in transit',
//         'arrived': 'Shipment arrived at destination',
//         'customs_cleared': 'Customs clearance completed',
//         'out_for_delivery': 'Out for delivery',
//         'delivered': 'Shipment delivered',
//         'completed': 'Shipment completed'
//     };
    
//     return descriptions[status] || 'Status update';
// };

// স্ট্যাটাস ডেসক্রিপশন
// function getStatusDescription(status) {
//     const descriptions = {
//         'pending': 'Shipment created',
//         'booking_confirmed': 'Booking confirmed',
//         'received_at_warehouse': 'Shipment received at warehouse',
//         'consolidated': 'Consolidation completed',
//         'loaded_in_container': 'Container loaded',
//         'dispatched': 'Shipment dispatched',
//         'departed_port_of_origin': 'Departed from origin port',
//         'in_transit_sea_freight': 'In transit by sea',
//         'in_transit': 'In transit to destination',
//         'arrived_at_destination_port': 'Arrived at destination port',
//         'customs_cleared': 'Customs cleared',
//         'out_for_delivery': 'Out for delivery',
//         'delivered': 'Delivered successfully'
//     };
//     return descriptions[status] || `Status updated`;
// }

// ==================== হেল্পার ফাংশন ====================

// function calculateProgress(status, timeline, hasArrived) {
//     console.log('📊 ===== CALCULATING PROGRESS =====');
//     console.log('Status:', status);
//     console.log('Has arrived:', hasArrived);
//     console.log('Timeline length:', timeline?.length);
    
//     // প্রগ্রেস ম্যাপ
//     const progressMap = {
//         'pending': 10,
//         'picked_up_from_warehouse': 20,
//         'received_at_warehouse': 25,
//         'consolidated': 30,
//         'departed_port_of_origin': 45,
//         'in_transit_sea_freight': 50,
//         'in_transit': 50,
//         'arrived_at_destination_port': 70,
//         'arrived': 70,
//         'customs_cleared': 80,
//         'out_for_delivery': 90,
//         'delivered': 100,
//         'completed': 100
//     };
    
//     // যদি ডেস্টিনেশনে পৌঁছে থাকে, তাহলে প্রগ্রেস কমপক্ষে 70 হবে
//     let minProgress = hasArrived ? 70 : 0;
    
//     // টাইমলাইন থেকে সর্বোচ্চ প্রগ্রেস বের করুন
//     let maxProgress = minProgress;
    
//     if (timeline && timeline.length > 0) {
//         timeline.forEach(event => {
//             const statusLower = event.status?.toLowerCase() || '';
//             let progress = 0;
            
//             // ডেলিভারি/কমপ্লিট - 100%
//             if (statusLower.includes('delivered') || statusLower.includes('completed')) {
//                 progress = 100;
//             }
//             // আউট ফর ডেলিভারি - 90%
//             else if (statusLower.includes('out_for_delivery') || statusLower.includes('out for delivery')) {
//                 progress = 90;
//             }
//             // কাস্টমস ক্লিয়ারড - 80%
//             else if (statusLower.includes('customs_cleared') || statusLower.includes('customs')) {
//                 progress = 80;
//             }
//             // অ্যারাইভড - 70%
//             else if (statusLower.includes('arrived')) {
//                 progress = 70;
//             }
//             // অন্যান্য স্ট্যাটাস
//             else {
//                 progress = progressMap[statusLower] || 0;
//             }
            
//             if (progress > maxProgress) {
//                 maxProgress = progress;
//             }
//         });
//     }
    
//     // টাইমলাইন না থাকলে বা কোন প্রগ্রেস না পেলে status থেকে নিন
//     if (maxProgress === minProgress && status) {
//         const statusLower = status.toLowerCase();
//         if (statusLower.includes('delivered') || statusLower.includes('completed')) {
//             maxProgress = 100;
//         } else if (statusLower.includes('out_for_delivery') || statusLower.includes('out for delivery')) {
//             maxProgress = 90;
//         } else if (statusLower.includes('customs_cleared') || statusLower.includes('customs')) {
//             maxProgress = 80;
//         } else if (statusLower.includes('arrived')) {
//             maxProgress = 70;
//         } else {
//             maxProgress = progressMap[statusLower] || 0;
//         }
//     }
    
//     console.log('📊 FINAL PROGRESS:', maxProgress);
//     console.log('📊 ===== END =====');
    
//     return maxProgress;
// }

function formatStatus(status) {
    if (!status) return 'Unknown';
    return status.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

// function getStatusDescription(status) {
//     const descriptions = {
//         'pending': 'Shipment created and pending processing',
//         'picked_up_from_warehouse': 'Package picked up from warehouse',
//         'received_at_warehouse': 'Package received at warehouse',
//         'consolidated': 'Shipment consolidated with other cargo',
//         'departed_port_of_origin': 'Vessel/flight departed from origin port',
//         'in_transit_sea_freight': 'Shipment in transit',
//         'arrived_at_destination_port': 'Arrived at destination port',
//         'customs_cleared': 'Customs clearance completed',
//         'out_for_delivery': 'Out for delivery',
//         'delivered': 'Successfully delivered',
//         'on_hold': 'Shipment on hold',
//         'cancelled': 'Shipment cancelled',
//         'returned': 'Shipment returned to sender'
//     };
//     return descriptions[status] || `Status updated to ${formatStatus(status)}`;
// }

// ==================== হেল্পার ফাংশন ====================

// ==================== হেল্পার ফাংশন ====================

// function calculateProgress(status, timeline) {
//     // প্রগ্রেস ম্যাপ
//     const progressMap = {
//         'pending': 10,
//         'picked_up_from_warehouse': 20,
//         'received_at_warehouse': 25,
//         'consolidated': 30,
//         'departed_port_of_origin': 45,
//         'in_transit_sea_freight': 50,
//         'in_transit': 50,
//         'arrived_at_destination_port': 70,
//         'arrived': 70,
//         'customs_cleared': 80,
//         'out_for_delivery': 90,
//         'delivered': 100,
//         'completed': 100
//     };
    
//     // যদি টাইমলাইন থাকে, তাহলে সেখান থেকে সর্বোচ্চ প্রগ্রেস বের করুন
//     if (timeline && timeline.length > 0) {
//         let maxProgress = 0;
        
//         timeline.forEach(event => {
//             const statusLower = event.status?.toLowerCase() || '';
//             let progress = 0;
            
//             if (statusLower.includes('delivered') || statusLower.includes('completed')) {
//                 progress = 100;
//             } else if (statusLower.includes('out_for_delivery')) {
//                 progress = 90;
//             } else if (statusLower.includes('customs_cleared')) {
//                 progress = 80;
//             } else if (statusLower.includes('arrived')) {
//                 progress = 70;
//             } else {
//                 // Direct map lookup
//                 progress = progressMap[statusLower] || 0;
//             }
            
//             if (progress > maxProgress) {
//                 maxProgress = progress;
//             }
//         });
        
//         console.log('📊 Max progress from timeline:', maxProgress);
//         return maxProgress;
//     }
    
//     // টাইমলাইন না থাকলে status থেকে প্রগ্রেস
//     const statusLower = status?.toLowerCase() || '';
    
//     if (statusLower.includes('delivered') || statusLower.includes('completed')) {
//         return 100;
//     } else if (statusLower.includes('out_for_delivery')) {
//         return 90;
//     } else if (statusLower.includes('customs_cleared')) {
//         return 80;
//     } else if (statusLower.includes('arrived')) {
//         return 70;
//     }
    
//     return progressMap[statusLower] || 0;
// }

function formatStatus(status) {
    if (!status) return 'Unknown';
    return status.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

// function getStatusDescription(status) {
//     const descriptions = {
//         'pending': 'Shipment created and pending processing',
//         'picked_up_from_warehouse': 'Package picked up from warehouse',
//         'received_at_warehouse': 'Package received at warehouse',
//         'consolidated': 'Shipment consolidated with other cargo',
//         'departed_port_of_origin': 'Vessel/flight departed from origin port',
//         'in_transit_sea_freight': 'Shipment in transit',
//         'arrived_at_destination_port': 'Arrived at destination port',
//         'customs_cleared': 'Customs clearance completed',
//         'out_for_delivery': 'Out for delivery',
//         'delivered': 'Successfully delivered'
//     };
//     return descriptions[status] || `Status updated to ${formatStatus(status)}`;
// }

// ==================== হেল্পার ফাংশন ====================
// ==================== হেল্পার ফাংশন ====================

function calculateProgress(status, timeline) {
    console.log('📊 ===== CALCULATING PROGRESS =====');
    console.log('Status:', status);
    console.log('Timeline length:', timeline?.length);
    
    // প্রগ্রেস ম্যাপ
    const progressMap = {
        'pending': 10,
        'picked_up_from_warehouse': 20,
        'received_at_warehouse': 25,
        'consolidated': 30,
        'departed_port_of_origin': 45,
        'in_transit_sea_freight': 50,
        'in_transit': 50,
        'arrived_at_destination_port': 70,
        'arrived': 70,
        'customs_cleared': 80,
        'out_for_delivery': 90,
        'delivered': 100,
        'completed': 100
    };
    
    // টাইমলাইন থেকে সর্বোচ্চ প্রগ্রেস বের করুন
    let maxProgress = 0;
    
    if (timeline && timeline.length > 0) {
        timeline.forEach(event => {
            const statusLower = event.status?.toLowerCase() || '';
            let progress = 0;
            
            // ডেলিভারি/কমপ্লিট - 100%
            if (statusLower.includes('delivered') || statusLower.includes('completed')) {
                progress = 100;
                console.log(`✅ Found ${statusLower} -> 100%`);
            }
            // আউট ফর ডেলিভারি - 90%
            else if (statusLower.includes('out_for_delivery')) {
                progress = 90;
                console.log(`✅ Found ${statusLower} -> 90%`);
            }
            // কাস্টমস ক্লিয়ারড - 80%
            else if (statusLower.includes('customs_cleared')) {
                progress = 80;
                console.log(`✅ Found ${statusLower} -> 80%`);
            }
            // অ্যারাইভড - 70%
            else if (statusLower.includes('arrived')) {
                progress = 70;
                console.log(`✅ Found ${statusLower} -> 70%`);
            }
            // অন্যান্য স্ট্যাটাস
            else {
                progress = progressMap[statusLower] || 0;
            }
            
            if (progress > maxProgress) {
                maxProgress = progress;
            }
        });
    }
    
    // টাইমলাইন না থাকলে বা কোন প্রগ্রেস না পেলে status থেকে নিন
    if (maxProgress === 0 && status) {
        const statusLower = status.toLowerCase();
        if (statusLower.includes('delivered') || statusLower.includes('completed')) {
            maxProgress = 100;
        } else if (statusLower.includes('out_for_delivery')) {
            maxProgress = 90;
        } else if (statusLower.includes('customs_cleared')) {
            maxProgress = 80;
        } else if (statusLower.includes('arrived')) {
            maxProgress = 70;
        } else {
            maxProgress = progressMap[statusLower] || 0;
        }
    }
    
    console.log('📊 FINAL PROGRESS:', maxProgress);
    console.log('📊 ===== END =====');
    
    return maxProgress;
}

function formatStatus(status) {
    const statusLower = status?.toLowerCase() || '';
    
    const formatted = {
        'pending': 'Pending',
        'received_at_warehouse': 'Received at Warehouse',
        'consolidated': 'Consolidated',
        'ready_for_dispatch': 'Ready for Dispatch',
        'loaded_in_container': 'Loaded',
        'dispatched': 'Dispatched',
        'in_transit': 'In Transit',
        'arrived_at_destination_port': 'Arrived at Port',
        'arrived': 'Arrived',
        'customs_cleared': 'Customs Cleared',
        'out_for_delivery': 'Out for Delivery',
        'delivered': 'Delivered',
        'completed': 'Completed'
    };
    
    return formatted[statusLower] || status || 'Unknown';
}

function getStatusDescription(status) {
    const statusLower = status?.toLowerCase() || '';
    
    const descriptions = {
        'pending': 'Shipment created and pending processing',
        'received_at_warehouse': 'Shipment received at warehouse',
        'consolidated': 'Shipment consolidated into container',
        'ready_for_dispatch': 'Shipment ready for dispatch',
        'loaded_in_container': 'Shipment loaded into container',
        'dispatched': 'Shipment dispatched',
        'in_transit': 'Shipment in transit',
        'arrived_at_destination_port': 'Shipment arrived at destination port',
        'arrived': 'Shipment arrived at destination',
        'customs_cleared': 'Customs clearance completed',
        'out_for_delivery': 'Shipment out for delivery',
        'delivered': 'Shipment delivered successfully',
        'completed': 'Shipment completed'
    };
    
    return descriptions[statusLower] || `Status updated to ${status}`;
}

// ========== 15. UPDATE DELIVERY STATUS ==========
exports.updateDeliveryStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, location, description } = req.body;

        const booking = await Booking.findById(id);

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        booking.updateDeliveryStatus(status, location, req.user._id);

        if (description) {
            booking.addTimelineEntry(
                status,
                description,
                req.user._id,
                { location }
            );
        }

        await booking.save();

        res.status(200).json({
            success: true,
            message: 'Delivery status updated successfully',
            data: {
                currentLocation: booking.currentLocation,
                status: booking.status
            }
        });

    } catch (error) {
        console.error('Update delivery status error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 16. DOWNLOAD BOOKING DOCUMENT ==========
exports.downloadBookingDocument = async (req, res) => {
    try {
        const { id, documentId } = req.params;

        const booking = await Booking.findOne({
            _id: id,
            customer: req.user._id
        });

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        const document = booking.documents?.id(documentId);
        
        if (!document) {
            return res.status(404).json({ 
                success: false, 
                message: 'Document not found' 
            });
        }

        res.status(200).json({
            success: true,
            message: 'Document download will be implemented',
            data: document
        });

    } catch (error) {
        console.error('Download document error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

// ========== 17. ADD DOCUMENT TO BOOKING ==========
exports.addDocument = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, url } = req.body;

        const booking = await Booking.findById(id);

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: 'Booking not found' 
            });
        }

        if (!booking.documents) {
            booking.documents = [];
        }

        booking.documents.push({
            type,
            url,
            uploadedAt: new Date(),
            uploadedBy: req.user._id
        });

        await booking.save();

        res.status(200).json({
            success: true,
            message: 'Document added successfully',
            data: booking.documents
        });

    } catch (error) {
        console.error('Add document error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

module.exports = exports;