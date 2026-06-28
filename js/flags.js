/* ============================================================================
 * flags.js — Team -> emoji flag (Twemoji, CC-BY 4.0) lookup.
 *
 * Flag art is bundled as individual SVGs under /flags/<codepoint>.svg so it
 * renders identically on every device, independent of the OS emoji font. The
 * map keys are the app's team spellings (England & Scotland use the Unicode
 * subdivision-tag sequences). Twemoji by Twitter, licensed CC-BY 4.0:
 * https://github.com/twitter/twemoji
 * ========================================================================== */
(function (WC) {
  'use strict';

  // team name -> Twemoji codepoint filename (without extension)
  WC.FLAG = {
    "Sweden": '1f1f8-1f1ea',
    "Uzbekistan": '1f1fa-1f1ff',
    "Tunisia": '1f1f9-1f1f3',
    "Japan": '1f1ef-1f1f5',
    "Switzerland": '1f1e8-1f1ed',
    "England": '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f',
    "Türkiye": '1f1f9-1f1f7',
    "South Africa": '1f1ff-1f1e6',
    "Scotland": '1f3f4-e0067-e0062-e0073-e0063-e0074-e007f',
    "Australia": '1f1e6-1f1fa',
    "Croatia": '1f1ed-1f1f7',
    "Holland": '1f1f3-1f1f1',
    "Iraq": '1f1ee-1f1f6',
    "Saudi Arabia": '1f1f8-1f1e6',
    "Panama": '1f1f5-1f1e6',
    "Iran": '1f1ee-1f1f7',
    "Morocco": '1f1f2-1f1e6',
    "France": '1f1eb-1f1f7',
    "DR Congo": '1f1e8-1f1e9',
    "Qatar": '1f1f6-1f1e6',
    "Algeria": '1f1e9-1f1ff',
    "Canada": '1f1e8-1f1e6',
    "Mexico": '1f1f2-1f1fd',
    "Brazil": '1f1e7-1f1f7',
    "Haiti": '1f1ed-1f1f9',
    "Jordan": '1f1ef-1f1f4',
    "Paraguay": '1f1f5-1f1fe',
    "Ecuador": '1f1ea-1f1e8',
    "Colombia": '1f1e8-1f1f4',
    "Portugal": '1f1f5-1f1f9',
    "Bosnia": '1f1e7-1f1e6',
    "Ghana": '1f1ec-1f1ed',
    "Norway": '1f1f3-1f1f4',
    "Austria": '1f1e6-1f1f9',
    "Germany": '1f1e9-1f1ea',
    "Argentina": '1f1e6-1f1f7',
    "Czechia": '1f1e8-1f1ff',
    "Cape Verde": '1f1e8-1f1fb',
    "Egypt": '1f1ea-1f1ec',
    "South Korea": '1f1f0-1f1f7',
    "Uruguay": '1f1fa-1f1fe',
    "Spain": '1f1ea-1f1f8',
    "Curaçao": '1f1e8-1f1fc',
    "Ivory Coast": '1f1e8-1f1ee',
    "Senegal": '1f1f8-1f1f3',
    "USA": '1f1fa-1f1f8',
    "Belgium": '1f1e7-1f1ea',
    "New Zealand": '1f1f3-1f1ff'
  };

  // team name -> FIFA three-letter code (for compact bracket labels)
  WC.ABBR = {
    "Sweden": 'SWE', "Uzbekistan": 'UZB', "Tunisia": 'TUN', "Japan": 'JPN',
    "Switzerland": 'SUI', "England": 'ENG', "Türkiye": 'TUR', "South Africa": 'RSA',
    "Scotland": 'SCO', "Australia": 'AUS', "Croatia": 'CRO', "Holland": 'NED',
    "Iraq": 'IRQ', "Saudi Arabia": 'KSA', "Panama": 'PAN', "Iran": 'IRN',
    "Morocco": 'MAR', "France": 'FRA', "DR Congo": 'COD', "Qatar": 'QAT',
    "Algeria": 'ALG', "Canada": 'CAN', "Mexico": 'MEX', "Brazil": 'BRA',
    "Haiti": 'HAI', "Jordan": 'JOR', "Paraguay": 'PAR', "Ecuador": 'ECU',
    "Colombia": 'COL', "Portugal": 'POR', "Bosnia": 'BIH', "Ghana": 'GHA',
    "Norway": 'NOR', "Austria": 'AUT', "Germany": 'GER', "Argentina": 'ARG',
    "Czechia": 'CZE', "Cape Verde": 'CPV', "Egypt": 'EGY', "South Korea": 'KOR',
    "Uruguay": 'URU', "Spain": 'ESP', "Curaçao": 'CUW', "Ivory Coast": 'CIV',
    "Senegal": 'SEN', "USA": 'USA', "Belgium": 'BEL', "New Zealand": 'NZL'
  };

  // Three-letter code for a team; falls back to the first three letters upper-cased.
  WC.abbrOf = function (team) {
    if (!team) return '?';
    return WC.ABBR[team] || team.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  };

  // Path to a team's flag SVG, or null if unknown.
  WC.flagSrc = function (team) {
    var code = team && WC.FLAG[team];
    return code ? 'flags/' + code + '.svg' : null;
  };

  // <img> HTML for use inside innerHTML strings (empty string if no flag).
  WC.flagHTML = function (team) {
    var src = WC.flagSrc(team);
    return src ? '<img class="flag" src="' + src + '" alt="" />' : '';
  };

})(window.WC = window.WC || {});
