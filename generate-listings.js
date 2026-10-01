/**
 * generate-listings.js — builds the localProducts catalog block in index.html
 * from the META table below (one row per unique sneaker photo).
 *
 * Usage:   node generate-listings.js
 * Idempotent: replaces the block between the local-products markers.
 * Photos are referenced from sneaker_images/square/ (padded to 1:1 so the
 * card grid's object-fit:cover never crops the shoe).
 */
'use strict';
console.error('generate-listings.js is obsolete — the catalog is now built by generate_products.py + swap_block.py.');
process.exit(1);
const fs = require('fs');
const path = require('path');

const root = __dirname;
const htmlPath = path.join(root, 'index.html');
const IMG = f => `sneaker_images/square/${f}`;

// Size sets (mirrors the site's US size filter where applicable)
const SIZES = {
  A:  ['8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
  B:  ['8', '9', '9.5', '10', '11', '12'],
  C:  ['9', '9.5', '10', '10.5', '11', '12'],
  W:  ['6', '7', '8', '9', '10', '11'],        // women's
  GS: ['4Y', '5Y', '6Y', '7Y', '8Y'],          // grade school
  PS: ['10.5C', '11C', '12C', '13C', '1Y'],    // pre-school
  TD: ['4C', '5C', '6C', '7C', '8C'],          // toddler / infant
  K:  ['10C', '11C', '12C', '13C', '1Y'],      // kids
};

/*
 * META — one row per unique photo, keyed by filename:
 *   [brand, name, color, price, retail, year, sizeKey, condition, sku]
 * condition 'Pre-owned' automatically ships with box 'Replacement Box'.
 * Prices/years are representative resale-style values in the same spirit as
 * the original 10 listings.
 */
const META = {

  // ---- adidas (Forum / collabs) ----
  'Sheet2_Adidas_Forum_84_Bape_Low_Green_Camo_ID4771.jpg':
    ['adidas', 'Forum 84 Low', 'BAPE Green Camo', 245, 140, 2021, 'A', 'New', 'ID4771'],
  'Sheet2_Adidas_Forum_Buckle_Low_Bad_Bunny_Last_Forum_HQ2153.jpg':
    ['adidas', 'Forum Buckle Low', 'Bad Bunny Last Forum', 285, 200, 2022, 'A', 'New', 'HQ2153'],
  'Sheet2_Adidas_Forum_Powerphase_Bad_Bunny_Benito_GZ2009.jpg':
    ['adidas', 'Powerphase', 'Bad Bunny Benito', 235, 130, 2021, 'A', 'New', 'GZ2009'],

  // ---- Jordan / Air Jordan ----
  'Sheet2_Air_Jordan_1_Mid_SE_Red_Black_Toe_852542_100.jpg':
    ['Jordan', 'Air Jordan 1 Mid SE', 'Red Black Toe', 175, 135, 2023, 'A', 'New', '852542-100'],
  'Sheet2_Air_Jordan_1_Retro_High_OG_555088_404.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Dark Marina Blue', 285, 180, 2022, 'A', 'New', '555088-404'],
  'Sheet2_Air_Jordan_6_Retro_Travis_Scott_British_Khaki_DH0690_200.jpg':
    ['TRAVIS SCOTT', 'Air Jordan 6 Retro', 'British Khaki', 690, 200, 2021, 'A', 'New', 'DH0690-200'],
  'Sheet2_Hyper_Royal_Light_Smoke_Grey_White_575441_402.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Hyper Royal', 265, 140, 2021, 'GS', 'New', '575441-402'],
  'Sheet2_Jordan_11_Retro_Jubilee_25th_Anniversary_CT8012_011.jpg':
    ['Jordan', 'Air Jordan 11 Retro', 'Jubilee 25th Anniversary', 425, 225, 2020, 'A', 'New', 'CT8012-011'],
  'Sheet2_Jordan_14_Low_CLOT_Terra_Blush_DC9857_200.jpg':
    ['Jordan', 'Air Jordan 14 Low', 'CLOT Terra Blush', 345, 170, 2023, 'A', 'New', 'DC9857-200'],
  'Sheet2_Jordan_1_Lucky_Green_White_Sail_Black_DB4612_300.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Lucky Green', 335, 180, 2023, 'A', 'New', 'DB4612-300'],
  'Sheet2_Jordan_1_Mid_Black_Medium_Grey_White_554725_073.jpg':
    ['Jordan', 'Air Jordan 1 Mid', 'Black Medium Grey White', 145, 135, 2021, 'A', 'New', '554725-073'],
  'Sheet2_Jordan_1_Mid_Black_Red_White_554724_066.jpg':
    ['Jordan', 'Air Jordan 1 Mid', 'Black Red White', 155, 135, 2021, 'A', 'New', '554724-066'],
  'Sheet2_Jordan_1_Retro_High_Light_Smoke_Grey_555088_126.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Light Smoke Grey', 445, 180, 2023, 'A', 'New', '555088-126'],
  'Sheet2_Jordan_1_Retro_High_OG_Patent_Bred_555088_063.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Patent Bred', 395, 180, 2022, 'A', 'New', '555088-063'],
  'Sheet2_Jordan_1_Spider_Man_DV1748_601.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Spider-Man Next Chapter', 495, 180, 2023, 'A', 'New', 'DV1748-601'],
  'Sheet2_Jordan_4_Craft_Photon_Dust_Patch_Works_DV3742_021.jpg':
    ['Jordan', 'Air Jordan 4 Retro', 'Craft Photon Dust', 385, 210, 2023, 'A', 'New', 'DV3742-021'],
  'Sheet2_Jordan_4_Retro_GS_White_Cement_DJ4699_100.jpg':
    ['Jordan', 'Air Jordan 4 Retro', 'White Oreo', 345, 160, 2021, 'GS', 'New', 'DJ4699-100'],
  'Sheet2_Jordan_4_Tour_Yellow_CT8527_700.jpg':
    ['Jordan', 'Air Jordan 4 Retro', 'Tour Yellow', 325, 215, 2026, 'A', 'New', 'CT8527-700'],
  'Sheet2_Jordan_4_University_Blue_CT8527_400.jpg':
    ['Jordan', 'Air Jordan 4 Retro', 'University Blue', 445, 215, 2025, 'A', 'New', 'CT8527-400'],
  'Sheet2_Jordan_4_White_Black_Grey_Army_DH6927_111.jpg':
    ['Jordan', 'Air Jordan 4 Retro', 'Military Black', 355, 210, 2022, 'A', 'New', 'DH6927-111'],
  'Sheet2_Jordan_4_White_Cement_CT8527_100.jpg':
    ['Jordan', 'Air Jordan 4 Retro', 'White Oreo', 395, 215, 2021, 'A', 'New', 'CT8527-100'],
  'Sheet2_Jordan_5_Bel_Air_White_Court_Purple_Racer_Pink_Ghost_Green_DB3335_100.jpg':
    ['Jordan', 'Air Jordan 5 Retro', 'Bel Air', 495, 210, 2023, 'A', 'New', 'DB3335-100'],
  'Sheet2_Jordan_5_RetroRaging_Bull_Red_2021_GS_440888_600.jpg':
    ['Jordan', 'Air Jordan 5 Retro', 'Raging Bull Red', 295, 160, 2021, 'GS', 'New', '440888-600'],
  'Sheet2_Jordan_5_Retro_A_Ma_Mani_re_Dusk_FD1330_001.jpg':
    ['Jordan', 'Air Jordan 5 Retro', 'A Ma Maniére Dusk', 485, 225, 2023, 'A', 'New', 'FD1330-001'],
  'Sheet2_Jordan_5_Retro_PS_Travis_Scott_British_Khaki_DH0693_200.jpg':
    ['TRAVIS SCOTT', 'Air Jordan 5 Retro PS', 'British Khaki', 345, 125, 2021, 'PS', 'New', 'DH0693-200'],
  'Sheet2_Jordan_5_Sail_Off_White_CV4827_100.jpg':
    ['Jordan', 'Air Jordan 5 Retro', 'Sail / Off-White', 385, 220, 2020, 'A', 'New', 'CV4827-100'],
  'Sheet2_Jordan_6_Carmine_CT8529_106.jpg':
    ['Jordan', 'Air Jordan 6 Retro', 'Carmine', 295, 200, 2021, 'A', 'New', 'CT8529-106'],
  'Sheet2_Jordan_6_UNC_University_Blue_White_CT8529_410.jpg':
    ['Jordan', 'Air Jordan 6 Retro', 'UNC University Blue', 375, 200, 2022, 'A', 'New', 'CT8529-410'],

  // ---- Nike ----
  'Sheet2_Air_Max_90_CW6018_001.jpg':
    ['Nike', 'Air Max 90', 'Galaxy', 385, 140, 2020, 'A', 'New', 'CW6018-001'],
  'Sheet2_Air_Max_90_St_Patrick_s_Day_2021_DD8555_300.jpg':
    ['Nike', 'Air Max 90', 'St. Patrick\u2019s Day', 345, 140, 2021, 'A', 'New', 'DD8555-300'],
  'Sheet2_Air_Max_97_Undefeated_Black_Volt_Militia_Green_DC4830_001.jpg':
    ['Nike', 'Air Max 97', 'Undefeated Black Volt', 465, 180, 2022, 'A', 'New', 'DC4830-001'],
  'Sheet2_Air_Max_97_Undefeated_Militia_Green_Orange_Blaze_White_Black_DC4830_300.jpg':
    ['Nike', 'Air Max 97', 'Undefeated Militia Green', 485, 180, 2022, 'A', 'New', 'DC4830-300'],
  'Sheet2_Nike_Air_Max_1_Clot_DD1870_100.jpg':
    ['Nike', 'Air Max 1', 'CLOT Kiss of Death', 385, 160, 2021, 'A', 'New', 'DD1870-100'],
  'Sheet2_Nike_Air_Trainer_3_Viotech_CZ6393_500.jpg':
    ['Nike', 'Air Trainer 3', 'Viotech', 275, 140, 2021, 'A', 'New', 'CZ6393-500'],
  'Sheet2_Nike_Blazer_Low_Sacai_DD1877_002.jpg':
    ['Nike', 'Blazer Low', 'sacai Iron Grey', 145, 120, 2021, 'A', 'New', 'DD1877-002'],
  'Sheet2_Nike_Dunk_High_PS_Black_Yellow_DC9053_002.jpg':
    ['Nike', 'Dunk High PS', 'Black Yellow', 125, 90, 2022, 'PS', 'New', 'DC9053-002'],
  'Sheet2_Nike_Dunk_Low_University_Blue_DD1391_102.jpg':
    ['Nike', 'Dunk Low', 'University Blue', 215, 115, 2021, 'A', 'New', 'DD1391-102'],
  'Sheet2_Nike_Lebron_VII_Media_Day_CW2300_500.jpg':
    ['Nike', 'LeBron 7', 'Media Day', 265, 200, 2020, 'A', 'New', 'CW2300-500'],

  // ---- Jordan WMNS ----
  'Sheet2_WMNS_Air_Jordan_1_Low_DC0774_114.jpg':
    ['Jordan', 'Air Jordan 1 Low', 'Marina Blue', 175, 110, 2021, 'W', 'New', 'DC0774-114'],
  'Sheet2_WMNS_Jordan_1_High_OG_Black_Metalic_CD0461_001.jpg':
    ['Jordan', 'Air Jordan 1 Retro High OG', 'Black Metallic', 285, 180, 2021, 'W', 'New', 'CD0461-001'],
  'Sheet2_WMNS_Jordan_3_Retro_SP_A_Ma_Maniere_DH3434_110.jpg':
    ['Jordan', 'Air Jordan 3 Retro SP', 'A Ma Maniére', 495, 200, 2023, 'W', 'New', 'DH3434-110'],

  // ---- adidas Yeezy (NOTE: 350_Bone upgrades existing listing id 5;
  //      350_Asriel is byte-identical to 350_Carbon — both excluded here)
  'Yeezys_350_Beluga_Reflective_GW1229.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Beluga Reflective', 315, 230, 2021, 'A', 'New', 'GW1229'],
  'Yeezys_350_Carbon_Beluga_HQ7045.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Carbon Beluga', 275, 230, 2021, 'A', 'New', 'HQ7045'],
  'Yeezys_350_Carbon_FZ5000.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Carbon', 255, 230, 2024, 'A', 'New', 'FZ5000'],
  'Yeezys_350_Dazzling_Blue_GY7164.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Dazzling Blue', 345, 230, 2022, 'A', 'New', 'GY7164'],
  'Yeezys_350_Infant_Black_BB6372.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Black Infant', 145, 160, 2016, 'TD', 'Pre-owned', 'BB6372'],
  'Yeezys_350_Israfil_FZ5421.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Israfil', 245, 230, 2024, 'A', 'New', 'FZ5421'],
  'Yeezys_350_Light_GY3438.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Light', 265, 230, 2022, 'A', 'New', 'GY3438'],
  'Yeezys_350_Mono_Ice_GW2869.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Mono Ice', 335, 220, 2021, 'A', 'New', 'GW2869'],
  'Yeezys_350_Natural_FZ5246.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Natural', 245, 230, 2024, 'A', 'New', 'FZ5246'],
  'Yeezys_350_Onyx_HQ4540.jpg':
    ['adidas', 'Yeezy Boost 350 V2', 'Onyx', 245, 230, 2022, 'A', 'New', 'HQ4540'],
  'Yeezys_360_Cinder_FY2903.jpg':
    ['adidas', 'Yeezy Boost 360 V2', 'Cinder', 175, 230, 2020, 'A', 'Pre-owned', 'FY2903'],
  'Yeezys_360_Zyon_FZ1267.jpg':
    ['adidas', 'Yeezy Boost 360 V2', 'Zyon', 205, 230, 2024, 'A', 'New', 'FZ1267'],
  'Yeezys_450_Cloud_White_H68038.jpg':
    ['adidas', 'Yeezy 450', 'Cloud White', 335, 260, 2021, 'A', 'New', 'H68038'],
  'Yeezys_450_Dark_Slate_GY5368.jpg':
    ['adidas', 'Yeezy 450', 'Dark Slate', 285, 260, 2022, 'A', 'New', 'GY5368'],
  'Yeezys_500_High_Slate_FW4968.jpg':
    ['adidas', 'Yeezy 500 High', 'Slate', 345, 220, 2019, 'A', 'New', 'FW4968'],
  'Yeezys_700_Alvah_H67799.jpg':
    ['adidas', 'Yeezy Boost 700 V3', 'Alvah', 385, 300, 2020, 'A', 'New', 'H67799'],
  'Yeezys_700_Arzareth_G54850.jpg':
    ['adidas', 'Yeezy Boost 700', 'Arzareth', 345, 300, 2020, 'A', 'New', 'G54850'],
  'Yeezys_700_Clay_Brown_GY0189.jpg':
    ['adidas', 'Yeezy Boost 700', 'Clay Brown', 325, 300, 2022, 'A', 'New', 'GY0189'],
  'Yeezys_700_Dark_Glow_GX6144.jpg':
    ['adidas', 'Yeezy Boost 700', 'Dark Glow', 335, 300, 2021, 'A', 'New', 'GX6144'],
  'Yeezys_700_MNVN_Bone_FY3729.jpg':
    ['adidas', 'Yeezy Boost 700 MNVN', 'Bone', 275, 260, 2020, 'A', 'New', 'FY3729'],
  'Yeezys_700_Tephra_FU7914.jpg':
    ['adidas', 'Yeezy Boost 700', 'Tephra', 345, 300, 2021, 'A', 'New', 'FU7914'],
  'Yeezys_700_Wave_Runner_B75571.jpg':
    ['adidas', 'Yeezy Boost 700', 'Wave Runner', 545, 300, 2017, 'A', 'New', 'B75571'],
  'Yeezys_Desert_Boot_Taupe_Blue_GY0374.jpg':
    ['adidas', 'Yeezy Desert Boot', 'Taupe Blue', 425, 340, 2021, 'A', 'New', 'GY0374'],
  'Yeezys_Foam_Kids_MX_Sand_Grey_GY3970.jpg':
    ['adidas', 'Yeezy Foam Runner', 'MX Sand Grey Kids', 125, 60, 2022, 'K', 'New', 'GY3970'],
  'Yeezys_Foam_MTX_Moon_Grey_GV7904.jpg':
    ['adidas', 'Yeezy Foam Runner', 'Moon Grey', 145, 90, 2021, 'A', 'New', 'GV7904'],
  'Yeezys_Foam_MX_Cinder_ID4126.jpg':
    ['adidas', 'Yeezy Foam Runner', 'MX Cinder', 85, 90, 2021, 'A', 'Pre-owned', 'ID4126'],
  'Yeezys_Foam_Onyx_HP8739.jpg':
    ['adidas', 'Yeezy Foam Runner', 'Onyx', 135, 90, 2021, 'A', 'New', 'HP8739'],
  'Yeezys_Slide_Ochre_GW1931.jpg':
    ['adidas', 'Yeezy Slide', 'Ochre', 105, 70, 2021, 'A', 'New', 'GW1931'],
  'Yeezys_Slide_Onyx_HQ6448.jpg':
    ['adidas', 'Yeezy Slide', 'Onyx', 95, 70, 2022, 'A', 'New', 'HQ6448'],
  'Yeezys_Slide_Pure_GW1934.jpg':
    ['adidas', 'Yeezy Slide', 'Pure', 65, 70, 2021, 'A', 'Pre-owned', 'GW1934'],
};

