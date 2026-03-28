const React = require('react');
const { renderToBuffer } = require('@react-pdf/renderer');
const InvoicePDF = require('./InvoicePDF');

const generateInvoicePDFBuffer = async (invoice, companyInfo) => {
  try {
    console.log('📄 Generating PDF for invoice:', invoice.invoiceNumber);
    
    const element = React.createElement(InvoicePDF, { invoice, companyInfo });
    const buffer = await renderToBuffer(element);
    
    console.log('✅ PDF generated, size:', buffer.length, 'bytes');
    return buffer;
  } catch (error) {
    console.error('❌ PDF error:', error.message);
    throw error;
  }
};

module.exports = { generateInvoicePDFBuffer };