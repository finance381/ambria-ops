import inventory from './inventory.jsx'
import itemReceipt from './itemReceipt.jsx'
import expense from './expense.jsx'
import requisition from './requisition.jsx'
import vendorPayment from './vendorPayment.jsx'

var ADAPTERS = {
  inventory: inventory,
  item_receipt: itemReceipt,
  expense: expense,
  requisition: requisition,
  vendor_payment: vendorPayment,
}

function getAdapter(domain) {
  return ADAPTERS[domain] || null
}

export default ADAPTERS
export { getAdapter }
