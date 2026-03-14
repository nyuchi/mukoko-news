-- Mukoko News Seed Data v2
-- Schema.org aligned tables

-- ================================================
-- COUNTRIES
-- ================================================

INSERT OR IGNORE INTO countries (id, name, flag_emoji, color, region, in_language, timezone, enabled, priority) VALUES
('ZW', 'Zimbabwe',     '🇿🇼', 'bg-green-600',  'southern', 'en', 'Africa/Harare',        1, 10),
('ZA', 'South Africa', '🇿🇦', 'bg-yellow-500', 'southern', 'en', 'Africa/Johannesburg',  1, 9),
('KE', 'Kenya',        '🇰🇪', 'bg-red-600',    'eastern',  'en', 'Africa/Nairobi',       1, 8),
('NG', 'Nigeria',      '🇳🇬', 'bg-green-500',  'western',  'en', 'Africa/Lagos',         1, 7),
('GH', 'Ghana',        '🇬🇭', 'bg-yellow-400', 'western',  'en', 'Africa/Accra',         1, 6),
('TZ', 'Tanzania',     '🇹🇿', 'bg-blue-500',   'eastern',  'sw', 'Africa/Dar_es_Salaam', 1, 5),
('UG', 'Uganda',       '🇺🇬', 'bg-yellow-600', 'eastern',  'en', 'Africa/Kampala',       1, 5),
('RW', 'Rwanda',       '🇷🇼', 'bg-cyan-500',   'eastern',  'en', 'Africa/Kigali',        1, 4),
('ET', 'Ethiopia',     '🇪🇹', 'bg-green-400',  'eastern',  'am', 'Africa/Addis_Ababa',   1, 4),
('BW', 'Botswana',     '🇧🇼', 'bg-sky-400',    'southern', 'en', 'Africa/Gaborone',      1, 4),
('ZM', 'Zambia',       '🇿🇲', 'bg-orange-500', 'southern', 'en', 'Africa/Lusaka',        1, 4),
('MW', 'Malawi',       '🇲🇼', 'bg-red-500',    'southern', 'en', 'Africa/Blantyre',      1, 3),
('EG', 'Egypt',        '🇪🇬', 'bg-red-700',    'northern', 'ar', 'Africa/Cairo',         1, 3),
('MA', 'Morocco',      '🇲🇦', 'bg-red-600',    'northern', 'ar', 'Africa/Casablanca',    1, 3),
('NA', 'Namibia',      '🇳🇦', 'bg-blue-600',   'southern', 'en', 'Africa/Windhoek',      1, 3),
('MZ', 'Mozambique',   '🇲🇿', 'bg-yellow-500', 'southern', 'pt', 'Africa/Maputo',        1, 3);

-- ================================================
-- ARTICLE SECTIONS
-- ================================================

