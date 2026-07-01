# Great United Sale Invoice Format (Odoo 19)

`report_invoice_great_united.xml` patches the standard
`account.report_invoice_document` template used by Odoo's "Invoices"
print action with a set of targeted `xpath` edits, re-skinning it to
match the Great United invoice design (green/navy letterhead, Head
Office block, invoice/client meta table, itemized table with a Product
Code column, highlighted Paid/Amount Due totals, terms and conditions,
and a green contact footer) while leaving the underlying discount/tax
columns, QR code, and payment-terms logic untouched.

It's written against the real Odoo 19 template body (including an
existing "Sale Invoice" title and Customer/Date info table), not a
guessed simplified version — each `xpath` targets a specific node
(`div.row` address block, `table.mb-4` info table, `table[name=
invoice_line_table]`, `table.o_total_table`, `div[name=comment]`) so it
only replaces what's needed for the new look.

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

- Colors (`#3aa939` green, `#1b2a4a` navy) are set in the injected
  `<style>` block — edit them there to match your exact brand colors.
- The Terms & Conditions text keeps using the invoice's real
  `o.narration` field (just restyled with the `gu-terms` class), so set
  your default terms under Settings > Invoicing > Default Terms and
  Conditions rather than editing the XML.
- The diagonal corner accent is built with CSS `transform: rotate()`
  on two colored bars; it renders correctly under Odoo's default PDF
  engine but is a simplified approximation of the original graphic.
- The default partner/shipping address row is removed and replaced by
  the letterhead — if you rely on a separate Shipping Address block
  (`o.partner_shipping_id != o.partner_id`), you'll need to re-add it
  elsewhere (e.g. inside the meta table).
- The item table drops sections/subsections, grouped lines and the
  discount/tax columns for a flat, simple list with a Product Code
  column — re-add those `xpath` targets from the base template if you
  need them back.
- The "Paid on ... using ..." row only appears when the invoice has
  registered payments and `print_with_payments` is true.
- Invoice-level fields (Invoice No, Date, Sales Person, Payment Type,
  Payment Term) are grouped on the left; Client Name, Address and Phone
  on the right, matching the reference layout.
