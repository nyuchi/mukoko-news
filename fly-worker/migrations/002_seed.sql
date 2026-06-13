-- Mukoko News — Seed Data
-- Countries, Interest Categories, Organizations, Feed Sources

-- ══════════════════════════════════════════════════
-- COUNTRIES
-- ══════════════════════════════════════════════════

INSERT INTO news.country (id, name, flag_emoji, color, region, in_language, timezone, enabled, priority) VALUES
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

-- ══════════════════════════════════════════════════
-- INTEREST CATEGORIES (replaces article_sections)
-- ══════════════════════════════════════════════════

INSERT INTO engagement.interest_category (slug, name, description, emoji, color_hex, classification_keywords, is_active, sort_order) VALUES
('politics',      'Politics',      'Political news and government affairs',      '🏛️', '#EF4444', '["politics", "government", "election", "vote", "parliament", "minister", "president", "policy", "law", "legislation", "democracy", "party", "campaign", "political", "governance", "reform"]', TRUE, 1),
('economy',       'Economy',       'Economic news, business, and finance',       '💰', '#10B981', '["economy", "business", "finance", "banking", "investment", "market", "economic", "financial", "money", "currency", "inflation", "gdp", "trade", "export", "import", "stock", "mining"]', TRUE, 2),
('technology',    'Technology',    'Technology, innovation, and digital news',    '💻', '#3B82F6', '["technology", "tech", "digital", "innovation", "startup", "internet", "mobile", "app", "software", "ai", "blockchain", "fintech", "ict"]', TRUE, 3),
('sports',        'Sports',        'Sports news and events',                     '⚽', '#F97316', '["sports", "football", "soccer", "cricket", "rugby", "tennis", "athletics", "olympics", "world cup", "premier league"]', TRUE, 4),
('health',        'Health',        'Health, medical, and wellness news',         '🏥', '#22C55E', '["health", "medical", "hospital", "doctor", "medicine", "healthcare", "pandemic", "vaccine", "disease", "treatment", "wellness"]', TRUE, 5),
('education',     'Education',     'Education news and academic affairs',        '📚', '#8B5CF6', '["education", "school", "university", "student", "teacher", "learning", "academic", "examination"]', TRUE, 6),
('entertainment', 'Entertainment', 'Entertainment, arts, and culture',           '🎬', '#EC4899', '["entertainment", "music", "movie", "film", "celebrity", "artist", "culture", "arts", "theatre", "concert", "festival"]', TRUE, 7),
('international', 'International', 'International and world news',               '🌍', '#06B6D4', '["international", "world", "global", "foreign", "africa", "sadc"]', TRUE, 8),
('general',       'General',       'General news and updates',                   '📰', '#84CC16', '["news", "zimbabwe", "africa", "breaking", "latest", "update"]', TRUE, 9),
('agriculture',   'Agriculture',   'Agricultural news and farming',              '🌾', '#F59E0B', '["agriculture", "farming", "crop", "livestock", "tobacco", "maize", "farmer", "harvest", "land", "rural"]', TRUE, 10),
('crime',         'Crime',         'Crime and law enforcement news',             '🚔', '#DC2626', '["crime", "police", "arrest", "court", "justice", "theft", "murder", "robbery", "investigation", "criminal"]', TRUE, 11),
('environment',   'Environment',   'Environmental news and conservation',        '🌿', '#16A34A', '["environment", "climate", "conservation", "pollution", "wildlife", "deforestation", "renewable", "sustainability"]', TRUE, 12)
ON CONFLICT (slug) DO NOTHING;

-- ══════════════════════════════════════════════════
-- NEWS MEDIA ORGANIZATIONS
-- ══════════════════════════════════════════════════