// Photos deliberately excluded from the catalog:
//  - 350_Bone   → upgrades the EXISTING listing id 5 in index.html (real photo)
//  - 350_Asriel → byte-identical duplicate of 350_Carbon (same SKU FZ5000)
const EXCLUDE = new Set([
  'Yeezys_350_Bone_HQ6316.jpg',
  'Yeezys_350_Asriel_FZ5000.jpg',
]);

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const q = s => `'${esc(s)}'`;

function buildProducts(startId) {
  const photosDir = path.join(root, 'sneaker_images');
  const files = fs.readdirSync(photosDir)
    .filter(f => /\.jpe?g$/i.test(f) && !EXCLUDE.has(f))
    .sort();

  const missing = files.filter(f => !META[f]);
  const stale = Object.keys(META).filter(f => !files.includes(f));
  if (missing.length) { console.warn('WARN — no META for:'); missing.forEach(f => console.warn('  ' + f)); }
  if (stale.length)  { console.warn('WARN — META without photo:'); stale.forEach(f => console.warn('  ' + f)); }

  let id = startId;
  return files.filter(f => META[f]).map(file => {
    const [brand, name, color, price, retail, year, sizeKey, condition, sku] = META[file];
    const sizes = SIZES[sizeKey];
    const box = condition === 'Pre-owned' ? 'Replacement Box' : 'Original Box';
    const img = IMG(file);
    return [
      '        {',
      `          id: ${id++},`,
      `          brand: ${q(brand)},`,
      `          name: ${q(name)},`,
      `          color: ${q(color)},`,
      `          price: ${price},`,
      `          retail: ${retail},`,
      `          condition: ${q(condition)},`,
      `          box: ${q(box)},`,
      `          sizes: [${sizes.map(q).join(', ')}],`,
      `          year: ${year},`,
      `          img: ${q(img)},`,
      `          gallery: [${q(img)}],`,
      `          sku: ${q(sku)}`,
      '        }',
    ].join('\n');
  });
}