INSERT OR IGNORE INTO article_sections (id, name, description, emoji, color, classification_keywords, enabled, sort_order) VALUES
('politics',      'Politics',      'Political news and government affairs',      '🏛️', 'bg-red-500',     '["politics", "government", "election", "vote", "parliament", "minister", "president", "policy", "law", "legislation", "democracy", "party", "campaign", "political", "governance", "reform"]', 1, 1),
('economy',       'Economy',       'Economic news, business, and finance',       '💰', 'bg-emerald-500', '["economy", "business", "finance", "banking", "investment", "market", "economic", "financial", "money", "currency", "inflation", "gdp", "trade", "export", "import", "stock", "mining"]', 1, 2),
('technology',    'Technology',    'Technology, innovation, and digital news',    '💻', 'bg-blue-500',    '["technology", "tech", "digital", "innovation", "startup", "internet", "mobile", "app", "software", "ai", "blockchain", "fintech", "ict"]', 1, 3),
('sports',        'Sports',        'Sports news and events',                     '⚽', 'bg-orange-500',  '["sports", "football", "soccer", "cricket", "rugby", "tennis", "athletics", "olympics", "world cup", "premier league"]', 1, 4),
('health',        'Health',        'Health, medical, and wellness news',         '🏥', 'bg-green-500',   '["health", "medical", "hospital", "doctor", "medicine", "healthcare", "pandemic", "vaccine", "disease", "treatment", "wellness"]', 1, 5),
('education',     'Education',     'Education news and academic affairs',        '📚', 'bg-violet-500',  '["education", "school", "university", "student", "teacher", "learning", "academic", "examination"]', 1, 6),
('entertainment', 'Entertainment', 'Entertainment, arts, and culture',           '🎬', 'bg-pink-500',    '["entertainment", "music", "movie", "film", "celebrity", "artist", "culture", "arts", "theatre", "concert", "festival"]', 1, 7),
('international', 'International', 'International and world news',               '🌍', 'bg-cyan-500',    '["international", "world", "global", "foreign", "africa", "sadc"]', 1, 8),
('general',       'General',       'General news and updates',                   '📰', 'bg-lime-500',    '["news", "zimbabwe", "africa", "breaking", "latest", "update"]', 1, 9),
('agriculture',   'Agriculture',   'Agricultural news and farming',              '🌾', 'bg-amber-500',   '["agriculture", "farming", "crop", "livestock", "tobacco", "maize", "farmer", "harvest", "land", "rural"]', 1, 10),
('crime',         'Crime',         'Crime and law enforcement news',             '🚔', 'bg-red-600',     '["crime", "police", "arrest", "court", "justice", "theft", "murder", "robbery", "investigation", "criminal"]', 1, 11),
('environment',   'Environment',   'Environmental news and conservation',        '🌿', 'bg-green-600',   '["environment", "climate", "conservation", "pollution", "wildlife", "deforestation", "renewable", "sustainability"]', 1, 12);

-- ================================================
-- ORGANIZATIONS (RSS news sources)
-- ================================================

INSERT OR IGNORE INTO organizations (id, name, url, rss_feed_url, area_served, article_section_id, enabled, priority) VALUES
('herald-zimbabwe',      'Herald Zimbabwe',       'https://www.herald.co.zw',       'https://www.herald.co.zw/feed/',       'ZW', 'general', 1, 5),
('newsday-zimbabwe',     'NewsDay Zimbabwe',      'https://www.newsday.co.zw',      'https://www.newsday.co.zw/feed/',      'ZW', 'general', 1, 5),
('chronicle-zimbabwe',   'Chronicle Zimbabwe',    'https://www.chronicle.co.zw',    'https://www.chronicle.co.zw/feed/',    'ZW', 'general', 1, 5),
('zbc-news',             'ZBC News',              'https://www.zbc.co.zw',          'https://www.zbc.co.zw/feed/',          'ZW', 'general', 1, 4),
('business-weekly',      'Business Weekly',       'https://businessweekly.co.zw',   'https://businessweekly.co.zw/feed/',   'ZW', 'economy', 1, 4),
('techzim',              'Techzim',               'https://www.techzim.co.zw',      'https://www.techzim.co.zw/feed/',      'ZW', 'technology', 1, 4),
('the-standard',         'The Standard',          'https://www.thestandard.co.zw',  'https://www.thestandard.co.zw/feed/',  'ZW', 'general', 1, 4),
('zimlive',              'ZimLive',               'https://www.zimlive.com',        'https://www.zimlive.com/feed/',        'ZW', 'general', 1, 4),
('new-zimbabwe',         'New Zimbabwe',          'https://www.newzimbabwe.com',    'https://www.newzimbabwe.com/feed/',     'ZW', 'general', 1, 4),
('the-independent',      'The Independent',       'https://www.theindependent.co.zw', 'https://www.theindependent.co.zw/feed/', 'ZW', 'general', 1, 4),
('sunday-mail',          'Sunday Mail',           'https://www.sundaymail.co.zw',   'https://www.sundaymail.co.zw/feed/',   'ZW', 'general', 1, 3),
('263chat',              '263Chat',               'https://263chat.com',            'https://263chat.com/feed/',             'ZW', 'general', 1, 4),
('daily-news',           'Daily News',            'https://www.dailynews.co.zw',    'https://www.dailynews.co.zw/feed/',    'ZW', 'general', 1, 4),
('zimeye',               'ZimEye',                'https://zimeye.net',             'https://zimeye.net/feed/',              'ZW', 'general', 1, 3),
('pindula-news',         'Pindula News',          'https://news.pindula.co.zw',     'https://news.pindula.co.zw/feed/',     'ZW', 'general', 1, 3),
('zimbabwe-situation',   'Zimbabwe Situation',    'https://zimbabwesituation.com',  'https://zimbabwesituation.com/feed/',  'ZW', 'general', 1, 3),
('nehanda-radio',        'Nehanda Radio',         'https://nehandaradio.com',       'https://nehandaradio.com/feed/',       'ZW', 'general', 1, 3),
('open-news-zimbabwe',   'Open News Zimbabwe',    'https://opennews.co.zw',         'https://opennews.co.zw/feed/',         'ZW', 'general', 1, 3),
('financial-gazette',    'Financial Gazette',     'https://fingaz.co.zw',           'https://fingaz.co.zw/feed/',           'ZW', 'economy', 1, 4),
('manica-post',          'Manica Post',           'https://manicapost.co.zw',       'https://manicapost.co.zw/feed/',       'ZW', 'general', 1, 3),
('southern-eye',         'Southern Eye',          'https://southerneye.co.zw',      'https://southerneye.co.zw/feed/',      'ZW', 'general', 1, 3);

