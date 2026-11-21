// Canonical 66-book list. `num` is the standard book number used by
// wol.jw.org Bible URLs (Genesis = 1 … John = 43 … Revelation = 66).
// `section` groups books into boss-battle arcs.
const RAW = [
  // Hebrew Scriptures
  [1,'Genesis',50,'Pentateuch'],[2,'Exodus',40,'Pentateuch'],[3,'Leviticus',27,'Pentateuch'],
  [4,'Numbers',36,'Pentateuch'],[5,'Deuteronomy',34,'Pentateuch'],
  [6,'Joshua',24,'History'],[7,'Judges',21,'History'],[8,'Ruth',4,'History'],
  [9,'1 Samuel',31,'History'],[10,'2 Samuel',24,'History'],[11,'1 Kings',22,'History'],
  [12,'2 Kings',25,'History'],[13,'1 Chronicles',29,'History'],[14,'2 Chronicles',36,'History'],
  [15,'Ezra',10,'History'],[16,'Nehemiah',13,'History'],[17,'Esther',10,'History'],
  [18,'Job',42,'Poetry'],[19,'Psalms',150,'Poetry'],[20,'Proverbs',31,'Poetry'],
  [21,'Ecclesiastes',12,'Poetry'],[22,'Song of Solomon',8,'Poetry'],
  [23,'Isaiah',66,'Major Prophets'],[24,'Jeremiah',52,'Major Prophets'],
  [25,'Lamentations',5,'Major Prophets'],[26,'Ezekiel',48,'Major Prophets'],[27,'Daniel',12,'Major Prophets'],
  [28,'Hosea',14,'Minor Prophets'],[29,'Joel',3,'Minor Prophets'],[30,'Amos',9,'Minor Prophets'],
  [31,'Obadiah',1,'Minor Prophets'],[32,'Jonah',4,'Minor Prophets'],[33,'Micah',7,'Minor Prophets'],
  [34,'Nahum',3,'Minor Prophets'],[35,'Habakkuk',3,'Minor Prophets'],[36,'Zephaniah',3,'Minor Prophets'],
  [37,'Haggai',2,'Minor Prophets'],[38,'Zechariah',14,'Minor Prophets'],[39,'Malachi',4,'Minor Prophets'],
  // Christian Greek Scriptures
  [40,'Matthew',28,'Gospels'],[41,'Mark',16,'Gospels'],[42,'Luke',24,'Gospels'],[43,'John',21,'Gospels'],
  [44,'Acts',28,'Acts'],
  [45,'Romans',16,"Paul's Letters"],[46,'1 Corinthians',16,"Paul's Letters"],[47,'2 Corinthians',13,"Paul's Letters"],
  [48,'Galatians',6,"Paul's Letters"],[49,'Ephesians',6,"Paul's Letters"],[50,'Philippians',4,"Paul's Letters"],
  [51,'Colossians',4,"Paul's Letters"],[52,'1 Thessalonians',5,"Paul's Letters"],[53,'2 Thessalonians',3,"Paul's Letters"],
  [54,'1 Timothy',6,"Paul's Letters"],[55,'2 Timothy',4,"Paul's Letters"],[56,'Titus',3,"Paul's Letters"],
  [57,'Philemon',1,"Paul's Letters"],[58,'Hebrews',13,"Paul's Letters"],
  [59,'James',5,'General Letters'],[60,'1 Peter',5,'General Letters'],[61,'2 Peter',3,'General Letters'],
  [62,'1 John',5,'General Letters'],[63,'2 John',1,'General Letters'],[64,'3 John',1,'General Letters'],
  [65,'Jude',1,'General Letters'],[66,'Revelation',22,'Revelation'],
];

export const BOOKS = RAW.map(([num, name, chapters, section]) => ({
  num, name, chapters, section,
  testament: num <= 39 ? 'Hebrew Scriptures' : 'Christian Greek Scriptures',
}));

export const BOOK_BY_NUM = Object.fromEntries(BOOKS.map(b => [b.num, b]));

// Quest path: John is the entry quest (the 30-day onboarding habit), then the
// rest of the Greek Scriptures in canonical order, then the Hebrew Scriptures.
// Change this array to re-route the campaign; the engine reads only this.
export const QUEST_ORDER = [
  43,
  ...BOOKS.filter(b => b.num >= 40 && b.num !== 43).map(b => b.num),
  ...BOOKS.filter(b => b.num <= 39).map(b => b.num),
];

export const TOTAL_CHAPTERS = BOOKS.reduce((s, b) => s + b.chapters, 0); // 1189
