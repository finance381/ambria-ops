// Decor Var Cost — the cost sheets the decor team used to fill in Excel
// ("CD DATE-VENUE NAME-SALES PERSON NAME SAMPLE.xlsx"), one sheet per
// department, reproduced row for row and formula for formula.
//
// Every sheet has the same columns:
//   Particulars | Unit | Timing | Dates (D..G) | Qty | Rate | Amount | Remarks
// Qty is the sum of the date columns (=D+E+F+G). Here each date is a saved
// entry of its own, so Qty is the sum of a row across the record's entries.
//
// What Rate and Amount are depends on the row, and every row is one of four
// shapes, read off the sheet's own formulas (generated from the workbook, not
// retyped by hand):
//   rate      Rate is a number (the sheet's default, editable)  Amount = Qty × Rate
//   value     Rate = Qty, Amount = Rate — the figure typed is already in rupees
//   factor    Rate = Qty × factor, Amount = Rate — a purchase value at 40%, or
//             a count at a fixed rate and a share ("7*20%")
//   factorSq  Rate = Qty × factor, Amount = Qty × Rate. Only Light's
//             "All Type Wire Wastage & Breakage" (=H43*1000*50%, =H43*I43):
//             the quantity is counted twice. Kept as the sheet has it, by
//             decision — 2 bundles come to 2 × 2 × 500.
//
// Spellings ("Velue", "Florsit", the repeated "Weldor Out Side") are the
// sheet's, kept so the two can be read side by side. Two departures, both
// where the workbook is plainly a copy-paste slip: Mics. and Commission are
// titled by their own "… Details" heading rather than the "Transport Related
// Expense" they inherited, and Commission's first row is a value row like the
// six under it (the sheet left its formulas out, so it could never add up).
//
// Grand total = SUM(Amount) over the rows, with each row's Amount worked out
// from its total Qty — exactly as the sheet does it. A single date's own
// figure applies the same formula to that date's quantities alone; for every
// row but the factorSq one, the dates add up to the grand total.

