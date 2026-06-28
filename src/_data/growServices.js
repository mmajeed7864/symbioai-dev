/**
 * The three services we sell as programmatic landing pages. Single source of
 * truth: imported by landingPages.js (to build the matrix) and paginated over
 * by grow-service-hub.njk (to render one hub per service). `offer` links to the
 * matching package anchor on buy.html.
 */
export default [
  {
    key: "web-design",
    label: "Web Design",
    serviceType: "Web Design",
    offer: "buy.html#website-7-days",
    priceRange: "$$",
  },
  {
    key: "ai-automation",
    label: "AI Automation",
    serviceType: "AI Automation",
    offer: "buy.html#ai-assistant",
    priceRange: "$$",
  },
  {
    key: "booking-systems",
    label: "Booking Systems",
    serviceType: "Booking & Lead Systems",
    offer: "buy.html#booking-system",
    priceRange: "$$",
  },
];