const BEGIN = '    /* == local-products:begin (generated by generate-listings.js — do not edit by hand) == */';
const END   = '    /* == local-products:end == */';

// Hand-written listings live above the generated block; local ids continue after
// the highest hand-written id so the catalog stays dense (1..N) and regenerable.
function nextHandId(html) {
  const cut = html.indexOf(BEGIN);
  const head = cut >= 0 ? html.slice(0, cut) : html;
  let max = 0;
  const re = /^\s*id:\s*(\d+)\s*,\s*$/gm;
  let m;
  while ((m = re.exec(head))) max = Math.max(max, Number(m[1]));
  return max + 1;
}

function main() {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const startId = nextHandId(html);
  const rows = buildProducts(startId);
  const block = [
    BEGIN,
    '    const localProducts = [',
    rows.join(',\n'),
    '    ];',
    '    products.push(...localProducts);',
    END,
  ].join('\n');

  const re = new RegExp(
    BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  if (re.test(html)) {
    html = html.replace(re, block);
  } else {
    const anchor = '    products.push(...moreProducts);';
    if (!html.includes(anchor)) throw new Error('anchor not found in index.html');
    html = html.replace(anchor, anchor + '\n\n' + block);
  }

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('OK — ' + rows.length + ' local products written (ids ' + startId + '..' + (startId + rows.length - 1) + ')');
}

main();

