// Builds data/real-brands.json: the register of real brands used to name the dataset's records.
// Evidence tiers come only from pages we opened (sources below). Youth fit and Bengaluru presence are
// judgement scores, labelled as assumptions in the app and the methodology doc.
import { writeFileSync } from "node:fs";
const SRC = {
  unmaad: "https://www.knowafest.com/explore/events/2022/01/2405-unmaad-22-iim-bangalore-cultural-festival-bengaluru",
  unmaad23: "https://insideiim.com/unmaad-2023-iim-bangalores-cultural-festival",
  moodi: "https://en.wikipedia.org/wiki/Mood_Indigo_(festival)",
  rdv: "https://www.fonearena.com/blog/?p=387615",
  eze: "https://fashionvaluechain.com/eze-perfumes-elevates-senses-as-title-sponsor-of-vogue-scented-by-partner-of-mood-indigo-iit-bombays-asias-largest-college-festival",
};
const EV = {
  unmaad: ["unmaad_past", "Listed among Unmaad's past sponsors", SRC.unmaad],
  unmaad23: ["unmaad_past", "Unmaad 2023 was held in association with Coca-Cola", SRC.unmaad23],
  moodi: ["peer_fest", "Past sponsor of Mood Indigo, IIT Bombay", SRC.moodi],
  rdv: ["peer_fest", "Official smartphone partner and Pronite title sponsor, Rendezvous 2023 (IIT Delhi)", SRC.rdv],
  eze: ["peer_fest", "Title sponsor of a Mood Indigo 2023 segment", SRC.eze],
};
// [name, real-world category, evidence key or "", youth fit 10|20|30, Bengaluru presence 5|10|20]
const LISTS = {
  "Consumer products": [
    ["Realme","Smartphones","unmaad",30,10],["Skullcandy","Audio","unmaad",30,5],["LG","Electronics and appliances","unmaad",10,10],["Sparx","Footwear (Relaxo)","unmaad",20,5],["Kajaria","Tiles","unmaad",10,5],["JSW","Conglomerate (steel, paints)","unmaad",10,10],
    ["OnePlus","Smartphones","moodi",30,10],["Levi's","Apparel","moodi",20,10],["Nivea","Skin care","moodi",20,5],["Colgate","Oral care","moodi",10,5],["TECNO","Smartphones","rdv",30,5],["Eze Perfumes","Fragrance","eze",20,5],
    ["boAt","Audio and wearables","",30,5],["Noise","Wearables","",30,5],["Nothing","Smartphones","",30,10],["iQOO","Smartphones","",30,5],["Samsung","Electronics","",20,10],["Xiaomi","Smartphones","",20,20],["HP","Laptops","",20,10],["Lenovo","Laptops","",20,10],["ASUS","Laptops","",20,5],["Dell","Laptops","",10,20],["Acer","Laptops","",10,5],["JBL","Audio","",20,5],
    ["Titan","Watches","",10,20],["Fastrack","Watches and eyewear","",30,20],["Casio","Watches","",10,5],["Wildcraft","Outdoor gear","",20,20],["Decathlon","Sportswear","",20,10],["Puma","Sportswear","",30,20],["Bewakoof","Apparel","",30,5],["The Souled Store","Apparel","",30,5],["Snitch","Apparel","",30,20],["Campus","Footwear","",30,5],["Lenskart","Eyewear","",20,10],["Philips","Personal appliances","",10,10],
  ],
  "Food and beverage": [
    ["Pepsi","Soft drinks","unmaad",30,10],["Coca-Cola","Soft drinks","unmaad23",30,10],["Nestlé","Packaged food","unmaad",20,10],["Swiggy","Food delivery","unmaad",30,20],["Oreo","Biscuits","moodi",20,5],["Parle","Biscuits and snacks","moodi",20,5],
    ["Red Bull","Energy drinks","",30,10],["Monster Energy","Energy drinks","",30,5],["Zomato","Food delivery","",30,10],["Zepto","Quick commerce","",30,10],["Blinkit","Quick commerce","",30,10],["BigBasket","Online grocery","",10,20],["Domino's","Pizza","",30,10],["Pizza Hut","Pizza","",20,5],["KFC","Quick service restaurant","",30,5],["McDonald's","Quick service restaurant","",30,5],["Burger King","Quick service restaurant","",30,5],["Subway","Quick service restaurant","",20,5],
    ["Starbucks","Coffee chain","",20,10],["Third Wave Coffee","Coffee chain","",30,20],["Blue Tokai","Coffee","",20,10],["Chai Point","Tea chain","",20,20],["Chaayos","Tea chain","",20,5],["Haldiram's","Snacks","",10,5],["Too Yumm","Snacks","",30,5],["Bingo!","Snacks","",30,5],["Cadbury","Chocolate","",20,5],["Amul","Dairy","",10,5],["Paper Boat","Beverages","",30,20],["Raw Pressery","Juices","",20,5],["Sleepy Owl","Coffee","",30,5],["Bisleri","Bottled water","",10,5],["Licious","Meat delivery","",10,20],["Box8","Food delivery","",30,10],["Wow! Momo","Quick service restaurant","",30,10],["Theobroma","Bakery","",20,5],["iD Fresh Food","Packaged food","",10,20],
  ],
  "Education": [
    ["LinkedIn","Careers network","moodi",30,10],
    ["Unstop","Student competitions and hiring","",30,5],["Internshala","Internships","",30,5],["upGrad","Online degrees","",20,10],["Unacademy","Test prep","",30,20],["PhysicsWallah","Test prep","",30,10],["Coding Ninjas","Coding courses","",30,5],["Scaler","Tech upskilling","",30,20],["Simplilearn","Online courses","",20,20],["Great Learning","Online courses","",20,20],["Seekho","Short-video learning","",30,20],["Vedantu","Online tutoring","",20,20],
    ["Testbook","Exam prep","",20,5],["Adda247","Exam prep","",20,5],["IMS Learning","MBA test prep","",30,10],["T.I.M.E.","MBA test prep","",30,10],["Career Launcher","MBA test prep","",30,10],["Leverage Edu","Study abroad","",30,5],["Jamboree","Study abroad test prep","",30,10],["Collegedunia","College discovery","",20,5],["Shiksha","College discovery","",20,5],["Naukri","Jobs portal","",20,10],["Apna","Jobs app","",20,20],["Coursera","Online courses","",20,5],["Duolingo","Language learning","",30,5],
    ["Masai School","Tech bootcamp","",30,20],["Newton School","Tech bootcamp","",30,20],["AlmaBetter","Tech bootcamp","",30,10],["GeeksforGeeks","Coding platform","",30,5],["Hero Vired","Online courses","",20,5],["Emeritus","Executive education","",10,5],["Harappa","Workplace skills","",10,5],["Jaro Education","Executive education","",10,5],["Cuemath","Maths tutoring","",10,20],["Eduvanz","Education loans","",20,20],
  ],
  "Media": [
    ["PVR INOX","Cinemas","moodi",30,10],
    ["Spotify","Music streaming","",30,10],["JioSaavn","Music streaming","",30,5],["Gaana","Music streaming","",20,5],["Prime Video","Video streaming","",20,10],["Netflix","Video streaming","",30,5],["JioHotstar","Video streaming","",20,5],["SonyLIV","Video streaming","",20,5],["ZEE5","Video streaming","",20,5],["MTV India","Youth TV","",30,5],["Radio Mirchi","Radio","",20,10],["Red FM","Radio","",20,10],["Radio City","Radio","",20,10],
    ["BookMyShow","Event ticketing","",30,10],["District by Zomato","Event ticketing","",30,10],["Pocket FM","Audio series","",30,20],["Kuku FM","Audio learning","",20,20],["ShareChat","Social media","",30,20],["Moj","Short video","",30,20],["Josh","Short video","",30,20],["Dailyhunt","News aggregator","",20,20],["Inshorts","News app","",30,5],
    ["The Hindu","Newspaper","",10,10],["Deccan Herald","Newspaper","",10,20],["The Times of India","Newspaper","",10,10],["Hindustan Times","Newspaper","",10,5],["The Economic Times","Business news","",20,10],["Mint","Business news","",20,5],["YourStory","Startup media","",20,20],["ScoopWhoop","Digital media","",30,5],["TVF","Digital entertainment","",30,5],["Dice Media","Digital entertainment","",30,5],["OML Entertainment","Talent and events","",30,5],["Sunburn","Music festivals","",30,5],["Audible","Audiobooks","",20,5],
  ],
  "Mobility": [
    ["Hero MotoCorp","Two-wheelers","unmaad",20,10],
    ["Rapido","Bike taxi","",30,20],["Uber","Ride hailing","",30,10],["Ola","Ride hailing","",20,20],["Namma Yatri","Auto rides","",30,20],["Yulu","E-bike rental","",30,20],["Bounce","Scooter rental","",30,20],["Ather Energy","Electric scooters","",30,20],["Ola Electric","Electric scooters","",30,20],["Simple Energy","Electric scooters","",20,20],["Ultraviolette","Electric motorcycles","",30,20],["Vogo","Scooter rental","",20,20],["Quick Ride","Carpooling","",20,20],
    ["TVS Motor","Two-wheelers","",20,10],["Royal Enfield","Motorcycles","",30,10],["Bajaj Auto","Two-wheelers","",20,5],["Honda Motorcycle & Scooter India","Two-wheelers","",20,5],["Yamaha","Two-wheelers","",30,5],["Suzuki Motorcycle India","Two-wheelers","",20,5],["KTM","Motorcycles","",30,5],
    ["Tata Motors","Cars","",10,5],["Mahindra","SUVs","",10,5],["Hyundai","Cars","",10,5],["Kia","Cars","",20,5],["MG Motor","Cars","",10,5],["Maruti Suzuki","Cars","",10,5],["Toyota Kirloskar Motor","Cars","",10,20],["Zoomcar","Car rental","",20,20],
    ["redBus","Bus tickets","",30,20],["IndiGo","Airline","",20,10],["Akasa Air","Airline","",20,5],["Air India Express","Airline","",10,5],["ixigo","Travel booking","",30,5],["MakeMyTrip","Travel booking","",20,5],["Goibibo","Travel booking","",20,5],["Cleartrip","Travel booking","",20,20],
  ],
  "Personal care": [["Beardo","Men's grooming","",30,5]],
};
// Verified past sponsors outside the dataset's industries: kept for the live-season prospect list.
const EXTRA = [
  ["SBI","Banking","unmaad",10,10],["Amazon Pay","Payments","unmaad",30,10],["Canara Bank","Banking","moodi",10,20],
  ["HDFC Bank","Banking","",20,10],["ICICI Bank","Banking","",20,10],["Axis Bank","Banking","",20,10],["Kotak Mahindra Bank","Banking","",20,10],["CRED","Payments and credit","",30,20],["PhonePe","Payments","",30,20],["Google Pay","Payments","",30,10],["Paytm","Payments","",30,5],["Groww","Investing","",30,20],["Zerodha","Investing","",30,20],["FamPay","Teen payments","",30,20],["Jupiter","Neobank","",30,20],["Navi","Financial services","",30,20],
  ["Flipkart","E-commerce","",30,20],["Myntra","Fashion e-commerce","",30,20],["Amazon","E-commerce","",30,10],["Meesho","E-commerce","",20,20],["Nykaa","Beauty e-commerce","",30,5],["Ajio","Fashion e-commerce","",30,10],
  ["Mamaearth","Personal care","",30,5],["The Man Company","Men's grooming","",30,5],["Bombay Shaving Company","Men's grooming","",30,5],["mCaffeine","Personal care","",30,5],["Minimalist","Skin care","",30,5],["Plum","Skin care","",30,5],["Fogg","Fragrance","",30,5],["Wild Stone","Fragrance","",30,5],
];
const evidence = k => k ? EV[k] : ["none", "No fest sponsorship verified in our research", ""];
const rows = [];
for (const [industry, list] of Object.entries(LISTS)) for (const [name, category, ev, youth, blr] of list) {
  const [tier, note, source] = evidence(ev);
  rows.push({ name, industry, category, evidence: tier, evidenceNote: note, source, youth, bengaluru: blr });
}
for (const [name, category, ev, youth, blr] of EXTRA) {
  const [tier, note, source] = evidence(ev);
  rows.push({ name, industry: "Financial services and e-commerce", category, evidence: tier, evidenceNote: note, source, youth, bengaluru: blr, liveOnly: true });
}
const names = rows.map(r => r.name), dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) throw new Error("Duplicate brands: " + dupes.join(", "));
writeFileSync(new URL("../data/real-brands.json", import.meta.url), JSON.stringify(rows, null, 1));
const by = {}; for (const r of rows) by[r.industry] = (by[r.industry] || 0) + 1;
console.log(rows.length, "brands", by, "verified:", rows.filter(r => r.evidence !== "none").length);
