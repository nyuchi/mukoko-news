-- Mukoko News — Seed Data for Fly.io Postgres
-- Countries, Article Sections (categories), Organizations (RSS sources)

-- ================================================
-- COUNTRIES
-- ================================================

INSERT INTO countries (id, name, flag_emoji, color, region, in_language, timezone, enabled, priority) VALUES
('ZW', 'Zimbabwe',     '🇿🇼', 'bg-green-600',  'southern', 'en', 'Africa/Harare',        TRUE, 10),
('ZA', 'South Africa', '🇿🇦', 'bg-yellow-500', 'southern', 'en', 'Africa/Johannesburg',  TRUE, 9),
('KE', 'Kenya',        '🇰🇪', 'bg-red-600',    'eastern',  'en', 'Africa/Nairobi',       TRUE, 8),
('NG', 'Nigeria',      '🇳🇬', 'bg-green-500',  'western',  'en', 'Africa/Lagos',         TRUE, 7),
('GH', 'Ghana',        '🇬🇭', 'bg-yellow-400', 'western',  'en', 'Africa/Accra',         TRUE, 6),
('TZ', 'Tanzania',     '🇹🇿', 'bg-blue-500',   'eastern',  'sw', 'Africa/Dar_es_Salaam', TRUE, 5),
('UG', 'Uganda',       '🇺🇬', 'bg-yellow-600', 'eastern',  'en', 'Africa/Kampala',       TRUE, 5),
('RW', 'Rwanda',       '🇷🇼', 'bg-cyan-500',   'eastern',  'en', 'Africa/Kigali',        TRUE, 4),
('ET', 'Ethiopia',     '🇪🇹', 'bg-green-400',  'eastern',  'am', 'Africa/Addis_Ababa',   TRUE, 4),
('BW', 'Botswana',     '🇧🇼', 'bg-sky-400',    'southern', 'en', 'Africa/Gaborone',      TRUE, 4),
('ZM', 'Zambia',       '🇿🇲', 'bg-orange-500', 'southern', 'en', 'Africa/Lusaka',        TRUE, 4),
('MW', 'Malawi',       '🇲🇼', 'bg-red-500',    'southern', 'en', 'Africa/Blantyre',      TRUE, 3),
('EG', 'Egypt',        '🇪🇬', 'bg-red-700',    'northern', 'ar', 'Africa/Cairo',         TRUE, 3),
('MA', 'Morocco',      '🇲🇦', 'bg-red-600',    'northern', 'ar', 'Africa/Casablanca',    TRUE, 3),
('NA', 'Namibia',      '🇳🇦', 'bg-blue-600',   'southern', 'en', 'Africa/Windhoek',      TRUE, 3),
('MZ', 'Mozambique',   '🇲🇿', 'bg-yellow-500', 'southern', 'pt', 'Africa/Maputo',        TRUE, 3)
ON CONFLICT (id) DO NOTHING;

-- ================================================
-- ARTICLE SECTIONS (categories)
-- ================================================

INSERT INTO article_sections (id, name, description, emoji, color, classification_keywords, enabled, sort_order) VALUES
('politics',      'Politics',      'Political news and government affairs',      '🏛️', 'bg-red-500',     '["politics", "government", "election", "vote", "parliament", "minister", "president", "policy", "law", "legislation", "democracy", "party", "campaign", "political", "governance", "reform"]', TRUE, 1),
('economy',       'Economy',       'Economic news, business, and finance',       '💰', 'bg-emerald-500', '["economy", "business", "finance", "banking", "investment", "market", "economic", "financial", "money", "currency", "inflation", "gdp", "trade", "export", "import", "stock", "mining"]', TRUE, 2),
('technology',    'Technology',    'Technology, innovation, and digital news',    '💻', 'bg-blue-500',    '["technology", "tech", "digital", "innovation", "startup", "internet", "mobile", "app", "software", "ai", "blockchain", "fintech", "ict"]', TRUE, 3),
('sports',        'Sports',        'Sports news and events',                     '⚽', 'bg-orange-500',  '["sports", "football", "soccer", "cricket", "rugby", "tennis", "athletics", "olympics", "world cup", "premier league"]', TRUE, 4),
('health',        'Health',        'Health, medical, and wellness news',         '🏥', 'bg-green-500',   '["health", "medical", "hospital", "doctor", "medicine", "healthcare", "pandemic", "vaccine", "disease", "treatment", "wellness"]', TRUE, 5),
('education',     'Education',     'Education news and academic affairs',        '📚', 'bg-violet-500',  '["education", "school", "university", "student", "teacher", "learning", "academic", "examination"]', TRUE, 6),
('entertainment', 'Entertainment', 'Entertainment, arts, and culture',           '🎬', 'bg-pink-500',    '["entertainment", "music", "movie", "film", "celebrity", "artist", "culture", "arts", "theatre", "concert", "festival"]', TRUE, 7),
('international', 'International', 'International and world news',               '🌍', 'bg-cyan-500',    '["international", "world", "global", "foreign", "africa", "sadc"]', TRUE, 8),
('general',       'General',       'General news and updates',                   '📰', 'bg-lime-500',    '["news", "zimbabwe", "africa", "breaking", "latest", "update"]', TRUE, 9),
('agriculture',   'Agriculture',   'Agricultural news and farming',              '🌾', 'bg-amber-500',   '["agriculture", "farming", "crop", "livestock", "tobacco", "maize", "farmer", "harvest", "land", "rural"]', TRUE, 10),
('crime',         'Crime',         'Crime and law enforcement news',             '🚔', 'bg-red-600',     '["crime", "police", "arrest", "court", "justice", "theft", "murder", "robbery", "investigation", "criminal"]', TRUE, 11),
('environment',   'Environment',   'Environmental news and conservation',        '🌿', 'bg-green-600',   '["environment", "climate", "conservation", "pollution", "wildlife", "deforestation", "renewable", "sustainability"]', TRUE, 12)
ON CONFLICT (id) DO NOTHING;

