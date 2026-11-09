Square pricing card for a gap:1px 3-col hairgrid. Featured tier gets the orange inset ring + corner tab + the page's primary button. Every tier's CTA uses the SAME label.

```jsx
<div className="hairgrid cols-3">
  <PricingTier name="Solo" price="$0" features={['1 unit','Community feed']} />
  <PricingTier name="Team" price="$740" priceNote="/MO" featured features={['128 units','Alarm routing']} />
  <PricingTier name="Scale" price="Custom" features={['Unlimited units','On-site install']} />
</div>
```