export var SHEETS = [
  {
    code: 'FLR', name: 'Flower', title: 'Flower Related Expense', prefix: 'F', subDeptCode: 'FLR',
    rows: [
      { key: '8', name: 'Florsit Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: null },
      { key: '9', name: 'Florsit Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '10', name: 'Florsit Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 1000 },
      { key: '11', name: 'Florsit Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 1000 },
      { key: '12', name: 'Labour Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 750 },
      { key: '13', name: 'Labour Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 750 },
      { key: '14', name: 'Labour Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '15', name: 'Labour Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '16', name: 'Painter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '17', name: 'Painter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '18', name: 'Painter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '19', name: 'Painter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '20', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '21', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '22', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '23', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '24', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 0 },
      { key: '25', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '26', name: 'Mandi Real Flowers Velue', unit: 'Rs.', kind: 'value' },
      { key: '27', name: 'Artificial Flower Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '28', name: 'Osis', unit: 'Box.', kind: 'rate', rate: 280 },
      { key: '29', name: 'Tar', unit: 'Kg.', kind: 'rate', rate: 100 },
      { key: '30', name: 'Jali Big', unit: 'Pcs.', kind: 'rate', rate: 700 },
      { key: '31', name: 'Jali Small', unit: 'Pcs.', kind: 'rate', rate: 700 },
      { key: '32', name: 'Candel Cell', unit: 'Pcs.', kind: 'rate', rate: 6 },
      { key: '33', name: 'Flower Goods Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '34', name: 'Flower Goods Purchase Velue (100%)', unit: 'Rs.', kind: 'value' },
      { key: '35', name: 'Conyance & Cartage Velue', unit: 'Rs.', kind: 'value' },
      { key: '36', name: 'Short & Breakage Artificial Flowers', unit: 'Kg.', kind: 'rate', rate: 100 },
      { key: '37', name: 'Short & Breakage Artificial Greens', unit: 'Kg.', kind: 'rate', rate: 100 },
      { key: '38', name: 'Short & Breakage Flowers Goods Velue', unit: 'Rs.', kind: 'value' },
      { key: '39', name: 'Sun Board Expense Velue', unit: 'Rs.', kind: 'value' },
      { key: '40', name: 'Baloon Related Velue', unit: 'Rs.', kind: 'value' },
      { key: '41', name: 'Hardware Velue', unit: 'Rs.', kind: 'value' },
      { key: '42', name: 'Paint Velue', unit: 'Rs.', kind: 'value' },
      { key: '43', name: 'Labour Food', unit: 'Qty.', kind: 'rate', rate: 0 },
      { key: '44', name: 'Rental Flower Goods', unit: 'Rs.', kind: 'value' },
      { key: '45', name: 'Mics.', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'TNT', name: 'Tenting', title: 'Tenting Related Expense', prefix: 'T', subDeptCode: 'TNT',
    rows: [
      { key: '8', name: 'Truss Labour Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '9', name: 'Truss Labour Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '10', name: 'Labour Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 750 },
      { key: '11', name: 'Labour Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 750 },
      { key: '12', name: 'Labour Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '13', name: 'Labour Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '14', name: 'Painter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '15', name: 'Painter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '16', name: 'Painter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '17', name: 'Painter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '18', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '19', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '20', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '21', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '22', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '23', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '24', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '25', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '26', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 0 },
      { key: '27', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '28', name: 'Sunil Bangali / Truss Personal', unit: 'Nos.', timing: 'Day/Night', kind: 'rate', rate: 900 },
      { key: '29', name: 'Plane Carpet Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '30', name: 'Plane Carpet Used RT-7 (20%)', unit: 'SQFT', kind: 'factor', factor: 1.4, expr: '7*20%' },
      { key: '31', name: 'Printed Carpet Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '32', name: 'Printed Carpet Used RT-13 (20%)', unit: 'SQFT', kind: 'factor', factor: 2.6, expr: '13*20%' },
      { key: '33', name: 'Batta', unit: 'Pcs.', kind: 'factor', factor: 24, expr: '120*20%' },
      { key: '34', name: 'Banboo', unit: 'Pcs.', kind: 'factor', factor: 60, expr: '300*20%' },
      { key: '35', name: 'Tent Goods Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '36', name: 'Labour Food', unit: 'Qty.', kind: 'rate', rate: 0 },
      { key: '37', name: 'Conyance & Cartage Velue', unit: 'Rs.', kind: 'value' },
      { key: '38', name: 'Hardware Velue', unit: 'Rs.', kind: 'value' },
      { key: '39', name: 'Paint Velue', unit: 'Rs.', kind: 'value' },
      { key: '40', name: 'Tripal New Velue', unit: 'Rs.', kind: 'value' },
      { key: '41', name: 'Mics.', unit: 'Rs.', kind: 'value' },
      { key: '42', name: 'Tree Jhoomar Rental', unit: 'Qty.', kind: 'rate', rate: 5000 },
      { key: '43', name: 'Wodden Flooring Cost', unit: 'SQFT', kind: 'rate', rate: 15 },
      { key: '44', name: 'Rental Goods', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'FBR', name: 'Fabric', title: 'Fabric Related Expense', prefix: 'C', subDeptCode: 'FBR',
    rows: [
      { key: '8', name: 'Bangali Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 0 },
      { key: '9', name: 'Bangali Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '10', name: 'Bangali Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '11', name: 'Bangali Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '12', name: 'Labour Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 750 },
      { key: '13', name: 'Labour Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 750 },
      { key: '14', name: 'Labour Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '15', name: 'Labour Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '16', name: 'Tailor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 800 },
      { key: '17', name: 'Tailor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 800 },
      { key: '18', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 0 },
      { key: '19', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '20', name: 'New Lisa Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '21', name: 'Used Lisa Used RT-23 (20%)', unit: 'Kg.', kind: 'factor', factor: 73.6, expr: '16*23*20%' },
      { key: '22', name: 'Velvet New Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '23', name: 'Velvet Used RT-250 (20%)', unit: 'Kg.', kind: 'factor', factor: 50, expr: '250*20%' },
      { key: '24', name: 'Century New Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '25', name: 'Century Used RT-384 (20%)', unit: 'Kg.', kind: 'factor', factor: 76.8, expr: '384*20%' },
      { key: '26', name: 'Radymade Cloths Purchase Velue (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '27', name: 'Laundry Charge Lisa', unit: 'Qty.', kind: 'rate', rate: 35 },
      { key: '28', name: 'Laundry Charge Velvet', unit: 'Qty.', kind: 'rate', rate: 35 },
      { key: '29', name: 'Laundry Charge Century', unit: 'Qty.', kind: 'rate', rate: 35 },
      { key: '30', name: 'Laundry (Table top, Bow Tai, All)', unit: 'Rs.', kind: 'value' },
      { key: '31', name: 'Conyance & Cartage', unit: 'Rs.', kind: 'value' },
      { key: '32', name: 'Labour Food', unit: 'Qty.', kind: 'rate', rate: 0 },
      { key: '33', name: 'Mics', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'STR', name: 'Structure', title: 'Structure Related Expense', prefix: 'S', subDeptCode: 'STR',
    rows: [
      { key: '8', name: 'Labour Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 750 },
      { key: '9', name: 'Labour Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 750 },
      { key: '10', name: 'Labour Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '11', name: 'Labour Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '12', name: 'Painter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '13', name: 'Painter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '14', name: 'Painter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '15', name: 'Painter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '16', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '17', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '18', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '19', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '20', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '21', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '22', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '23', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '24', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 0 },
      { key: '25', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '26', name: 'Structure Goods Purchase  (40%)', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '27', name: 'Labour Food', unit: 'Qty.', kind: 'rate', rate: 0 },
      { key: '28', name: 'Conyance & Cartage Velue', unit: 'Rs.', kind: 'value' },
      { key: '29', name: 'Hardware Velue', unit: 'Rs.', kind: 'value' },
      { key: '30', name: 'Paint Velue', unit: 'Rs.', kind: 'value' },
      { key: '31', name: 'Tripal Velue', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '32', name: 'Mics.', unit: 'Rs.', kind: 'value' },
      { key: '33', name: 'Structure Goods on Rent', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'FRN', name: 'Furniture', title: 'Furniture Related Expense', prefix: 'FR', subDeptCode: 'FRN',
    rows: [
      { key: '8', name: 'Labour Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 750 },
      { key: '9', name: 'Labour Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 750 },
      { key: '10', name: 'Labour Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '11', name: 'Labour Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '12', name: 'Painter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '13', name: 'Painter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '14', name: 'Painter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '15', name: 'Painter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '16', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '17', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '18', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '19', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '20', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '21', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '22', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '23', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '24', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 0 },
      { key: '25', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 0 },
      { key: '26', name: 'Premium Chair Cost', unit: 'Qty.', kind: 'rate', rate: 200 },
      { key: '27', name: 'Premium Sofa Cost', unit: 'Set.', kind: 'rate', rate: 2500 },
      { key: '28', name: 'Premium Panel Cost', unit: 'Qty.', kind: 'rate', rate: 2000 },
      { key: '29', name: 'Premium Candle Wall Cost', unit: 'Qty.', kind: 'rate', rate: 1500 },
      { key: '30', name: 'Conyance & Cartage Velue', unit: 'Rs.', kind: 'value' },
      { key: '31', name: 'Hardware Velue', unit: 'Rs.', kind: 'value' },
      { key: '32', name: 'Paint Velue', unit: 'Rs.', kind: 'value' },
      { key: '33', name: 'Labour Food', unit: 'Qty.', kind: 'rate', rate: 60 },
      { key: '34', name: 'Rental Furniture', unit: 'Rs.', kind: 'value' },
      { key: '35', name: 'Mics.', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'LGT', name: 'Light', title: 'Light Related Expense', prefix: 'L', subDeptCode: 'LGT',
    rows: [
      { key: '8', name: 'Labour Chowk', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 750 },
      { key: '9', name: 'Labour Chowk', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 750 },
      { key: '10', name: 'Labour Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '11', name: 'Labour Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '12', name: 'Painter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '13', name: 'Painter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '14', name: 'Painter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '15', name: 'Painter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '16', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '17', name: 'Carpenter Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '18', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '19', name: 'Carpenter Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '20', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '21', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '22', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '23', name: 'Weldor Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '24', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: null },
      { key: '25', name: 'Casual Vendor Labour', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: null },
      { key: '26', name: 'Laight Casual Out Side', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 700 },
      { key: '27', name: 'Laight Casual Out Side', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 700 },
      { key: '28', name: 'Laight Casual Personal', unit: 'Nos.', timing: 'Day', kind: 'rate', rate: 600 },
      { key: '29', name: 'Laight Casual Personal', unit: 'Nos.', timing: 'Night', kind: 'rate', rate: 600 },
      { key: '30', name: 'Diesel For Jenset', unit: 'Ltr.', kind: 'rate', rate: null },
      { key: '31', name: 'Rental Jenset', unit: 'Rs.', kind: 'value' },
      { key: '32', name: 'Light Goods Purchase', unit: 'Rs.', kind: 'factor', factor: 0.4, expr: '40%' },
      { key: '33', name: 'Led Light Rental', unit: 'Rs.', kind: 'value' },
      { key: '34', name: 'Jhoomar Rental', unit: 'Rs.', kind: 'value' },
      { key: '35', name: 'Hardware Velue', unit: 'Rs.', kind: 'value' },
      { key: '36', name: 'Paint Velue', unit: 'Rs.', kind: 'value' },
      { key: '37', name: 'Conveyance & Cartage', unit: 'Rs.', kind: 'value' },
      { key: '38', name: 'Food Expense', unit: 'Qty.', kind: 'rate', rate: null },
      { key: '39', name: 'Rice Lari Wastage & Breakage', unit: 'Pcs', kind: 'rate', rate: 25 },
      { key: '40', name: 'Blub Wastage & Breakage', unit: 'Pcs', kind: 'rate', rate: 21 },
      { key: '41', name: 'Ormat Cable Wastage & Breakage', unit: 'Rs.', kind: 'value' },
      { key: '42', name: 'Jhoomar Wastage & Breakage', unit: 'Qty.', kind: 'rate', rate: 80 },
      { key: '43', name: 'All Type Wire Wastage & Breakage', unit: 'Bundle', kind: 'factorSq', factor: 500, expr: '1000*50%' },
      { key: '44', name: 'Others Wastage & Breakage', unit: 'Rs.', kind: 'value' },
      { key: '45', name: 'Mics.', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'TRN', name: 'Transport', title: 'Transport Related Expense', prefix: 'T', subDeptCode: 'TRN',
    rows: [
      { key: '8', name: 'Driver Casual Out Side', unit: 'Nos.', timing: 'Day/Night', kind: 'rate', rate: null },
      { key: '9', name: 'Truck 14 Ft', unit: 'Round', kind: 'rate', rate: null },
      { key: '10', name: 'Truck 17 Ft', unit: 'Round', kind: 'rate', rate: null },
      { key: '11', name: 'Truck 22 Ft', unit: 'Round', kind: 'rate', rate: null },
      { key: '12', name: 'Truck 24 Ft', unit: 'Round', kind: 'rate', rate: null },
      { key: '13', name: 'Tampoo / Pickup  8* ft', unit: 'Round', kind: 'rate', rate: null },
      { key: '14', name: 'Tampoo / Pickup  10* ft', unit: 'Round', kind: 'rate', rate: null },
      { key: '15', name: 'Eco Retal', unit: 'Rs.', kind: 'value' },
      { key: '16', name: 'Eco Retal', unit: 'Fix', kind: 'rate', rate: null },
      { key: '17', name: 'Traveler Rental', unit: 'Fix', kind: 'rate', rate: null },
      { key: '18', name: 'Bus Rental', unit: 'Fix', kind: 'rate', rate: null },
      { key: '19', name: 'Holding Charges', unit: 'Rs.Day Wise', kind: 'value' },
      { key: '20', name: 'Police Kharcha', unit: 'Rs.', kind: 'value' },
      { key: '21', name: 'Truck 1250 Less 25 %', unit: 'Round', kind: 'rate', rate: null },
      { key: '22', name: 'Truck 1814 Less 25 %', unit: 'Round', kind: 'rate', rate: null },
      { key: '23', name: 'Truck 2125 Less 25 %', unit: 'Round', kind: 'rate', rate: null },
      { key: '24', name: 'Tata Ace 5357 Less 25 %', unit: 'Round', kind: 'rate', rate: null },
      { key: '25', name: 'Eco 4073 Less 25 %', unit: 'Round', kind: 'rate', rate: null },
      { key: '26', name: 'Eco 3260 Less 25 %', unit: 'Round', kind: 'rate', rate: null },
      { key: '27', name: 'Conyance & Cartage', unit: 'Rs.', kind: 'value' },
      { key: '28', name: 'Ola / Taxi / Auto', unit: 'Rs.', kind: 'value' },
      { key: '29', name: 'Food Expense', unit: 'Qty', kind: 'rate', rate: null },
      { key: '30', name: 'Parking', unit: 'Rs.', kind: 'value' },
      { key: '31', name: 'Damage & Breakage', unit: 'Rs.', kind: 'value' },
      { key: '32', name: 'Mics.', unit: 'Rs.', kind: 'value' },
    ],
  },
  {
    code: 'MICS', name: 'Mics.', title: 'Mics. Details', prefix: 'M', subDeptCode: null,
    rows: [
      { key: '8', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '9', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '10', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '11', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '12', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '13', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '14', name: '', unit: 'Rs.', kind: 'value', free: true },
    ],
  },
  {
    code: 'COMMISSION', name: 'Commission', title: 'Commission Details', prefix: 'CM', subDeptCode: null,
    rows: [
      { key: '8', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '9', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '10', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '11', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '12', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '13', name: '', unit: 'Rs.', kind: 'value', free: true },
      { key: '14', name: '', unit: 'Rs.', kind: 'value', free: true },
    ],
  },
]

export function getSheet(code) {
  for (var i = 0; i < SHEETS.length; i++) if (SHEETS[i].code === code) return SHEETS[i]
  return null
}

// A number from what was typed: blank and junk are 0, never NaN.
export function num(v) {
  if (v === '' || v == null) return 0
  var n = Number(v)
  return isFinite(n) ? n : 0
}

// True when a typed value is not a usable non-negative number.
export function badNumber(v) {
  if (v === '' || v == null) return false
  var n = Number(v)
  return !isFinite(n) || n < 0
}

// The rows as the sheet lays them out: a Day row and its Night row share one
// Particulars cell, so they come back as one group of two; every other row is
// a group of one.
export function rowGroups(sheet) {
  var groups = []
  sheet.rows.forEach(function (r) {
    var last = groups[groups.length - 1]
    if (last && !r.free && r.timing === 'Night' && last.rows.length === 1 && last.rows[0].timing === 'Day' && last.name === r.name) {
      last.rows.push(r)
      return
    }
    groups.push({ key: r.key, name: r.name, unit: r.unit, rows: [r] })
  })
  return groups
}

// The Rate a 'rate' row is worked out at: what was typed for this record, or
// the sheet's default when nothing was. A field emptied on purpose ('') is
// empty, not the default — what the Rate box shows is what is worked out.
// null when there is no rate (a blank Rate cell, or an emptied box).
export function effRate(row, rates) {
  if (row.kind !== 'rate') return null
  var typed = rates ? rates[row.key] : undefined
  if (typed === '') return null
  if (typed !== undefined && typed !== null) return num(typed)
  return row.rate == null ? null : row.rate
}

// The record's per-row values made ready to store: typed rates as numbers,
// dropped where they are blank or the sheet's default anyway; remarks and
// particulars trimmed, dropped where empty.
export function cleanSheetData(sheet, data) {
  var d = data || {}
  var rates = {}, remarks = {}, particulars = {}
  sheet.rows.forEach(function (r) {
    var t = d.rates ? d.rates[r.key] : undefined
    if (r.kind === 'rate' && t !== undefined && t !== null && t !== '' && !badNumber(t) && num(t) !== r.rate) rates[r.key] = num(t)
    var rm = String((d.remarks || {})[r.key] || '').trim()
    if (rm) remarks[r.key] = rm
    var pt = String((d.particulars || {})[r.key] || '').trim()
    if (pt) particulars[r.key] = pt
  })
  return { rates: rates, remarks: remarks, particulars: particulars }
}

// An entry's lines made ready to store: only rows with a figure, as numbers.
export function cleanLines(sheet, lines) {
  var out = {}
  sheet.rows.forEach(function (r) {
    var v = (lines || {})[r.key]
    if (!badNumber(v) && num(v)) out[r.key] = num(v)
  })
  return out
}

// One row's Rate and Amount (rupees) for a quantity, by the row's formula.
export function rowCalc(row, qty, rates) {
  var q = num(qty)
  if (row.kind === 'rate') {
    var r = effRate(row, rates)
    return { rate: r, amount: q * (r || 0) }
  }
  if (row.kind === 'value') return { rate: q, amount: q }
  if (row.kind === 'factor') { var f = q * row.factor; return { rate: f, amount: f } }
  if (row.kind === 'factorSq') { var g = q * row.factor; return { rate: g, amount: q * g } }
  return { rate: null, amount: 0 }
}

// How a row's Amount is reached, for the line under it. Blank for a plain
// Qty × Rate row, whose Rate field already says it.
export function formulaHint(row) {
  if (row.kind === 'value') return 'Amount = value entered'
  if (row.kind === 'factor') return 'Amount = Qty × ' + row.expr
  if (row.kind === 'factorSq') return 'Rate = Qty × ' + row.expr + ' · Amount = Qty × Rate'
  return ''
}

export function toPaise(rupees) { return Math.round(num(rupees) * 100) }

// One date's figure: each row's formula on that date's quantity.
export function entryAmountPaise(sheet, lines, rates) {
  var total = 0
  sheet.rows.forEach(function (r) { total += toPaise(rowCalc(r, (lines || {})[r.key], rates).amount) })
  return total
}

// How many rows of an entry carry a figure.
export function filledCount(sheet, lines) {
  var n = 0
  sheet.rows.forEach(function (r) { if (num((lines || {})[r.key])) n++ })
  return n
}

// The sheet as a whole: per row the quantity on each date, the total Qty, and
// the Rate and Amount worked out from that total; and the Grand Total.
// entries: [{ entry_date, lines }].
export function sheetTotals(sheet, entries, rates) {
  var byRow = {}
  var totalPaise = 0
  sheet.rows.forEach(function (r) {
    var qty = 0
    var perDate = {}
    ;(entries || []).forEach(function (e) {
      var q = num((e.lines || {})[r.key])
      if (q) perDate[e.entry_date] = q
      qty += q
    })
    var c = rowCalc(r, qty, rates)
    var amountPaise = toPaise(c.amount)
    byRow[r.key] = { qty: qty, perDate: perDate, rate: c.rate, amountPaise: amountPaise }
    totalPaise += amountPaise
  })
  return { byRow: byRow, totalPaise: totalPaise }
}

// What stops one date's entry from saving. Returns { rows: {key: message},
// message } — message is the first problem, for the banner.
//   - every figure a non-negative number
//   - something entered at all
//   - a 'rate' row with a quantity needs a Rate above 0 (a blank or 0 Rate
//     cell on the sheet is one the person filling it in is meant to set)
//   - a free row (Mics., Commission) with a value needs its particulars
export function validateEntry(sheet, lines, sheetData) {
  var rows = {}
  var first = ''
  var any = false
  var rates = (sheetData && sheetData.rates) || {}
  var particulars = (sheetData && sheetData.particulars) || {}
  function fail(r, msg) {
    if (!rows[r.key]) rows[r.key] = msg
    if (!first) first = (r.name || 'Row ' + r.key) + (r.timing ? ' (' + r.timing + ')' : '') + ': ' + msg
  }
  sheet.rows.forEach(function (r) {
    var v = (lines || {})[r.key]
    if (badNumber(v)) { fail(r, 'Enter a number, 0 or more'); return }
    if (r.kind === 'rate' && badNumber(rates[r.key])) { fail(r, 'Rate must be a number, 0 or more'); return }
    var q = num(v)
    if (!q) return
    any = true
    if (r.kind === 'rate' && !(effRate(r, rates) > 0)) fail(r, 'Enter the rate')
    if (r.free && !String(particulars[r.key] || '').trim()) fail(r, 'Enter the particulars')
  })
  if (!first && !any) first = 'Enter at least one quantity or value for this date'
  return { rows: rows, message: first }
}