-- ================================================
-- ORGANIZATIONS (RSS news sources)
-- ================================================

INSERT INTO organizations (id, name, url, rss_feed_url, area_served, article_section_id, enabled, priority) VALUES
-- Zimbabwe
('herald-zimbabwe',      'Herald Zimbabwe',       'https://www.herald.co.zw',       'https://www.herald.co.zw/feed/',       'ZW', 'general', TRUE, 5),
('newsday-zimbabwe',     'NewsDay Zimbabwe',      'https://www.newsday.co.zw',      'https://www.newsday.co.zw/feed/',      'ZW', 'general', TRUE, 5),
('chronicle-zimbabwe',   'Chronicle Zimbabwe',    'https://www.chronicle.co.zw',    'https://www.chronicle.co.zw/feed/',    'ZW', 'general', TRUE, 5),
('zbc-news',             'ZBC News',              'https://www.zbc.co.zw',          'https://www.zbc.co.zw/feed/',          'ZW', 'general', TRUE, 4),
('business-weekly',      'Business Weekly',       'https://businessweekly.co.zw',   'https://businessweekly.co.zw/feed/',   'ZW', 'economy', TRUE, 4),
('techzim',              'Techzim',               'https://www.techzim.co.zw',      'https://www.techzim.co.zw/feed/',      'ZW', 'technology', TRUE, 4),
('the-standard',         'The Standard',          'https://www.thestandard.co.zw',  'https://www.thestandard.co.zw/feed/',  'ZW', 'general', TRUE, 4),
('zimlive',              'ZimLive',               'https://www.zimlive.com',        'https://www.zimlive.com/feed/',        'ZW', 'general', TRUE, 4),
('new-zimbabwe',         'New Zimbabwe',          'https://www.newzimbabwe.com',    'https://www.newzimbabwe.com/feed/',     'ZW', 'general', TRUE, 4),
('the-independent',      'The Independent',       'https://www.theindependent.co.zw', 'https://www.theindependent.co.zw/feed/', 'ZW', 'general', TRUE, 4),
('sunday-mail',          'Sunday Mail',           'https://www.sundaymail.co.zw',   'https://www.sundaymail.co.zw/feed/',   'ZW', 'general', TRUE, 3),
('263chat',              '263Chat',               'https://263chat.com',            'https://263chat.com/feed/',             'ZW', 'general', TRUE, 4),
('daily-news',           'Daily News',            'https://www.dailynews.co.zw',    'https://www.dailynews.co.zw/feed/',    'ZW', 'general', TRUE, 4),
('zimeye',               'ZimEye',                'https://zimeye.net',             'https://zimeye.net/feed/',              'ZW', 'general', TRUE, 3),
('pindula-news',         'Pindula News',          'https://news.pindula.co.zw',     'https://news.pindula.co.zw/feed/',     'ZW', 'general', TRUE, 3),
('zimbabwe-situation',   'Zimbabwe Situation',    'https://zimbabwesituation.com',  'https://zimbabwesituation.com/feed/',  'ZW', 'general', TRUE, 3),
('nehanda-radio',        'Nehanda Radio',         'https://nehandaradio.com',       'https://nehandaradio.com/feed/',       'ZW', 'general', TRUE, 3),
('open-news-zimbabwe',   'Open News Zimbabwe',    'https://opennews.co.zw',         'https://opennews.co.zw/feed/',         'ZW', 'general', TRUE, 3),
('financial-gazette',    'Financial Gazette',     'https://fingaz.co.zw',           'https://fingaz.co.zw/feed/',           'ZW', 'economy', TRUE, 4),
('manica-post',          'Manica Post',           'https://manicapost.co.zw',       'https://manicapost.co.zw/feed/',       'ZW', 'general', TRUE, 3),
('southern-eye',         'Southern Eye',          'https://southerneye.co.zw',      'https://southerneye.co.zw/feed/',      'ZW', 'general', TRUE, 3)
ON CONFLICT (id) DO NOTHING;