-- ================================================
-- TRUSTED IMAGE DOMAINS
-- ================================================

INSERT OR IGNORE INTO trusted_domains (domain, type, enabled) VALUES
-- Zimbabwe news sites
('herald.co.zw', 'image', 1),
('newsday.co.zw', 'image', 1),
('chronicle.co.zw', 'image', 1),
('techzim.co.zw', 'image', 1),
('zbc.co.zw', 'image', 1),
('businessweekly.co.zw', 'image', 1),
('thestandard.co.zw', 'image', 1),
('zimlive.com', 'image', 1),
('newzimbabwe.com', 'image', 1),
('theindependent.co.zw', 'image', 1),
('sundaymail.co.zw', 'image', 1),
('263chat.com', 'image', 1),
('dailynews.co.zw', 'image', 1),
('zimeye.net', 'image', 1),
('pindula.co.zw', 'image', 1),
('zimbabwesituation.com', 'image', 1),
('nehandaradio.com', 'image', 1),
('opennews.co.zw', 'image', 1),
('fingaz.co.zw', 'image', 1),
('manicapost.co.zw', 'image', 1),
('southerneye.co.zw', 'image', 1),
-- CDN and image hosting
('wp.com', 'image', 1),
('wordpress.com', 'image', 1),
('files.wordpress.com', 'image', 1),
('i0.wp.com', 'image', 1),
('i1.wp.com', 'image', 1),
('i2.wp.com', 'image', 1),
('i3.wp.com', 'image', 1),
('cloudinary.com', 'image', 1),
('res.cloudinary.com', 'image', 1),
('cloudfront.net', 'image', 1),
('amazonaws.com', 'image', 1),
('s3.amazonaws.com', 'image', 1),
-- Google
('googleusercontent.com', 'image', 1),
('lh3.googleusercontent.com', 'image', 1),
-- Social
('fbcdn.net', 'image', 1),
('pbs.twimg.com', 'image', 1),
-- Wire services
('ap.org', 'image', 1),
('apnews.com', 'image', 1),
('reuters.com', 'image', 1),
('bbci.co.uk', 'image', 1),
-- South African news
('mg.co.za', 'image', 1),
('news24.com', 'image', 1),
('timeslive.co.za', 'image', 1),
-- Other
('wikimedia.org', 'image', 1),
('upload.wikimedia.org', 'image', 1);

-- ================================================
-- SYSTEM CONFIG
-- ================================================

INSERT OR IGNORE INTO system_config (key, value, description) VALUES
('site_name', '"Mukoko News"', 'Site name'),
('max_articles_per_source', '500', 'Maximum articles per source'),
('refresh_interval_minutes', '15', 'RSS refresh interval'),
('pagination_initial_load', '24', 'Articles on initial load'),
('pagination_page_size', '12', 'Articles per page');