INSERT INTO news.news_media_organization (name, slug, url, source_type) VALUES
-- Zimbabwe
('Herald Zimbabwe',       'herald-zimbabwe',      'https://www.herald.co.zw',           'newspaper'),
('NewsDay Zimbabwe',      'newsday-zimbabwe',      'https://www.newsday.co.zw',          'newspaper'),
('Chronicle Zimbabwe',    'chronicle-zimbabwe',    'https://www.chronicle.co.zw',        'newspaper'),
('ZBC News',              'zbc-news',              'https://www.zbc.co.zw',              'broadcaster'),
('Business Weekly',       'business-weekly',       'https://businessweekly.co.zw',       'newspaper'),
('Techzim',               'techzim',               'https://www.techzim.co.zw',          'digital_native'),
('The Standard',          'the-standard',          'https://www.thestandard.co.zw',      'newspaper'),
('ZimLive',               'zimlive',               'https://www.zimlive.com',            'digital_native'),
('New Zimbabwe',          'new-zimbabwe',          'https://www.newzimbabwe.com',        'digital_native'),
('The Independent',       'the-independent',       'https://www.theindependent.co.zw',   'newspaper'),
('Sunday Mail',           'sunday-mail',           'https://www.sundaymail.co.zw',       'newspaper'),
('263Chat',               '263chat',               'https://263chat.com',                'digital_native'),
('Daily News',            'daily-news',            'https://www.dailynews.co.zw',        'newspaper'),
('ZimEye',                'zimeye',                'https://zimeye.net',                 'digital_native'),
('Pindula News',          'pindula-news',          'https://news.pindula.co.zw',         'digital_native'),
('Zimbabwe Situation',    'zimbabwe-situation',    'https://zimbabwesituation.com',      'digital_native'),
('Nehanda Radio',         'nehanda-radio',         'https://nehandaradio.com',           'digital_native'),
('Open News Zimbabwe',    'open-news-zimbabwe',    'https://opennews.co.zw',             'digital_native'),
('Financial Gazette',     'financial-gazette',     'https://fingaz.co.zw',               'newspaper'),
('Manica Post',           'manica-post',           'https://manicapost.co.zw',           'newspaper'),
('Southern Eye',          'southern-eye',          'https://southerneye.co.zw',          'newspaper')
ON CONFLICT (slug) DO NOTHING;

-- ══════════════════════════════════════════════════
-- FEED SOURCES (linked to organizations)
-- ══════════════════════════════════════════════════

INSERT INTO news.feed_source (organization_id, name, feed_url, feed_type, country, language, article_section_slug, priority) VALUES
-- Zimbabwe sources
((SELECT id FROM news.news_media_organization WHERE slug = 'herald-zimbabwe'),      'Herald Zimbabwe RSS',       'https://www.herald.co.zw/feed/',       'rss', 'ZW', 'en', 'general', 5),
((SELECT id FROM news.news_media_organization WHERE slug = 'newsday-zimbabwe'),     'NewsDay Zimbabwe RSS',      'https://www.newsday.co.zw/feed/',      'rss', 'ZW', 'en', 'general', 5),
((SELECT id FROM news.news_media_organization WHERE slug = 'chronicle-zimbabwe'),   'Chronicle Zimbabwe RSS',    'https://www.chronicle.co.zw/feed/',    'rss', 'ZW', 'en', 'general', 5),
((SELECT id FROM news.news_media_organization WHERE slug = 'zbc-news'),             'ZBC News RSS',              'https://www.zbc.co.zw/feed/',          'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'business-weekly'),      'Business Weekly RSS',       'https://businessweekly.co.zw/feed/',   'rss', 'ZW', 'en', 'economy', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'techzim'),              'Techzim RSS',               'https://www.techzim.co.zw/feed/',      'rss', 'ZW', 'en', 'technology', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'the-standard'),         'The Standard RSS',          'https://www.thestandard.co.zw/feed/',  'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'zimlive'),              'ZimLive RSS',               'https://www.zimlive.com/feed/',         'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'new-zimbabwe'),         'New Zimbabwe RSS',          'https://www.newzimbabwe.com/feed/',     'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'the-independent'),      'The Independent RSS',       'https://www.theindependent.co.zw/feed/', 'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'sunday-mail'),          'Sunday Mail RSS',           'https://www.sundaymail.co.zw/feed/',   'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = '263chat'),              '263Chat RSS',               'https://263chat.com/feed/',             'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'daily-news'),           'Daily News RSS',            'https://www.dailynews.co.zw/feed/',    'rss', 'ZW', 'en', 'general', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'zimeye'),               'ZimEye RSS',                'https://zimeye.net/feed/',              'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = 'pindula-news'),         'Pindula News RSS',          'https://news.pindula.co.zw/feed/',     'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = 'zimbabwe-situation'),   'Zimbabwe Situation RSS',    'https://zimbabwesituation.com/feed/',   'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = 'nehanda-radio'),        'Nehanda Radio RSS',         'https://nehandaradio.com/feed/',        'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = 'open-news-zimbabwe'),   'Open News Zimbabwe RSS',    'https://opennews.co.zw/feed/',          'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = 'financial-gazette'),    'Financial Gazette RSS',     'https://fingaz.co.zw/feed/',            'rss', 'ZW', 'en', 'economy', 4),
((SELECT id FROM news.news_media_organization WHERE slug = 'manica-post'),          'Manica Post RSS',           'https://manicapost.co.zw/feed/',        'rss', 'ZW', 'en', 'general', 3),
((SELECT id FROM news.news_media_organization WHERE slug = 'southern-eye'),         'Southern Eye RSS',          'https://southerneye.co.zw/feed/',       'rss', 'ZW', 'en', 'general', 3)
ON CONFLICT (feed_url) DO NOTHING;
