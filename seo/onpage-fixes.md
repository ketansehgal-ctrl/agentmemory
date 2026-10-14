# On-Page Fixes

Drafts until the site audit runs (sites not reachable from this session yet). Titles are ≤60 characters and metas ≤155, so they won't be cut off in Google.

## quantumaccord.shop — Export

### Recommended page structure
```
/                      Home: who you are, certifications, product grid, RFQ CTA
/darjeeling-tea        Flagship: flushes, grades, packaging, MOQ, RFQ
/private-label         Private label + custom packaging process
/makhana               Foxnut / makhana
/onion /garlic /ginger /potato   One page each (specs, season, packing)
/wine                  Wine range
/certifications        FSSAI, FIEO, ISO, DGFT, GFE, GCCI (with registration numbers)
/about                 Darjeeling origin story, team, location
/contact               WhatsApp, phone, email, RFQ form
/blog                  Importer guides
```

### Titles & meta descriptions

| Page | Title | Meta description |
|---|---|---|
| Home | Darjeeling Tea & Agri Exporter India \| Quantum Accord | Certified Indian exporter of Darjeeling tea, makhana, onion, garlic & ginger. Bulk supply, private label and global shipping. Request a quote. |
| Darjeeling tea | Darjeeling Tea Exporter – Bulk & Wholesale \| Quantum Accord | Source authentic Darjeeling tea direct from Darjeeling. First & second flush, multiple grades, bulk or private label. FSSAI & ISO certified. |
| Private label | Private Label Darjeeling Tea Manufacturer \| Quantum Accord | Launch your own tea brand with private label Darjeeling tea. Custom blends, packaging and labelling for importers and retailers. |
| Makhana | Makhana (Foxnut) Exporter India – Bulk \| Quantum Accord | Bulk makhana (foxnut) export from India. Graded, cleaned and packed to your spec. Certified exporter with private label options. |
| Onion | Fresh Onion Exporter India – Bulk Supply \| Quantum Accord | Export-quality Indian onions in bulk. Sorted, graded and packed for international buyers. Get a quote from a certified exporter. |

(Same pattern for garlic, ginger, potato, wine.)

### Must-haves on every product page
- One H1 with the main keyword (e.g. "Darjeeling Tea Exporter from India").
- Spec table: grades/varieties, packaging sizes, MOQ `[fill in]`, lead time `[fill in]`, shipping terms (FOB/CIF) `[fill in]`.
- Certifications strip with registration numbers — builds trust with importers and AI answers.
- Clear CTA: "Request a quote" form + WhatsApp button (wa.me/+918130677317).
- Real product photos with descriptive alt text ("second flush Darjeeling tea leaves, loose").
- 300+ words of unique text — no copy-pasted supplier descriptions.

### Structured data (paste in `<head>`)
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Quantum Accord Business Group",
  "url": "https://quantumaccord.shop",
  "slogan": "Connecting India to the World",
  "address": { "@type": "PostalAddress", "addressLocality": "Darjeeling", "addressCountry": "IN" },
  "telephone": "+91-8130677317",
  "email": "support@quantumaccord.co.in",
  "sameAs": ["[LinkedIn URL]", "[IndiaMART URL]", "[quantumaccordbg.com]"]
}
</script>
```

## quantumaccordbg.com — B2B Services

### Recommended page structure
```
/                      Home: "one partner for site + app + automation"
/voice-automation      AI outbound/inbound calls, enquiry triage, appointment booking
/whatsapp-automation   Auto-replies, lead capture, order updates, catalog sharing
/web-app-saas          Websites, apps (native + cross-platform), SaaS builds
/case-studies          Even 1–2 real ones (your own export business counts)
/contact
/blog
```

### Titles & meta descriptions

| Page | Title | Meta description |
|---|---|---|
| Home | Web, App & AI Automation Agency \| Quantum Accord | Websites, apps, SaaS and AI voice and WhatsApp automation from one partner. Capture more leads and handle every enquiry automatically. |
| Voice automation | AI Voice Call Automation for Business \| Quantum Accord | AI voice agents that make outbound sales calls, answer inbound enquiries and book appointments 24/7. Set up for your business. |
| WhatsApp automation | WhatsApp Automation for Business \| Quantum Accord | Automate WhatsApp replies, lead capture, order updates and catalog sharing. Respond to every customer instantly, day or night. |
| Web/app/SaaS | Website, App & SaaS Development \| Quantum Accord | Business websites, e-commerce, iOS/Android and cross-platform apps, and SaaS products built end to end for growing companies. |

### Must-haves
- Each service page: problem → how it works → use cases → FAQ → CTA.
- FAQ section marked up with `FAQPage` schema (helps Google and AI answers quote you).
- Don't state frameworks, pricing, or SLAs until confirmed (per business profile).

## Both sites
- Submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools (Bing powers several AI assistants' search).
- Link the two sites to each other in the footer ("Our tech services" / "Our export business").
- HTTPS, mobile-friendly, images compressed (WebP).
