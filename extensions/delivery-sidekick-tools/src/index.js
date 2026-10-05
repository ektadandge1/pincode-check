export default () => {
  shopify.tools.register("get_delivery_configuration", async () => {
    const response = await fetch("/api/sidekick/delivery-summary", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("Unable to load delivery configuration");
    }
    return response.json();
  });
};
