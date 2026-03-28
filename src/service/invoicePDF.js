const React = require('react');
const { Document, Page, Text, View, StyleSheet, Font } = require('@react-pdf/renderer');

// Register font
Font.register({
  family: 'Helvetica',
  src: 'https://fonts.gstatic.com/s/helvetica/v1/Helvetica.ttf'
});

// Styles
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30, borderBottom: '2px solid #E67E22', paddingBottom: 20 },
  companySection: { flex: 1 },
  companyName: { fontSize: 24, fontWeight: 'bold', color: '#E67E22' },
  companyAddress: { fontSize: 9, color: '#4B5563', marginBottom: 2 },
  invoiceSection: { flex: 1, alignItems: 'flex-end' },
  invoiceTitle: { fontSize: 28, fontWeight: 'bold', color: '#E67E22' },
  invoiceDetails: { fontSize: 10, color: '#4B5563', textAlign: 'right' },
  status: { padding: 8, borderRadius: 4, marginBottom: 20, textAlign: 'center', fontWeight: 'bold', fontSize: 12 },
  statusPending: { backgroundColor: '#FEF3C7', color: '#92400E' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 10, backgroundColor: '#F97316', color: 'white', padding: 6, borderRadius: 4 },
  row: { flexDirection: 'row', marginBottom: 6 },
  label: { fontWeight: 'bold', width: '30%', fontSize: 9 },
  value: { width: '70%', fontSize: 9 },
  table: { marginTop: 10 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#F3F4F6', padding: 8, fontWeight: 'bold', fontSize: 9 },
  tableRow: { flexDirection: 'row', padding: 8, borderBottom: '1px solid #E5E7EB' },
  col1: { width: '45%', fontSize: 9 },
  col2: { width: '20%', fontSize: 9, textAlign: 'center' },
  col3: { width: '20%', fontSize: 9, textAlign: 'right' },
  col4: { width: '15%', fontSize: 9, textAlign: 'right' },
  totalSection: { marginTop: 20, alignItems: 'flex-end', borderTop: '1px solid #E5E7EB', paddingTop: 15 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6, width: '50%' },
  totalLabel: { fontSize: 10, fontWeight: 'bold', width: '40%', textAlign: 'right' },
  totalValue: { fontSize: 10, width: '60%', textAlign: 'right' },
  grandTotalRow: { borderTop: '1px solid #E67E22', paddingTop: 8 },
  grandTotalLabel: { fontSize: 14, fontWeight: 'bold', color: '#E67E22' },
  grandTotalValue: { fontSize: 14, fontWeight: 'bold', color: '#E67E22' },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', fontSize: 8, borderTop: '1px solid #E5E7EB', paddingTop: 10 }
});

// Helper functions
const formatCurrency = (amount, currency = 'USD') => {
  if (!amount) return 'N/A';
  const symbols = { USD: '$', EUR: '€', GBP: '£', BDT: '৳' };
  return `${symbols[currency] || '$'}${amount.toLocaleString()}`;
};

const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

// PDF Component
const InvoicePDF = ({ invoice, companyInfo }) => {
  const info = companyInfo || {
    name: 'Cargo Logistics Group',
    address: '123 Business Avenue, Dhaka, Bangladesh',
    phone: '+880 1234-567890',
    email: 'info@cargologistics.com'
  };

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(View, { style: styles.companySection },
          React.createElement(Text, { style: styles.companyName }, info.name),
          React.createElement(Text, { style: styles.companyAddress }, info.address),
          React.createElement(Text, { style: styles.companyAddress }, `Phone: ${info.phone}`),
          React.createElement(Text, { style: styles.companyAddress }, `Email: ${info.email}`)
        ),
        React.createElement(View, { style: styles.invoiceSection },
          React.createElement(Text, { style: styles.invoiceTitle }, 'INVOICE'),
          React.createElement(Text, { style: styles.invoiceDetails }, `#${invoice.invoiceNumber}`),
          React.createElement(Text, { style: styles.invoiceDetails }, `Date: ${formatDate(invoice.invoiceDate)}`),
          React.createElement(Text, { style: styles.invoiceDetails }, `Due Date: ${formatDate(invoice.dueDate)}`)
        )
      ),
      // Status
      React.createElement(View, { style: [styles.status, styles.statusPending] },
        React.createElement(Text, null, '⏳ PENDING')
      ),
      // Bill To
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'BILL TO'),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, 'Company:'),
          React.createElement(Text, { style: styles.value }, invoice.customerInfo?.companyName || 'N/A')
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, 'Contact:'),
          React.createElement(Text, { style: styles.value }, invoice.customerInfo?.contactPerson || 'N/A')
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, 'Email:'),
          React.createElement(Text, { style: styles.value }, invoice.customerInfo?.email || 'N/A')
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, 'Phone:'),
          React.createElement(Text, { style: styles.value }, invoice.customerInfo?.phone || 'N/A')
        )
      ),
      // Charges Table
      React.createElement(View, { style: styles.table },
        React.createElement(View, { style: styles.tableHeader },
          React.createElement(Text, { style: styles.col1 }, 'Description'),
          React.createElement(Text, { style: styles.col2 }, 'Type'),
          React.createElement(Text, { style: styles.col3 }, 'Amount'),
          React.createElement(Text, { style: styles.col4 }, 'Currency')
        ),
        invoice.charges?.map((charge, idx) =>
          React.createElement(View, { key: idx, style: styles.tableRow },
            React.createElement(Text, { style: styles.col1 }, charge.description),
            React.createElement(Text, { style: styles.col2 }, charge.type),
            React.createElement(Text, { style: styles.col3 }, formatCurrency(charge.amount, charge.currency)),
            React.createElement(Text, { style: styles.col4 }, charge.currency)
          )
        )
      ),
      // Totals
      React.createElement(View, { style: styles.totalSection },
        React.createElement(View, { style: styles.totalRow },
          React.createElement(Text, { style: styles.totalLabel }, 'Subtotal:'),
          React.createElement(Text, { style: styles.totalValue }, formatCurrency(invoice.subtotal, invoice.currency))
        ),
        React.createElement(View, { style: styles.totalRow },
          React.createElement(Text, { style: styles.totalLabel }, 'Tax:'),
          React.createElement(Text, { style: styles.totalValue }, formatCurrency(invoice.taxAmount, invoice.currency))
        ),
        React.createElement(View, { style: [styles.totalRow, styles.grandTotalRow] },
          React.createElement(Text, { style: styles.grandTotalLabel }, 'TOTAL:'),
          React.createElement(Text, { style: styles.grandTotalValue }, formatCurrency(invoice.totalAmount, invoice.currency))
        )
      ),
      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, null, 'Thank you for your business!'),
        React.createElement(Text, null, `For inquiries: ${info.email} | ${info.phone}`)
      )
    )
  );
};

module.exports = InvoicePDF;