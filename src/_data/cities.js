/**
 * Per-city local overlays for the Tier-B (service × niche × city) landing pages.
 * geo is hand-set (real coordinates) for the schema.org GeoCircle areaServed;
 * the prose is generated, locally specific, and safe to edit. Keyed by slug.
 */
export default {
  "san-jose": {
    "name": "San Jose",
    "localContext": "San Jose runs on small businesses that don't make the Silicon Valley headlines — the pho counters along Story Road's Little Saigon, the family shops on Willow Glen's Lincoln Avenue, the taquerias and salons across the East Side and Alum Rock, the studios tucked into Japantown and the SoFA District downtown. They compete next to Santana Row polish and Valley Fair foot traffic, so a slow site or a booking form nobody answers costs them real customers.",
    "areaNote": "We work on-site across San Jose and remotely, and we cover the surrounding cities too — Campbell, Los Gatos, Saratoga, Santa Clara, Cupertino, Sunnyvale, Milpitas, and down 101 to Morgan Hill and Gilroy.",
    "geo": {
      "lat": 37.3382,
      "lng": -121.8863
    },
    "cityFaq": {
      "q": "Do you meet with San Jose businesses in person, or is it all remote?",
      "a": "Both. We're local, so we can come to your shop in Willow Glen, downtown, the East Side, or out toward Almaden and Evergreen for the kickoff and walk-throughs. Most of the build and back-and-forth happens over email and screen-shares, whichever keeps things moving for you."
    }
  },
  "fremont": {
    "name": "Fremont",
    "localContext": "Fremont isn't one downtown — it's five old districts stitched together: Centerville, Niles, Irvington, Mission San Jose, and Warm Springs. The shops tell the story — antique stores and a silent-film past in Niles, the Afghan groceries and kabob houses along Fremont Boulevard people call Little Kabul, Mission San Jose's quiet storefronts near the mission, and the newer build-out around the Warm Springs BART and the Tesla plant.",
    "areaNote": "We work with businesses across Fremont's districts and the neighboring Tri-City area — Newark and Union City — on-site when it helps and remote for the rest, since most of the build happens in the browser anyway.",
    "geo": {
      "lat": 37.5485,
      "lng": -121.9886
    },
    "cityFaq": {
      "q": "Do you work with businesses in the older districts like Niles and Centerville, not just the Warm Springs side?",
      "a": "Yes — most of our Fremont work is in the older commercial strips. A shop on Niles Boulevard, a clinic in Centerville, a restaurant in Mission San Jose: the build is the same. We handle it on-site when a walkthrough helps and remote for the rest, across all five districts and into Newark and Union City."
    }
  },
  "oakland": {
    "name": "Oakland",
    "localContext": "We work with Oakland businesses from the storefronts on Piedmont Avenue and College Avenue's Rockridge stretch to the taquerias and bakeries along Fruitvale's International Boulevard, the warehouses-turned-shops in West Oakland and Jack London Square, and the neighborhood spots in Temescal, Grand Lake, Dimond, and Montclair up in the hills. It's a city of independents — old-line family businesses next to first-gen owners — and the websites rarely keep up with the foot traffic.",
    "areaNote": "We also build for neighboring East Bay businesses — Berkeley, Alameda, Emeryville, San Leandro, and Piedmont — working remotely or meeting on-site across the bridge when it helps.",
    "geo": {
      "lat": 37.8044,
      "lng": -122.2712
    },
    "cityFaq": {
      "q": "Do you work on-site with Oakland businesses or only remotely?",
      "a": "Both. We're a two-person Bay Area studio, so most of the build happens remotely with regular calls. But if you're in Oakland — Fruitvale, Rockridge, Jack London, the hills — we'll come to you to look at how the front desk or the kitchen actually runs before we touch the booking flow. That on-site context usually makes the system better."
    }
  },
  "san-francisco": {
    "name": "San Francisco",
    "localContext": "We work with small businesses across San Francisco's distinct corners — the contractor in the Sunset, the cafe on Valencia in the Mission, the boutique law office near the Financial District, the studio off Hayes Valley. SF customers expect a site that loads fast on a phone walking up Divisadero and books in two taps, not a clunky form.",
    "areaNote": "We also serve the wider Bay Area — Oakland, Berkeley, Daly City, South San Francisco, and down the Peninsula toward San Mateo — working remotely day to day and meeting on-site in the city when a project calls for it.",
    "geo": {
      "lat": 37.7749,
      "lng": -122.4194
    },
    "cityFaq": {
      "q": "Do you understand the San Francisco small-business market?",
      "a": "Yes — we're a local Bay Area studio. We know an SF customer is comparing you on their phone between the N Judah and the next Yelp result, so we build sites that load fast, book or capture a lead in a couple taps, and plug into the tools you already run, whether that's Square in a Mission storefront or a booking system for a SoMa office."
    }
  },
  "hayward": {
    "name": "Hayward",
    "localContext": "Hayward is the East Bay's working backbone — a real, unpretentious town where downtown B Street and the old Foothill corridor sit beside Mt. Eden nurseries, the Cannery district, and Cal State East Bay up on the hill. The small-business market here is diverse and family-run: taquerias, auto shops, dental offices, and contractors stretched along Mission Boulevard and the South Hayward BART corridor.",
    "areaNote": "We work with businesses across the Hayward area too — Castro Valley, San Lorenzo, San Leandro, Union City, and Fremont — both on-site visits and fully remote.",
    "geo": {
      "lat": 37.6688,
      "lng": -122.0808
    },
    "cityFaq": {
      "q": "Do you work with Hayward businesses in person, or only online?",
      "a": "Both. We're a two-person Bay Area studio, so we can meet up at a spot near downtown Hayward or off Mission Boulevard to map out your site and booking setup, then handle the build and ongoing updates remotely. Most of the day-to-day — design tweaks, lead-form changes, AI assistant tuning — happens over email and quick calls, whichever's easiest for you."
    }
  },
  "sunnyvale": {
    "name": "Sunnyvale",
    "localContext": "Sunnyvale runs on two crowds at once — the tech workers filling Moffett Park, Peery Park, and the Apple-and-LinkedIn corridor along Lawrence, and the family-owned shops lining Historic Murphy Avenue and the El Camino Real strip. Downtown's Saturday farmers market and the Heritage District set the pace, while neighborhoods like Cherry Chase, Birdland, and Ortega Park keep the local trade steady.",
    "areaNote": "We're a short hop from the rest of the mid-Peninsula, so we also build for businesses in Mountain View, Cupertino, Santa Clara, and Los Altos — most of the work is remote, with on-site visits in Sunnyvale and the surrounding cities when a project calls for it.",
    "geo": {
      "lat": 37.3688,
      "lng": -122.0363
    },
    "cityFaq": {
      "q": "Do you work with small, family-run businesses in Sunnyvale, or just tech companies?",
      "a": "Family-run shops are exactly who we build for — the kind you'll find along Murphy Avenue, El Camino, and the Heritage District. We're a two-person studio, so you talk to the people doing the work. We connect your site to the tools you already use for booking, ordering, or leads, and we keep it simple enough to run yourself."
    }
  },
  "santa-clara": {
    "name": "Santa Clara",
    "localContext": "Santa Clara is the Mission City — a working town where Nvidia, Intel, and AMD share streets with the family shops along El Camino Real, the Old Quad's historic blocks near Santa Clara University, and the newer storefronts around Rivermark Village. Between Levi's Stadium crowds and the Lawrence Expressway commute, local businesses here compete against deep-pocketed tech neighbors for the same customers' attention.",
    "areaNote": "We work on-site and remotely across Santa Clara and the surrounding South Bay — Sunnyvale, Cupertino, San Jose, Campbell, and Milpitas — so a quick visit to your shop on El Camino or near Rivermark is no problem.",
    "geo": {
      "lat": 37.3541,
      "lng": -121.9552
    },
    "cityFaq": {
      "q": "Do you work with small businesses in Santa Clara, or just tech companies?",
      "a": "Small businesses, specifically. The two of us build websites and booking, lead, and AI assistant systems for the shops, clinics, and restaurants around Santa Clara — from the Old Quad near the university to the El Camino corridor and Rivermark. We can meet in person or handle the whole thing over a call and email."
    }
  },
  "berkeley": {
    "name": "Berkeley",
    "localContext": "Berkeley's small-business map runs from the Gourmet Ghetto around Shattuck and Chez Panisse to the design showrooms on Fourth Street, the student crush of Telegraph by campus, and the indie storefronts of Elmwood on College Avenue and Solano. It's a town of owner-run shops, makers in West Berkeley, and practices that win on reputation, not ad budgets.",
    "areaNote": "We're two founders working on-site and remote across the East Bay, so we also build for businesses in neighboring Oakland, Albany, Emeryville, El Cerrito, and Kensington.",
    "geo": {
      "lat": 37.8715,
      "lng": -122.273
    },
    "cityFaq": {
      "q": "Do you work with small Berkeley businesses, not just big companies?",
      "a": "Yes — that's who we build for. Most of our work is owner-run shops, practices, and studios from the Gourmet Ghetto to Fourth Street to Telegraph. We can meet on-site here in Berkeley or work remotely, whichever is easier for you."
    }
  },
  "palo-alto": {
    "name": "Palo Alto",
    "localContext": "Palo Alto runs on two main streets — University Avenue downtown, where the restaurants and tech offices stack up, and California Avenue, the quieter neighborhood spine with its Sunday farmers market. Around them sit Old Palo Alto, Crescent Park, Professorville, College Terrace, and Midtown, plus Stanford and Town & Country Village. It's a discerning, professional crowd that expects a polished site.",
    "areaNote": "We work with businesses across Palo Alto and the neighboring Menlo Park, Mountain View, Los Altos, Stanford, and East Palo Alto — on-site when it helps, remote when that's faster.",
    "geo": {
      "lat": 37.4419,
      "lng": -122.143
    },
    "cityFaq": {
      "q": "Do you work with businesses on both University Avenue and California Avenue?",
      "a": "Yes. We cover the whole city — the busy University Avenue corridor downtown, the more neighborhood-feeling California Avenue district, and the residential pockets like Midtown, College Terrace, and Crescent Park. We'll meet at your shop or over a call, whichever is easier."
    }
  }
};
