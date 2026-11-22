UPDATE series SET title = 'The Reaction Files',
  description = 'The streams, videos, and court rulings that shaped the fight over reaction content.', category = 'Fair use'
WHERE id = 'studio-notes' AND title = 'Studio Notes';

UPDATE series SET title = 'Creator Crossfire',
  description = 'How a clash over reaction videos reached YouTube itself.', category = 'Creator disputes'
WHERE id = 'open-folder' AND title = 'Open Folder';

INSERT INTO series (id, title, description, category, random_order, created_at)
VALUES ('internet-casefiles', 'Internet Case Files', 'Public reports on disputes that spilled out of the feed and into the courts.', 'Deep dives', 0, 1785902400000)
ON CONFLICT DO NOTHING;

UPDATE clips SET title = 'When H3 Won in Court',
  description = 'In 2017, a federal court found that Ethan and Hila Klein’s reaction to a YouTube video was fair use.',
  category = 'Fair use', published_at = 1503547200000,
  source_url = 'https://copyright.gov/fair-use/summaries/hosseinzadeh-klein-sdny2017.pdf'
WHERE id = 'first-cut' AND demo = 1 AND title = 'The First Cut';

UPDATE clips SET title = 'Klein and Piker, Live',
  description = 'Ethan Klein and Hasan Piker spoke face to face during a live episode of The H3 Show in May 2025.',
  category = 'On the record', published_at = 1746187200000,
  source_url = 'https://www.youtube.com/watch?v=knMyMxXeoDY'
WHERE id = 'late-edit' AND demo = 1 AND title = 'The Late Edit';

UPDATE clips SET title = 'React Channels Clash',
  description = 'JacksFilms criticized SSSniperWolf’s reaction videos. Their public dispute drew an audience far beyond either channel.',
  category = 'Creator disputes', published_at = 1697630400000,
  source_url = 'https://time.com/6326625/sssniperwolf-jacksfilms-youtube-demonetize/'
WHERE id = 'outtakes' AND demo = 1 AND title = 'Outtakes';

UPDATE clips SET title = 'YouTube Steps In',
  description = 'YouTube said it temporarily suspended monetization for SSSniperWolf. She posted an apology after the dispute.',
  category = 'On the record', published_at = 1697803200000,
  source_url = 'https://www.tubefilter.com/2023/10/23/youtube-demonetizes-sssniperwolf-jacksfilms-house/'
WHERE id = 'setting-up' AND demo = 1 AND title = 'Setting Up';

UPDATE clips SET title = 'The Reaction Ruling',
  description = 'A livestream of Ethan Klein’s documentary became a fair-use fight. In June 2026, a federal judge sided with streamer Denims.',
  category = 'Commentary', series_id = 'studio-notes', published_at = 1782734400000,
  source_url = 'https://www.copyright.gov/fair-use/summaries/Ted-Entmt-Inc-v-Saber-25-cv-05564-CD-Cal-2026.pdf'
WHERE id = 'frame-by-frame' AND demo = 1 AND title = 'Frame by Frame';

UPDATE clips SET title = 'The Fair Use Fallout',
  description = 'KQED spoke with Denims and a journalist about the H3 cases and what they could mean for reaction videos.',
  category = 'Deep dives', series_id = 'internet-casefiles', published_at = 1785931200000,
  source_url = 'https://www.kqed.org/news/12093869/why-the-ethan-klein-fair-use-lawsuits-are-way-more-than-internet-beef'
WHERE id = 'studio-walk' AND demo = 1 AND title = 'Studio Walk';

INSERT INTO clips (id, title, description, category, guest, series_id, status, created_at, published_at, duration, demo, source_url)
VALUES ('cryptozoo-case', 'Inside CryptoZoo', 'BBC News looked at Logan Paul’s crypto projects and the questions that followed the launch of CryptoZoo.',
  'Deep dives', 1, 'internet-casefiles', 'ready', 1732104000000, 1732104000000, 12, 1,
  'https://www.youtube.com/watch?v=U9Q6ZTj8jA0')
ON CONFLICT DO NOTHING;
