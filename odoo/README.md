# Great United Sale Invoice Format (Odoo 19)

`report_invoice_great_united.xml` overrides the standard
`account.report_invoice_document` template used by Odoo's "Invoices"
print action, replacing it with a layout matching the Great United
invoice design (green header/footer bar, Head Office block, invoice
meta table, itemized table, highlighted Paid/Amount Due totals, terms
and conditions, and a green contact footer).

## How to use it

1. Copy `report_invoice_great_united.xml` into an existing custom
   module, e.g. `your_module/views/report_invoice_great_united.xml`.
2. Make sure the module's `__manifest__.py` lists `account` in
   `depends`, and add the file to `data`:

   ```python
   {
       "name": "Great United Invoice Format",
       "depends": ["account"],
       "data": [
           "views/report_invoice_great_united.xml",
       ],
   }
   ```

3. Install/upgrade the module. No new report action is needed — this
   patches the body of the existing Invoice PDF report in place, so
   Settings > Invoicing > Print Invoice keeps working as-is.
4. Fill in your company's logo, street/city/state/country, phone,
   email and website under Settings > Companies — these populate the
   header and footer automatically.

## Notes / things to adjust

- Colors (`#3aa939` green, `#1b2a4a` navy) and the Terms & Conditions
  wording are hardcoded to match the sample design — edit the
  `<style>` block or the `gu-terms` text to fit your exact wording.
- The diagonal corner accent is built with CSS `transform: rotate()`
  on two colored bars; it renders correctly under Odoo's default PDF
  engine but is a simplified approximation of the original graphic.
- The "Paid on ... using ..." row only appears when the invoice has
  registered payments (`o.invoice_payments_widget`).
