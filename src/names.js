// English-readable place names, so the guide says names the walker can match to signs:
// chains get their English brand, everything else is romanized (Revised Romanization,
// letter by letter, without the sound-change rules).

const BRANDS = {
  '세븐일레븐': '7-Eleven', '이마트24': 'emart24', '미니스톱': 'Ministop', '스타벅스': 'Starbucks',
  '이디야커피': 'Ediya Coffee', '이디야': 'Ediya Coffee', '메가MGC커피': 'Mega Coffee', '메가커피': 'Mega Coffee',
  '컴포즈커피': 'Compose Coffee', '빽다방': "Paik's Coffee", '투썸플레이스': 'A Twosome Place', '할리스': 'Hollys Coffee',
  '폴바셋': 'Paul Bassett', '커피빈': 'Coffee Bean', '파리바게뜨': 'Paris Baguette', '뚜레쥬르': 'Tous les Jours',
  '올리브영': 'Olive Young', '다이소': 'Daiso', '맥도날드': "McDonald's", '롯데리아': 'Lotteria', '버거킹': 'Burger King',
  'KFC': 'KFC', '맘스터치': "Mom's Touch", '서브웨이': 'Subway', '배스킨라빈스': 'Baskin Robbins', '던킨': "Dunkin'",
  '하나은행': 'Hana Bank', '신한은행': 'Shinhan Bank', 'KB국민은행': 'KB Kookmin Bank', '국민은행': 'KB Kookmin Bank',
  '우리은행': 'Woori Bank', 'IBK기업은행': 'IBK Bank', 'NH농협은행': 'NH Bank', '농협': 'NH Bank',
  '홈플러스': 'Homeplus', '이마트': 'emart', '롯데마트': 'Lotte Mart', 'GS25': 'GS25', 'CU': 'CU',
};

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

export function romanize(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) { out += ch; continue; }
    out += INITIAL[Math.floor(code / 588)] + VOWEL[Math.floor((code % 588) / 28)] + FINAL[code % 28];
  }
  // Capitalise each word: "yangjisikdang" -> "Yangjisikdang".
  return out.replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase());
}

// Chains only, by brand: "세븐일레븐 신당중앙점" -> "7-Eleven". The branch is left out on purpose:
// a romanized branch name ("Sindangjungang") is exactly what the walker must never hear.
// Other names return undefined: many are English words written in Korean (파크닉 = Parknic),
// which the guide recognises better than a letter-by-letter romanization would.
export function englishName(name, brand) {
  const key = brand && BRANDS[brand] ? brand : Object.keys(BRANDS).find(b => name.startsWith(b));
  return key ? BRANDS[key] : undefined;
}
