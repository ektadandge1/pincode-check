const REGIONS_BY_COUNTRY: Record<string, string[]> = {
  AU: "Australian Capital Territory|New South Wales|Northern Territory|Queensland|South Australia|Tasmania|Victoria|Western Australia".split("|"),
  CA: "Alberta|British Columbia|Manitoba|New Brunswick|Newfoundland and Labrador|Northwest Territories|Nova Scotia|Nunavut|Ontario|Prince Edward Island|Quebec|Saskatchewan|Yukon".split("|"),
  DE: "Baden-Wurttemberg|Bavaria|Berlin|Brandenburg|Bremen|Hamburg|Hesse|Lower Saxony|Mecklenburg-Vorpommern|North Rhine-Westphalia|Rhineland-Palatinate|Saarland|Saxony|Saxony-Anhalt|Schleswig-Holstein|Thuringia".split("|"),
  ES: "Andalusia|Aragon|Asturias|Balearic Islands|Basque Country|Canary Islands|Cantabria|Castile and Leon|Castilla-La Mancha|Catalonia|Ceuta|Extremadura|Galicia|La Rioja|Madrid|Melilla|Murcia|Navarre|Valencian Community".split("|"),
  FR: "Auvergne-Rhone-Alpes|Bourgogne-Franche-Comte|Brittany|Centre-Val de Loire|Corsica|French Guiana|Grand Est|Guadeloupe|Hauts-de-France|Ile-de-France|Martinique|Mayotte|Normandy|Nouvelle-Aquitaine|Occitanie|Pays de la Loire|Provence-Alpes-Cote d'Azur|Reunion".split("|"),
  GB: "England|Northern Ireland|Scotland|Wales".split("|"),
  IN: "Andaman and Nicobar Islands|Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chandigarh|Chhattisgarh|Dadra and Nagar Haveli and Daman and Diu|Delhi|Goa|Gujarat|Haryana|Himachal Pradesh|Jammu and Kashmir|Jharkhand|Karnataka|Kerala|Ladakh|Lakshadweep|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Puducherry|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal".split("|"),
  IT: "Abruzzo|Aosta Valley|Apulia|Basilicata|Calabria|Campania|Emilia-Romagna|Friuli-Venezia Giulia|Lazio|Liguria|Lombardy|Marche|Molise|Piedmont|Sardinia|Sicily|Trentino-South Tyrol|Tuscany|Umbria|Veneto".split("|"),
  JP: "Aichi|Akita|Aomori|Chiba|Ehime|Fukui|Fukuoka|Fukushima|Gifu|Gunma|Hiroshima|Hokkaido|Hyogo|Ibaraki|Ishikawa|Iwate|Kagawa|Kagoshima|Kanagawa|Kochi|Kumamoto|Kyoto|Mie|Miyagi|Miyazaki|Nagano|Nagasaki|Nara|Niigata|Oita|Okayama|Okinawa|Osaka|Saga|Saitama|Shiga|Shimane|Shizuoka|Tochigi|Tokushima|Tokyo|Tottori|Toyama|Wakayama|Yamagata|Yamaguchi|Yamanashi".split("|"),
  NL: "Drenthe|Flevoland|Friesland|Gelderland|Groningen|Limburg|North Brabant|North Holland|Overijssel|South Holland|Utrecht|Zeeland".split("|"),
  NZ: "Auckland|Bay of Plenty|Canterbury|Chatham Islands|Gisborne|Hawke's Bay|Manawatu-Whanganui|Marlborough|Nelson|Northland|Otago|Southland|Taranaki|Tasman|Waikato|Wellington|West Coast".split("|"),
  US: "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming".split("|"),
};

export function regionsForCountry(countryCode: string): string[] {
  return REGIONS_BY_COUNTRY[countryCode.toUpperCase()] ?? [];
}

export function suggestedRegions(countryCode: string, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return regionsForCountry(countryCode)
    .filter((region) => !normalizedQuery || region.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftStarts = left.toLocaleLowerCase().startsWith(normalizedQuery);
      const rightStarts = right.toLocaleLowerCase().startsWith(normalizedQuery);
      return Number(rightStarts) - Number(leftStarts) || left.localeCompare(right);
    })
    .map((region) => ({ label: region, value: region }));
}
