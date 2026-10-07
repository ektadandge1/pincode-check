import "@shopify/ui-extensions/preact";

function attributeValue(key) {
  const attributes = Array.isArray(shopify.attributes.value) ? shopify.attributes.value : [];
  return attributes.find((attribute) => attribute.key === key)?.value ?? "";
}

export function Estimate() {
  const estimatedDate = attributeValue("_incode_estimated_date");
  const estimatedDateMax = attributeValue("_incode_estimated_date_max");
  const estimatedDateLabel = attributeValue("_incode_estimated_date_label");
  const estimatedDateMaxLabel = attributeValue("_incode_estimated_date_max_label");
  const persistedRange = attributeValue("_incode_delivery_date_range");
  const dispatchDate = attributeValue("_incode_dispatch_date");
  const postalCode = attributeValue("_incode_postal_code");
  if (!estimatedDate) return null;

  const deliveryRange = (
    estimatedDateMax && estimatedDateMax !== estimatedDate
      ? shopify.i18n.translate("dateRange", {
          start: estimatedDateLabel || estimatedDate,
          end: estimatedDateMaxLabel || estimatedDateMax,
        })
      : persistedRange || estimatedDateLabel || estimatedDate
  );

  return (
    <s-banner heading={shopify.i18n.translate("heading")} tone="info">
      <s-stack gap="small-200">
        <s-text>{shopify.i18n.translate("estimatedDelivery", { range: deliveryRange })}</s-text>
        {dispatchDate ? <s-text>{shopify.i18n.translate("expectedDispatch", { date: dispatchDate })}</s-text> : null}
        {postalCode ? <s-text>{shopify.i18n.translate("postalCode", { postalCode })}</s-text> : null}
      </s-stack>
    </s-banner>
  );
}
